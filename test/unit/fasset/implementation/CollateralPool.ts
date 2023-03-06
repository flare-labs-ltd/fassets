import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import {
    CollateralPoolInstance, CollateralPoolTokenInstance,
    ERC20MockInstance, AssetManagerMockInstance,
    AgentVaultMockInstance
} from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";


enum TokenExitType { WITHDRAW_MOST_FEES, MINIMIZE_FEE_DEBT, KEEP_RATIO };
const ONE_ETH = new BN("1000000000000000000");
const ETH = (x: number | BN | string) => ONE_ETH.mul(new BN(x));

const ERC20Mock = artifacts.require("ERC20Mock");
const AgentVaultMock = artifacts.require("AgentVaultMock");
const AssetManager = artifacts.require("AssetManagerMock")
const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken")

contract(`CollateralPool.sol; ${getTestFile(__filename)}; Collateral pool basic tests`, async accounts => {
    let wNat: ERC20MockInstance;
    let assetManager: AssetManagerMockInstance;
    let fAsset: ERC20MockInstance;
    let agentVault: AgentVaultMockInstance;
    let collateralPool: CollateralPoolInstance;
    let collateralPoolToken: CollateralPoolTokenInstance;

    const agent = accounts[12];

    const exitCR = 1.2;
    const topupCR = 1.1;
    const topupTokenDiscount = 0.9;

    beforeEach(async () => {
        wNat = await ERC20Mock.new("wNative", "wNat");
        assetManager = await AssetManager.new(wNat.address);
        fAsset = await ERC20Mock.new("fBitcoin", "fBTC");
        agentVault = await AgentVaultMock.new(assetManager.address, agent);
        collateralPool = await CollateralPool.new(
            agentVault.address,
            assetManager.address,
            fAsset.address,
            Math.floor(exitCR*10_000),
            Math.floor(topupCR*10_000),
            Math.floor(topupTokenDiscount*10_000)
        );
        collateralPoolToken = await CollateralPoolToken.new(collateralPool.address);
        await assetManager.setPoolToken(collateralPool.address, collateralPoolToken.address);
    });

    function maxBN(x: BN, y: BN) {
        return x.gt(y) ? x : y;
    }

    function mulBips(x: BN, bips: number) {
        const bipsBN = new BN(Math.floor(10_000 * bips));
        return x.mul(bipsBN).div(new BN(10_000));
    }

    async function getNatRequiredToGetPoolCRAbove(CR: number) {
        const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
        const poolNatBalance = await wNat.balanceOf(collateralPool.address);
        const fassetSupply = await fAsset.totalSupply();
        const required = mulBips(fassetSupply.mul(priceMul), CR).div(priceDiv).sub(poolNatBalance);
        return required.lt(new BN(0)) ? new BN(0) : required;
    }

    async function getPoolCR() {
        const collateral = await wNat.balanceOf(collateralPool.address);
        const fassets = await fAsset.totalSupply();
        return [collateral, fassets];
    }

    describe("basic restrictions", async () => {

        it("should fail at calling setPoolToken from non asset manager", async () => {
            const prms = collateralPool.setPoolToken(collateralPoolToken.address);
            await expectRevert(prms, "only asset manager");
        });

        it("should fail at resetting pool token", async () => {
            const prms = assetManager.setPoolToken(collateralPool.address, collateralPoolToken.address);
            await expectRevert(prms, "pool token already set");
        });

    });

    describe("collateral pool token tests", async () => {

    });

    describe("entering collateral pool", async () => {

        it("should not enter the pool with too little funds", async () => {
            const prms = collateralPool.enter(0, true, { value: ETH(1).sub(new BN(1)) });
            await expectRevert(prms, "amount of nat sent is too low");
        });

        it("should not enter with collateral that doesn't cover the one in a tokenless pool", async () => {
            await wNat.mintAmount(collateralPool.address, ETH(10));
            const prms = collateralPool.enter(0, true, { value: ETH(5) });
            await expectRevert(prms,
                "if pool has no tokens, but has collateral, you need to send at least that amount of collateral");
        });

        it("should not enter the pool (with f-assets) with allowance set too small", async () => {
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            await fAsset.mintAmount(accounts[1], ETH(1000));
            await collateralPool.enter(0, true, { value: ETH(5), from: accounts[0] });
            const prms = collateralPool.enter(0, true, { value: ETH(5), from: accounts[1] });
            await expectRevert(prms, "f-asset allowance too small")
        });

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
                mulBips(natToTopup, 1 / topupTokenDiscount).add(
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
            expect(tokens0.toString()).to.equal(mulBips(natToTopup, 1 / topupTokenDiscount).toString());
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
            await collateralPool.payFeeDebt(debtFasset1);
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

        it("should revert on exiting the pool with zero tokens", async () => {
            const prms = collateralPool.exit(0, TokenExitType.WITHDRAW_MOST_FEES);
            await expectRevert(prms, "token share is zero");
        });

        it("should revert on user not having enough tokens", async () => {
            await collateralPool.enter(0, true, { value: ETH(10) });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const prms = collateralPool.exit(tokens.add(new BN(1)), TokenExitType.MINIMIZE_FEE_DEBT);
            await expectRevert(prms, "token balance too low");
        });

        it("should enter the pool and refuse to exit due to CR falling below exitCR", async () => {
            const fassets = ETH(10);
            await fAsset.mintAmount(accounts[0], fassets);
            const natToExit = await getNatRequiredToGetPoolCRAbove(exitCR);
            await collateralPool.enter(0, true, { value: natToExit });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            await expectRevert(collateralPool.exit(10, TokenExitType.MINIMIZE_FEE_DEBT),
                "collateral ratio falls below exitCR");
            await expectRevert(collateralPool.exit(10, TokenExitType.WITHDRAW_MOST_FEES),
                "collateral ratio falls below exitCR");
            await expectRevert(collateralPool.exit(tokens, TokenExitType.KEEP_RATIO),
                "collateral ratio falls below exitCR");
            await expectRevert(collateralPool.exit(tokens, TokenExitType.MINIMIZE_FEE_DEBT),
                "collateral ratio falls below exitCR")
        });

        it("should enter and exit correctly in the case of fasset supply = 0", async () => {
            const collateral = ETH(1);
            await collateralPool.enter(0, false, { value: collateral });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            expect(tokens.toString()).to.equal(collateral.toString());
            await collateralPool.exit(tokens, TokenExitType.MINIMIZE_FEE_DEBT);
            const nat = await wNat.balanceOf(accounts[0]);
            expect(nat.toString()).to.equal(collateral.toString());
        });

        it("should enter and exit, yielding no profit and no (at most 1wei) loss", async () => {
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
            await collateralPool.exit(tokens, TokenExitType.MINIMIZE_FEE_DEBT);
            const fassets2 = await fAsset.balanceOf(accounts[0]);
            expect(fassets2.sub(fassets).toNumber()).lessThanOrEqual(1);
            const nat = await wNat.balanceOf(accounts[0]);
            expect(nat.sub(collateral).toNumber()).lessThanOrEqual(1);
        });

        it("should yield no (at most 1wei) profit or loss to multiple people entering and exiting", async () => {
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
            // users exit the pool (in reverse order)
            for (let i = investments.length-1; i >= 0; i--) {
                const tokens = await collateralPoolToken.balanceOf(accounts[i]);
                await collateralPool.exit(tokens, TokenExitType.MINIMIZE_FEE_DEBT, { from: accounts[i] });
                const wnat = await wNat.balanceOf(accounts[i]);
                expect(wnat.sub(investments[i].nat).toNumber()).lessThanOrEqual(1);
                const fassets = await fAsset.balanceOf(accounts[i]);
                expect(fassets.sub(investments[i].fasset).toNumber()).lessThanOrEqual(1);
            }
        });

        it.only("should correctly exit with WITHDRAW_MOST_FEES token exit type", async () => {
            // user0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            // collateral pool collects fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // user1 enters the pool with no f-assets
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            // collateral pool collects additional fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // user1 exits with fees using WITHDRAW_MOST_FEES token exit type
            const allTokens = await collateralPoolToken.totalSupply();
            const virtualFassets = await collateralPool.virtualFassetOf(accounts[1]);
            const freeTokens = await collateralPoolToken.freeBalanceOf(accounts[1]);
            await collateralPool.exit(freeTokens, TokenExitType.WITHDRAW_MOST_FEES, { from: accounts[1] });
            // user1 should have earned f-asset fees
            const earnedFassets = await fAsset.balanceOf(accounts[1]);
            expect(earnedFassets.toString()).to.equal(virtualFassets.mul(freeTokens).div(allTokens).toString());
        });

    });

    describe("self close exits", async () => {

        it("should do a self-close exit with only one user", async () => {
            const collateral = ETH(100);
            const fassets = ETH(100);
            await fAsset.mintAmount(accounts[0], fassets);
            await fAsset.increaseAllowance(collateralPool.address, fassets);
            await collateralPool.enter(0, true, { value: collateral });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            await collateralPool.selfCloseExit(tokens, true, TokenExitType.MINIMIZE_FEE_DEBT, "");
            const wnat = await wNat.balanceOf(accounts[0]);
            expect(wnat.toString()).to.equal(collateral.toString());
            const fassets2 = await fAsset.balanceOf(accounts[0]);
            // taking all collateral out of the pool and keeping CR the same
            // means you have to destroy all existing f-assets
            expect(fassets2.toString()).to.equal("0");
        });

        // should know how to calculate fassets needed for pool stabilization of pool CR
        it.skip("should do a self-close exit with multiple users", async () => {
            const fassetBalances = [ETH(2000), ETH(1000)];
            const investments = [
                { fasset: ETH(0), nat: ETH(100) },
                { fasset: ETH(0), nat: ETH(100)}
            ];
            await fAsset.mintAmount(accounts[0], fassetBalances[0]);
            await fAsset.mintAmount(accounts[1], fassetBalances[1]);
            await fAsset.increaseAllowance(collateralPool.address, fassetBalances[0], { from: accounts[0] });
            await fAsset.increaseAllowance(collateralPool.address, fassetBalances[1], { from: accounts[1] });
            // users enter the pool
            await collateralPool.enter(0, true, { value: investments[0].nat, from: accounts[0] });
            await collateralPool.enter(0, true, { value: investments[1].nat, from: accounts[1] });
            // users do self-close exit
            const cr0 = await getPoolCR();
            const tokenShare0 = await collateralPoolToken.balanceOf(accounts[0]);
            await collateralPool.selfCloseExit(tokenShare0, true, TokenExitType.MINIMIZE_FEE_DEBT, "",
                { from: accounts[0] });
            const cr1 = await getPoolCR();
            const tokenShare1 = await collateralPoolToken.balanceOf(accounts[1]);
            await collateralPool.selfCloseExit(tokenShare1, true, TokenExitType.MINIMIZE_FEE_DEBT, "",
                { from: accounts[1] });
            const cr2 = await getPoolCR();
            assert(cr0[0].mul(cr1[1]).lte(cr1[0].mul(cr0[1])));
            assert(cr1[0].mul(cr2[1]).lte(cr2[0].mul(cr1[1])));
        });
    });

    describe("explicitly dealing with fasset debt", async () => {

        // self-close exits can exit the pool even when CR is below exitCR
        it("should enter the pool accruing debt and pay it off", async () => {
            await fAsset.mintAmount(accounts[1], ETH(10));
            await fAsset.mintAmount(collateralPool.address, ETH(1));
            await fAsset.increaseAllowance(collateralPool.address, ETH(10), { from: accounts[1] });
            await collateralPool.enter(0, true, { value: ETH(10) });
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[1] });
            const debt = await collateralPool.fassetDebtOf(accounts[1]);
            await collateralPool.payFeeDebt(debt, { from: accounts[1] });
            const newdebt = await collateralPool.fassetDebtOf(accounts[1]);
            expect(newdebt.toString()).to.equal("0");
            const lockedTokens = await collateralPool.debtTokensOf(accounts[1]);
            expect(lockedTokens.toString()).to.equal("0");
        });

        it("should enter the pool accruing debt, then mint new debt to collect f-asset rewards", async () => {
            // get f-assets in the pool
            await fAsset.mintAmount(collateralPool.address, ETH(1));
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            await fAsset.mintAmount(collateralPool.address, ETH(1));
            const virtualFassets = await collateralPool.virtualFassetOf(accounts[1]);
            const debtFassets = await collateralPool.fassetDebtOf(accounts[1]);
            const freeFassets = virtualFassets.sub(debtFassets);
            await collateralPool.withdrawFees(freeFassets, { from: accounts[1] });
            const fassetReward = await fAsset.balanceOf(accounts[1]);
            expect(fassetReward.toString()).to.equal(freeFassets.toString());
        });

    });

    describe("custom scenarios", async () => {
        it("should enter proportionally")
    });
});