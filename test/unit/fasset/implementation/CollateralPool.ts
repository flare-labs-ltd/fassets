import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
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
            exitCR*10000, topupCR*10000, topupTokenDiscount*10000);
        collateralPoolToken = await CollateralPoolToken.new(collateralPool.address);
        await collateralPool.setPoolToken(collateralPoolToken.address, { from: agentVault });
    });

    describe("entering collateral pool", () => {

        async function getNatRequiredToTopup() {
            const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
            const poolNatBalance = await wNat.balanceOf(collateralPool.address);
            const fassetSupply = await fAsset.totalSupply();
            return Math.max(Math.floor(
                Number(fassetSupply) * topupCR * Number(priceMul) / Number(priceDiv)
            ) - Number(poolNatBalance), 0);
        }

        it.only("should enter the f-assetless pool in multiple ways", async () => {
            const fassets = "1000";
            await fAsset.mintAmount(accounts[0], fassets);
            const natToTopup = await getNatRequiredToTopup();
            await collateralPool.enter(0, false, { value: natToTopup.toString(), from: accounts[0] });
            const fassets1 = await fAsset.balanceOf(accounts[0]);
            expect(fassets1.toString()).to.equal(fassets);
            const tokens1 = await collateralPoolToken.balanceOf(accounts[0]);
            expect(tokens1.toString()).to.equal(Math.floor(natToTopup / topupTokenDiscount).toString());
            // enter with specified amount of f-assets (none should be required)
            await collateralPool.enter(10, false, { value: "1000", from: accounts[1] });
            const tokens2 = await collateralPoolToken.balanceOf(accounts[1]);
            expect(tokens2.toString()).to.equal(Math.floor(Number(tokens1) * 1000 / natToTopup).toString());
            // enter with required f-assets (none should be required)
            await collateralPool.enter(0, true, { value: "4000", from: accounts[2] });
            const tokens3 = await collateralPoolToken.balanceOf(accounts[2]);
            expect(tokens3.toString()).to.equal(
                Math.floor(Number(tokens1.add(tokens2)) * 4000 / (natToTopup + 1000)).toString());
            // check that pool has correctly wrapped collateral
            const collateral = await wNat.balanceOf(collateralPool.address);
            expect(collateral.toString()).to.equal((natToTopup + 1000 + 4000).toString());
        });

        it("should enter the f-assetfull pool without f-assets, then payoff debt", async () => {
            const fassets = 100;
            await fAsset.mintAmount(collateralPool.address, fassets);
            // get f-assets into the pool and get collateral above topupCR
            const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
            const collateral = Math.floor(fassets * topupCR * Number(priceMul) / Number(priceDiv));
            await collateralPool.enter(0, true, { value: collateral.toString(), from: accounts[1] });
            // enter collateral pool without f-assets
            const tokens1 = Number(await collateralPoolToken.totalSupply());
            await collateralPool.enter(0, false, { value: "1000" });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            expect(tokens.toString()).to.equal("1000");
            const debtFassets = await collateralPool.fassetDebtOf(accounts[0]);
            expect(debtFassets.toString()).to.equal("0");
            const virtualFassets = await collateralPool.virtualFassetOf(accounts[0]);
            expect(virtualFassets.toString()).to.equal("100");
            const liquidTokens = await collateralPoolToken.freeBalanceOf(accounts[0]);
            expect(liquidTokens.toString()).to.equal("0");
            // pay off the debt by providing f-assets
           /*  await fAsset.mintAmount(accounts[0], debtFassets);
            await fAsset.increaseAllowance(collateralPool.address, debtFassets);
            await collateralPool.payoffDebt(debtFassets);
            const tokens2 = await collateralPoolToken.balanceOf(accounts[0]);
            expect(tokens2.toString()).to.equal("1000");
            const fassetDebt2 = await collateralPool.fassetDebtOf(accounts[0]);
            expect(fassetDebt2.toString()).to.equal("0");
            const virtualFassets2 = await collateralPool.virtualFassetOf(accounts[0]);
            expect(virtualFassets2.toString()).to.equal(expectedVirtualFassets.toString());
            const liquidTokens2 = await collateralPoolToken.freeBalanceOf(accounts[0]);
            expect(liquidTokens2.toString()).to.equal("1000"); */
        });

        it("should enter the f-assetfull pool with fassets", async () => {
            // fill the pool with some f-assets
            await fAsset.mintAmount(collateralPool.address, 100);
            // enter the pool with required f-assets
            await fAsset.mintAmount(accounts[0], 100);
            await collateralPool.enter(0, true, { value: "1000" });
            const fassetBalance = await fAsset.balanceOf(accounts[0]);
            expect(fassetBalance.toString()).to.equal("100");
            const debtFassets = await collateralPool.fassetDebtOf(accounts[0]);
            expect(debtFassets.toString()).to.equal("0");
            const virtualFassets = await collateralPool.virtualFassetOf(accounts[0]);
            expect(virtualFassets.toString()).to.equal("100");
            const liquidTokens = await collateralPool.liquidTokensOf(accounts[0]);
            expect(liquidTokens.toString()).to.equal("1000");
        });

    });

    describe("exiting collateral pool", async () => {

        it("should enter the pool and refuse to exit due to CR falling below exitCR", async () => {
            await fAsset.mintAmount(accounts[0], 100);
            await collateralPool.enter(0, true, { value: "10" });
            await expectRevert(collateralPool.exit(1), "collateral ratio falls below exitCR");
            await expectRevert(collateralPool.fullExit(), "collateral ratio falls below exitCR");
        });

        it("should enter and exit, yielding no profit", async () => {
            const fassets = 100;
            await fAsset.mintAmount(accounts[0], fassets);
            // get f-assets into the pool and get collateral above exitCR
            const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
            const collateral = Math.floor(fassets * exitCR * Number(priceMul) / Number(priceDiv));
            await collateralPool.enter(0, true, { value: collateral.toString(), from: accounts[1] });
            // enter and exit
            await collateralPool.enter(0, true, { value: "10" });
            await collateralPool.fullExit();
            const fassets2 = await fAsset.balanceOf(accounts[0]);
            expect(fassets2.toString()).to.equal(fassets.toString());
            expect((await wNat.balanceOf(accounts[0])).toString()).to.equal("10");
        });

    });
});
