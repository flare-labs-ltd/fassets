import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import {
    CollateralPoolInstance, CollateralPoolTokenInstance, FAssetInstance,
    ERC20MockInstance, AssetManagerMockInstance
} from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";

const CollateralPool = artifacts.require('CollateralPool');
const CollateralPoolToken = artifacts.require("CollateralPoolToken")
const ERC20Mock = artifacts.require("ERC20Mock");
const AssetManagerMock = artifacts.require("AssetManagerMock")

contract(`CollateralPool.sol; ${getTestFile(__filename)}; Collateral pool basic tests`, async accounts => {
    let collateralPool: CollateralPoolInstance;
    let collateralPoolToken: CollateralPoolTokenInstance;
    let assetManager: AssetManagerMockInstance;
    let fAsset: ERC20MockInstance;
    let wNat: ERC20MockInstance;

    const agentVault = accounts[12]

    const exitCR = 1.2;
    const topupCR = 1.1;
    const topupTokenDiscount = 0.9;

    beforeEach(async () => {
        fAsset = await ERC20Mock.new("fBitcoin", "fBTC");
        wNat = await ERC20Mock.new("wNative", "wNat");
        assetManager = await AssetManagerMock.new(wNat.address);
        collateralPool = await CollateralPool.new(
            agentVault, assetManager.address, fAsset.address,
            exitCR*10_000, topupCR*10_000, topupTokenDiscount*10_000);
        collateralPoolToken = await CollateralPoolToken.new(collateralPool.address);
        await collateralPool.setPoolToken(collateralPoolToken.address, { from: agentVault });
    });

    async function getNatRequiredToGetPoolCRAbove(CR: number) {
        const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
        const poolNatBalance = await wNat.balanceOf(collateralPool.address);
        const fassetSupply = await fAsset.totalSupply();
        return Math.max(Math.floor(
            Number(fassetSupply) * CR * Number(priceMul) / Number(priceDiv)
        ) - Number(poolNatBalance), 0);
    }

    describe("entering collateral pool", () => {

        it("should enter the f-assetless pool in multiple ways", async () => {
            const fassets = "1000";
            await fAsset.mintAmount(accounts[0], fassets);
            const natToTopup = await getNatRequiredToGetPoolCRAbove(topupCR);
            await collateralPool.enter(0, false, { value: natToTopup.toString(), from: accounts[0] });
            const fassets1 = await fAsset.balanceOf(accounts[0]);
            expect(fassets1.toString()).to.equal(fassets);
            const tokens1 = await collateralPoolToken.balanceOf(accounts[0]);
            expect(tokens1.toNumber()).to.equal(Math.floor(natToTopup / topupTokenDiscount));
            // enter with specified amount of f-assets (none should be required)
            await collateralPool.enter(10, false, { value: "1000", from: accounts[1] });
            const tokens2 = await collateralPoolToken.balanceOf(accounts[1]);
            expect(tokens2.toNumber()).to.equal(Math.floor(Number(tokens1) * 1000 / natToTopup));
            // enter with required f-assets (none should be required)
            await collateralPool.enter(0, true, { value: "4000", from: accounts[2] });
            const tokens3 = await collateralPoolToken.balanceOf(accounts[2]);
            expect(tokens3.toNumber()).to.equal(
                Math.floor(Number(tokens1.add(tokens2)) * 4000 / (natToTopup + 1000)));
            // check that pool has correctly wrapped collateral
            const collateral = await wNat.balanceOf(collateralPool.address);
            expect(collateral.toNumber()).to.equal((natToTopup + 1000 + 4000));
        });

        it("should enter the pool with/without f-assets, then pay off the debt", async () => {
            const poolFassets = 500;
            const userFassets = 1000;
            await fAsset.mintAmount(collateralPool.address, poolFassets);
            await fAsset.mintAmount(accounts[0], userFassets);
            await fAsset.increaseAllowance(collateralPool.address, userFassets);
            // get pool above poolCR with another account
            const natToTopup = await getNatRequiredToGetPoolCRAbove(topupCR);
            await collateralPool.enter(0, true, { value: natToTopup.toString(), from: accounts[1] });
            const fassets0 = await collateralPool.virtualFassetOf(accounts[1]);
            expect(fassets0.toNumber()).to.equal(poolFassets);
            const tokens0 = await collateralPoolToken.balanceOf(accounts[1]);
            expect(tokens0.toNumber()).to.equal(Math.floor(natToTopup / topupTokenDiscount));
            // enter collateral pool without f-assets
            await collateralPool.enter(0, false, { value: "1000" });
            const tokens1 = await collateralPoolToken.balanceOf(accounts[0]);
            expect(tokens1.toNumber()).to.equal(Math.floor(Number(tokens0) * 1000 / natToTopup));
            const liquidTokens1 = await collateralPoolToken.freeBalanceOf(accounts[0]);
            expect(liquidTokens1.toString()).to.equal("0");
            const virtualFassets1 = await collateralPool.virtualFassetOf(accounts[0]);
            expect(virtualFassets1.toString()).to.equal(fassets0.mul(tokens1).div(tokens0).toString());
            const debtFasset1 = await collateralPool.fassetDebtOf(accounts[0]);
            expect(debtFasset1.toString()).to.equal(virtualFassets1.toString());
            // pay off the f-asset debt
            await collateralPool.payoffAllDebt();
            const tokens2 = await collateralPoolToken.balanceOf(accounts[0]);
            expect(tokens2.toString()).to.equal(tokens1.toString());
            const liquidTokens2 = await collateralPoolToken.freeBalanceOf(accounts[0]);
            expect(liquidTokens2.toString()).to.equal(tokens2.toString());
            const debtFasset2 = await collateralPool.fassetDebtOf(accounts[0]);
            expect(debtFasset2.toString()).to.equal("0");
            const virtualFassets2 = await collateralPool.virtualFassetOf(accounts[0]);
            expect(virtualFassets2.toString()).to.equal(virtualFassets1.toString());
        });

    });

    describe("exiting collateral pool", async () => {

        it("should enter the pool and refuse to exit due to CR falling below exitCR", async () => {
            await fAsset.mintAmount(accounts[0], 1000);
            const natToExit = await getNatRequiredToGetPoolCRAbove(exitCR);
            await collateralPool.enter(0, true, { value: natToExit.toString() });
            await expectRevert(collateralPool.exit(2), "collateral ratio falls below exitCR");
            await expectRevert(collateralPool.fullExit(), "collateral ratio falls below exitCR");
        });

        it("should enter and exit, yielding no profit or loss", async () => {
            const fassets = 100;
            await fAsset.mintAmount(accounts[0], fassets);
            // get f-assets into the pool and get collateral above exitCR
            const natToExit = await getNatRequiredToGetPoolCRAbove(exitCR);
            await collateralPool.enter(0, true, { value: natToExit.toString(), from: accounts[1] });
            // enter and exit
            await collateralPool.enter(0, true, { value: "10" });
            await collateralPool.fullExit();
            const fassets2 = await fAsset.balanceOf(accounts[0]);
            expect(fassets2.toString()).to.equal(fassets.toString());
            const collateral = await wNat.balanceOf(accounts[0]);
            expect(collateral.toString()).to.equal("10");
        });

        it.skip("should yield no profit or loss to two people exiting", async () => {
            const user0Fassets = "50000000";
            const user1Fassets = "50000000";
            const user0Collateral = "10000000000000";
            const user1Collateral = "400000000000";
            await fAsset.mintAmount(accounts[0], user0Fassets);
            await fAsset.mintAmount(accounts[1], user1Fassets);
            // get f-assets into the pool and get collateral above exitCR
            const natToExit = await getNatRequiredToGetPoolCRAbove(exitCR);
            await collateralPool.enter(0, true, { value: natToExit.toString(), from: accounts[2] });
            // users enter the pool
            await collateralPool.enter(0, true, { value: user0Collateral, from: accounts[0] });
            await collateralPool.enter(0, true, { value: user1Collateral, from: accounts[1] });
            // users exit
            await collateralPool.fullExit({ from: accounts[1] });
            await collateralPool.fullExit({ from: accounts[0] });
            const wnat0 = await wNat.balanceOf(accounts[0]);
            const wnat1 = await wNat.balanceOf(accounts[1]);
            expect(wnat0.toString()).to.equal(user0Collateral);
            expect(wnat1.toString()).to.equal(user1Collateral);
            const fassets0 = await fAsset.balanceOf(accounts[0]);
            const fassets1 = await fAsset.balanceOf(accounts[1]);
            expect(fassets0.toString()).to.equal(user0Fassets);
            expect(fassets1.toString()).to.equal(user1Fassets);
        });

    });
});
