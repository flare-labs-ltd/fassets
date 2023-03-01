import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import {
    CollateralPoolInstance, CollateralPoolTokenInstance,
    ERC20MockInstance, AssetManagerMockInstance
} from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";


enum TokenExitType { PRIORITIZE_DEBT, PRIORITIZE_FASSET, KEEP_RATIO };
const ONE_ETH = new BN("1000000000000000000");
const ETH = (x: number | BN | string) => ONE_ETH.mul(new BN(x));

const CollateralPool = artifacts.require('CollateralPool');
const CollateralPoolToken = artifacts.require("CollateralPoolToken")
const ERC20Mock = artifacts.require("ERC20Mock");
const AssetManager = artifacts.require("AssetManagerMock")

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
        assetManager = await AssetManager.new(wNat.address);
        collateralPool = await CollateralPool.new(
            agentVault, assetManager.address, fAsset.address,
            exitCR*10_000, topupCR*10_000, topupTokenDiscount*10_000);
        collateralPoolToken = await CollateralPoolToken.new(collateralPool.address);
        await collateralPool.setPoolToken(collateralPoolToken.address, { from: agentVault });
    });

    function maxBN(x: BN, y: BN) {
        return x.gt(y) ? x : y;
    }

    function mulByBips(x: BN, bips: number) {
        const bipsBN = new BN(Math.floor(10_000 * bips));
        return x.mul(bipsBN).div(new BN(10_000));
    }

    async function getNatRequiredToGetPoolCRAbove(CR: number) {
        const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
        const poolNatBalance = await wNat.balanceOf(collateralPool.address);
        const fassetSupply = await fAsset.totalSupply();
        const required = mulByBips(fassetSupply.mul(priceMul), CR).div(priceDiv).sub(poolNatBalance);
        return required.lt(new BN(0)) ? new BN(0) : required;
    }

    describe("entering collateral pool", () => {

        it("should enter the f-assetless pool in multiple ways", async () => {
            const investment = [
                { collateral: ETH(1), fassets: ETH(1) },
                { collateral: ETH(1), fassets: ETH(1) },
                { collateral: ETH(1), fassets: ETH(1) }
            ];
            await fAsset.mintAmount(accounts[1], investment[1].fassets);
            // topup the pool
            const natToTopup = await getNatRequiredToGetPoolCRAbove(topupCR);
            investment[0].collateral = maxBN(natToTopup, ETH(1));
            await collateralPool.enter(0, false, { value: investment[0].collateral, from: accounts[0] });
            expect((await fAsset.balanceOf(accounts[0])).toString()).to.equal("0");
            const tokens1 = await collateralPoolToken.balanceOf(accounts[0]);
            expect(tokens1.toString()).to.equal(
                mulByBips(natToTopup, 1 / topupTokenDiscount).add(
                    investment[0].collateral.sub(natToTopup)
                ).toString());
            // enter with specified amount of f-assets (none should be required)
            await collateralPool.enter(investment[1].fassets, false,
                { value: investment[1].collateral, from: accounts[1] });
            const tokens2 = await collateralPoolToken.balanceOf(accounts[1]);
            expect(tokens2.toString()).to.equal(
                tokens1.mul(investment[1].collateral).div(investment[0].collateral).toString());
            // enter with required f-assets (none should be required)
            await collateralPool.enter(0, true, { value: investment[2].collateral, from: accounts[2] });
            const tokens3 = await collateralPoolToken.balanceOf(accounts[2]);
            expect(tokens3.toString()).to.equal(
                tokens1.add(tokens2).mul(investment[2].collateral).div(
                    investment[0].collateral.add(investment[1].collateral)
                ).toString());
            // check that pool has correctly wrapped collateral
            const collateral = await wNat.balanceOf(collateralPool.address);
            const collateralSum = investment.map(x => x.collateral).reduce((x,y) => x.add(y), new BN(0));
            expect(collateral.toString()).to.equal(collateralSum.toString());
        });

        it("should enter the topuped pool without f-assets, then pay off the debt", async () => {
            const fassetInvestment = {
                user: new BN(ETH(100)),
                pool: new BN(ETH(2))
            };
            const nat = ETH(10);

            await fAsset.mintAmount(collateralPool.address, fassetInvestment.pool);
            await fAsset.mintAmount(accounts[0], fassetInvestment.user);
            await fAsset.increaseAllowance(collateralPool.address, fassetInvestment.user);
            // get the pool above topupCR with another account
            const natToTopup = maxBN(await getNatRequiredToGetPoolCRAbove(topupCR), ETH(1));
            await collateralPool.enter(0, false, { value: natToTopup, from: accounts[1] });
            const fassets0 = await collateralPool.virtualFassetOf(accounts[1]);
            expect(fassets0.toString()).to.equal(fassetInvestment.pool.toString());
            const tokens0 = await collateralPoolToken.balanceOf(accounts[1]);
            expect(tokens0.toString()).to.equal(mulByBips(natToTopup, 1 / topupTokenDiscount).toString());
            // enter collateral pool without f-assets
            await collateralPool.enter(0, false, { value: nat });
            const tokens1 = await collateralPoolToken.balanceOf(accounts[0]);
            expect(tokens1.toString()).to.equal(tokens0.mul(nat).div(natToTopup).toString());
            const liquidTokens1 = await collateralPoolToken.freeBalanceOf(accounts[0]);
            expect(liquidTokens1.toString()).to.equal("0");
            const virtualFassets1 = await collateralPool.virtualFassetOf(accounts[0]);
            expect(virtualFassets1.toString()).to.equal(fassets0.mul(tokens1).div(tokens0).toString());
            const debtFasset1 = await collateralPool.fassetDebtOf(accounts[0]);
            expect(debtFasset1.toString()).to.equal(virtualFassets1.toString());
            // pay off the f-asset debt
            await collateralPool.burnDebt(debtFasset1);
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

        it("should enter and exit correctly in the case of fasset supply = 0", async () => {
            const collateral = ETH(1);
            await collateralPool.enter(0, false, { value: collateral });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            expect(tokens.toString()).to.equal(collateral.toString());
            await collateralPool.exit(tokens, TokenExitType.PRIORITIZE_FASSET);
            const nat = await wNat.balanceOf(accounts[0]);
            expect(nat.toString()).to.equal(collateral.toString());
        });

        it("should enter the pool and refuse to exit due to CR falling below exitCR", async () => {
            const fassets = ETH(10);
            await fAsset.mintAmount(accounts[0], fassets);
            const natToExit = await getNatRequiredToGetPoolCRAbove(exitCR);
            await collateralPool.enter(0, true, { value: natToExit });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            await expectRevert(collateralPool.exit(10, TokenExitType.PRIORITIZE_FASSET),
                "collateral ratio falls below exitCR");
            await expectRevert(collateralPool.exit(10, TokenExitType.PRIORITIZE_DEBT),
                "collateral ratio falls below exitCR");
            await expectRevert(collateralPool.exit(tokens, TokenExitType.KEEP_RATIO),
                "collateral ratio falls below exitCR");
            await expectRevert(collateralPool.exit(tokens, TokenExitType.PRIORITIZE_FASSET),
                "collateral ratio falls below exitCR")
        });

        it("should enter and exit, yielding no profit and (almost) no loss", async () => {
            const collateral = ETH(100);
            const fassets = ETH(1);
            await fAsset.mintAmount(accounts[1], ETH(10));
            await fAsset.mintAmount(accounts[0], fassets);
            // get f-assets into the pool and get collateral above exitCR
            const natToGetAboveExitCR = maxBN(await getNatRequiredToGetPoolCRAbove(exitCR), ETH(1));
            await collateralPool.enter(0, true, { value: natToGetAboveExitCR, from: accounts[1] });
            // user enters the pool
            await collateralPool.enter(0, true, { value: collateral });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            await collateralPool.exit(tokens, TokenExitType.PRIORITIZE_FASSET);
            const fassets2 = await fAsset.balanceOf(accounts[0]);
            expect(fassets2.sub(fassets).toNumber()).lessThanOrEqual(1);
            const nat = await wNat.balanceOf(accounts[0]);
            expect(nat.sub(collateral).toNumber()).lessThanOrEqual(1);
        });

        it.only("should yield no profit or loss to two people exiting", async () => {
            const investments = [
                { fasset: ETH(10), nat: ETH(10) },
                { fasset: ETH(100), nat: ETH(10) },
                { fasset: ETH(1000), nat: ETH(100000) }
            ]
            for (let i = 0; i < investments.length; i++)
                await fAsset.mintAmount(accounts[i], investments[i].fasset);
            // special user provides collateral to get pool above exitCR
            const natToExit = maxBN(await getNatRequiredToGetPoolCRAbove(exitCR), ETH(1));
            await collateralPool.enter(0, true, { value: natToExit.toString(), from: accounts[10] });
            // users enter the pool
            for (let i = 0; i < investments.length; i++)
                await collateralPool.enter(0, true, { value: investments[i].nat, from: accounts[i] });
            // users exit the pool
            for (let i = 0; i < investments.length; i++) {
                const tokens = await collateralPoolToken.balanceOf(accounts[i]);
                await collateralPool.exit(tokens, TokenExitType.PRIORITIZE_FASSET, { from: accounts[i] });
                const wnat = await wNat.balanceOf(accounts[i]);
                expect(wnat.sub(investments[i].nat).toNumber()).lessThanOrEqual(1);
                const fassets = await fAsset.balanceOf(accounts[i]);
                expect(fassets.sub(investments[i].fasset).toNumber()).lessThanOrEqual(1);
            }
        });

    });

    describe("self close exits", async () => {

        it("should do the self close exit correctly", async () => {
            const user0Fassets = ETH(10);
            const user1Fassets = ETH(10);
            const user0Collateral = ETH(100);
            const user1Collateral = ETH(1000);
            await fAsset.mintAmount(accounts[0], user0Fassets);
            await fAsset.mintAmount(accounts[1], user1Fassets);
            // get f-assets into the pool and get collateral above exitCR
            const natToExit = await getNatRequiredToGetPoolCRAbove(exitCR);
            await collateralPool.enter(0, true, { value: natToExit.toString(), from: accounts[2] });
        });
    });
});
