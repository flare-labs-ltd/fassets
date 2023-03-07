import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import {
    CollateralPoolInstance, CollateralPoolTokenInstance,
    ERC20MockInstance, AssetManagerMockInstance,
    AgentVaultMockInstance
} from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";

const BN_ZERO = new BN(0);
const BN_ONE = new BN(1)


enum TokenExitType { MAXIMIZE_FEE_WITHDRAWAL, MINIMIZE_FEE_DEBT, KEEP_RATIO };
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

    async function getPoolCR() {
        const collateral = await wNat.balanceOf(collateralPool.address);
        const fassets = await fAsset.totalSupply();
        return [collateral, fassets];
    }

    async function getVirtualFassets() {
        const poolFassetBalance = await fAsset.balanceOf(collateralPool.address);
        const poolFassetDebt = await collateralPool.poolFassetDebt();
        return poolFassetBalance.add(poolFassetDebt);
    }

    async function getNatRequiredToGetPoolCRAbove(CR: number) {
        const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
        const poolNatBalance = await wNat.balanceOf(collateralPool.address);
        const fassetSupply = await fAsset.totalSupply();
        const required = mulBips(fassetSupply.mul(priceMul), CR).div(priceDiv).sub(poolNatBalance);
        return required.lt(new BN(0)) ? new BN(0) : required;
    }

    async function fassetsRequiredToKeepCR0(tokens: BN, account: string) {
        const fassetSupply = await fAsset.totalSupply();
        const tokenSupply = await collateralPoolToken.totalSupply();
        const collateral = await wNat.balanceOf(collateralPool.address);
        const natShare = collateral.mul(tokens).div(tokenSupply);
        return fassetSupply.mul(natShare).div(collateral);
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

    // to test whether users can send debt tokens
    describe("collateral pool token tests", async () => {

        it("should fetch the pool token", async () => {
            expect(await collateralPool.poolToken()).to.equal(collateralPoolToken.address);
        });

        it("should not be able to send locked tokens", async () => {
            // user0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(100) });
            // pool gets fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // user1 enters the pool with some debt
            await fAsset.mintAmount(accounts[1], ETH(1));
            await fAsset.increaseAllowance(collateralPool.address, ETH(1), { from: accounts[1] });
            await collateralPool.enter(ETH(1), false, { value: ETH(100), from: accounts[1] });
            // user1 tries to send too many tokens to another account
            const tokens = await collateralPoolToken.balanceOf(accounts[1]);
            const prms = collateralPoolToken.transfer(accounts[2], tokens, { from: accounts[1] });
            await expectRevert(prms, "free balance too low");
        });

    });

    describe("entering collateral pool", async () => {

        it("should lock entering if pool token supply is much larger than pool collateral", async () => {
            // enter the pool
            await collateralPool.enter(0, true, { value: ETH(1001) });
            // artificially burn pool collateral
            wNat.burnAmount(collateralPool.address, ETH(1000));
            // check that entering is disabled
            const prms = collateralPool.enter(0, true, { value: ETH(1), from: accounts[1] });
            await expectRevert(prms, "pool nat balance too small")
        });

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
            assert((await fAsset.balanceOf(accounts[0])).eq(BN_ZERO));
            const tokens1 = await collateralPoolToken.balanceOf(accounts[0]);
            assert(tokens1.eq(mulBips(natToTopup, 1 / topupTokenDiscount).add(
                investment[0].collateral.sub(natToTopup))));
            // enter with specified amount of f-assets (none should be required)
            await collateralPool.enter(investment[1].fassets, false,
                { value: investment[1].collateral, from: accounts[1] });
            const tokens2 = await collateralPoolToken.balanceOf(accounts[1]);
            assert(tokens2.eq(tokens1.mul(investment[1].collateral).div(investment[0].collateral)));
            // enter with required f-assets (none should be required)
            await collateralPool.enter(0, true, { value: investment[2].collateral, from: accounts[2] });
            const tokens3 = await collateralPoolToken.balanceOf(accounts[2]);
            assert(tokens3.eq(tokens1.add(tokens2).mul(investment[2].collateral).div(
                investment[0].collateral.add(investment[1].collateral)
            )));
            // check that pool has correctly wrapped collateral
            const collateral = await wNat.balanceOf(collateralPool.address);
            const collateralSum = investment.map(x => x.collateral).reduce((x,y) => x.add(y), new BN(0));
            assert(collateral.eq(collateralSum));
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
            assert(fassets0.eq(fassetInvestment.pool));
            const tokens0 = await collateralPoolToken.balanceOf(accounts[1]);
            assert(tokens0.eq(mulBips(natToTopup, 1 / topupTokenDiscount)));
            // enter collateral pool without f-assets
            await collateralPool.enter(0, false, { value: nat });
            const tokens1 = await collateralPoolToken.balanceOf(accounts[0]);
            assert(tokens1.eq(tokens0.mul(nat).div(natToTopup)));
            const liquidTokens1 = await collateralPoolToken.freeBalanceOf(accounts[0]);
            assert(liquidTokens1.eq(BN_ZERO));
            const virtualFassets1 = await collateralPool.virtualFassetOf(accounts[0]);
            assert(virtualFassets1.eq(fassets0.mul(tokens1).div(tokens0)));
            const debtFasset1 = await collateralPool.fassetDebtOf(accounts[0]);
            assert(debtFasset1.eq(virtualFassets1));
            // pay off the f-asset debt
            await collateralPool.payFeeDebt(debtFasset1);
            const tokens2 = await collateralPoolToken.balanceOf(accounts[0]);
            assert(tokens2.eq(tokens1));
            const liquidTokens2 = await collateralPoolToken.freeBalanceOf(accounts[0]);
            assert(liquidTokens2.eq(tokens2));
            const debtFasset2 = await collateralPool.fassetDebtOf(accounts[0]);
            assert(debtFasset2.eq(BN_ZERO));
            const virtualFassets2 = await collateralPool.virtualFassetOf(accounts[0]);
            assert(virtualFassets2.eq(virtualFassets1));
        });

    });

    describe("exiting collateral pool", async () => {

        it("should revert on exiting the pool with zero tokens", async () => {
            const prms = collateralPool.exit(0, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL);
            await expectRevert(prms, "token share is zero");
        });

        it("should revert on user not having enough tokens", async () => {
            await collateralPool.enter(0, true, { value: ETH(10) });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const prms = collateralPool.exit(tokens.add(new BN(1)), TokenExitType.MINIMIZE_FEE_DEBT);
            await expectRevert(prms, "token balance too low");
        });

        it("should require nat share to be larger than 0", async () => {
            // to reach the state we use the topup discount
            await fAsset.mintAmount(collateralPool.address, ETH(1)); // for topup discount
            await collateralPool.enter(0, false, { value: ETH(10) });
            const prms = collateralPool.exit(BN_ONE, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL);
            await expectRevert(prms, "amount of sent tokens is too small");
        });


        it("should enter the pool and refuse to exit due to CR falling below exitCR", async () => {
            const fassets = ETH(10);
            await fAsset.mintAmount(accounts[0], fassets);
            const natToExit = await getNatRequiredToGetPoolCRAbove(exitCR);
            await collateralPool.enter(0, true, { value: natToExit });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            await expectRevert(collateralPool.exit(10, TokenExitType.MINIMIZE_FEE_DEBT),
                "collateral ratio falls below exitCR");
            await expectRevert(collateralPool.exit(10, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL),
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
            assert(tokens.eq(collateral));
            await collateralPool.exit(tokens, TokenExitType.MINIMIZE_FEE_DEBT);
            const nat = await wNat.balanceOf(accounts[0]);
            assert(nat.eq(collateral));
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
            assert(fassets2.sub(fassets).lte(BN_ONE));
            const nat = await wNat.balanceOf(accounts[0]);
            assert(nat.sub(collateral).lte(BN_ONE));
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
                assert(wnat.sub(investments[i].nat).lte(BN_ONE));
                const fassets = await fAsset.balanceOf(accounts[i]);
                assert(fassets.sub(investments[i].fasset).lte(BN_ONE));
            }
        });

        it("should collect all fees using the MAXIMIZE_FEE_WITHDRAWAL token exit type", async () => {
            // user0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            // collateral pool collects fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // user1 enters the pool with no f-assets
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            // collateral pool collects additional fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // user1 exits with fees using MAXIMIZE_FEE_WITHDRAWAL token exit type
            const allTokens = await collateralPoolToken.totalSupply();
            const freeTokens = await collateralPoolToken.freeBalanceOf(accounts[1]);
            const virtualFassets = await getVirtualFassets();
            const poolNatBalance = await wNat.balanceOf(collateralPool.address);
            await collateralPool.exit(freeTokens, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, { from: accounts[1] });
            // user1 should have earned 0 wnat and all his f-asset fees
            const earnedFassets = await fAsset.balanceOf(accounts[1]);
            assert(earnedFassets.eq(virtualFassets.mul(freeTokens).div(allTokens)));
            const earnedWnat = await wNat.balanceOf(accounts[1]);
            assert(earnedWnat.eq(poolNatBalance.mul(freeTokens).div(allTokens)));
        });

        it("should eliminate all debt tokens using the MINIMIZE_FEE_DEBT token exit type", async () => {
            // user0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            // collateral pool collects fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // user1 enters the pool with no f-assets
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            // collateral pool collects additional fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // user1 exits with fees using MINIMIZE_FEE_DEBT token exit type
            const allTokens = await collateralPoolToken.totalSupply();
            const debtTokens = await collateralPoolToken.debtBalanceOf(accounts[1]);
            const poolNatBalance = await wNat.balanceOf(collateralPool.address);
            await collateralPool.exit(debtTokens, TokenExitType.MINIMIZE_FEE_DEBT, { from: accounts[1] });
            // user1 should have 0 f-asset debt and earn appropriate wnat
            const debtFassets = await collateralPool.fassetDebtOf(accounts[1]);
            assert(debtFassets.eq(BN_ZERO));
            const earnedWnat = await wNat.balanceOf(accounts[1]);
            assert(earnedWnat.eq(poolNatBalance.mul(debtTokens).div(allTokens)));
        });

        it("should collect rewards while keeping debt/free token ratio the same using KEEP_RATIO token exit type", async () => {
            // user0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            // collateral pool collects fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // user1 enters the pool with no f-assets
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            // collateral pool collects additional fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // user1 exits with fees using KEEP_RATIO token exit type
            const tokens = await collateralPoolToken.balanceOf(accounts[1])
            const debtTokensBefore = await collateralPoolToken.debtBalanceOf(accounts[1]);
            const freeTokensBefore = await collateralPoolToken.freeBalanceOf(accounts[1]);
            await collateralPool.exit(tokens.div(new BN(2)), TokenExitType.KEEP_RATIO, { from: accounts[1] });
            // user1 should have kept the ratio between debt and free tokens
            const debtTokensAfter = await collateralPoolToken.debtBalanceOf(accounts[1]);
            const freeTokensAfter = await collateralPoolToken.freeBalanceOf(accounts[1]);
            assert(debtTokensBefore.mul(freeTokensAfter).sub(debtTokensAfter.mul(freeTokensBefore)).lte(tokens));
        });

    });

    describe("self close exits", async () => {

        it("should require token share to be larger than 0", async () => {
            const prms = collateralPool.selfCloseExit(BN_ZERO, true, TokenExitType.KEEP_RATIO, "");
            await expectRevert(prms, "token share is zero");
        });

        it("should require that the token balance is large enough", async () => {
            await collateralPool.enter(0, false, { value: ETH(10) });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const prms = collateralPool.selfCloseExit(tokens.add(BN_ONE), true, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, "");
            await expectRevert(prms, "token balance too low");
        });

        it("should require nat share to be larger than 0", async () => {
            // to reach that state we use the topup discount
            await fAsset.mintAmount(collateralPool.address, ETH(1)); // for topup discount
            await collateralPool.enter(0, false, { value: ETH(10) });
            const prms = collateralPool.selfCloseExit(BN_ONE, true, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, "");
            await expectRevert(prms, "amount of sent tokens is too small");
        });

        it("should do a self-close exit where additional f-assets are not required", async () => {
            await fAsset.mintAmount(collateralPool.address, ETH(100));
            await collateralPool.enter(0, true, { value: ETH(10) });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const resp = await collateralPool.selfCloseExit(tokens, true, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, "");
            expectEvent.inTransaction(resp.receipt, assetManager, "AgentRedemptionInCollateral");
        });

        it("should do a self-close exit where additional f-assets are required", async () => {
            await fAsset.mintAmount(accounts[0], ETH(100));
            await fAsset.increaseAllowance(collateralPool.address, ETH(100));
            await collateralPool.enter(0, false, { value: ETH(10) });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const resp = await collateralPool.selfCloseExit(tokens, true, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, "");
            expectEvent.inTransaction(resp.receipt, assetManager, "AgentRedemptionInCollateral");
        });

        it("should do a self-close exit where additional f-assets are required but the allowance is not high enough", async () => {
            await fAsset.mintAmount(accounts[0], ETH(100));
            await fAsset.increaseAllowance(collateralPool.address, ETH(99));
            await collateralPool.enter(0, false, { value: ETH(10) });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const prms = collateralPool.selfCloseExit(tokens, true, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, "");
            await expectRevert(prms, "allowance too small");
        });

        it("should do a self-close exit where there are no f-assets to redeem", async () => {
            await collateralPool.enter(0, true, { value: ETH(10) });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const resp = await collateralPool.selfCloseExit(tokens, true, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, "");
            expectEvent.inTransaction(resp.receipt, assetManager, "AgentRedemptionInCollateral");
        });

        it("should do a self-close exit where redemption is done in underlying asset", async () => {
            await fAsset.mintAmount(collateralPool.address, ETH(100));
            await collateralPool.enter(0, true, { value: ETH(10) });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const resp = await collateralPool.selfCloseExit(tokens, false, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL,
                "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2");
            expectEvent.inTransaction(resp.receipt, assetManager, "AgentRedemption");
        });

        it("should do a simple self-close exit with one user", async () => {
            const collateral = ETH(100);
            const fassets = ETH(100);
            await fAsset.mintAmount(accounts[0], fassets);
            await fAsset.increaseAllowance(collateralPool.address, fassets);
            await collateralPool.enter(0, true, { value: collateral });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            await collateralPool.selfCloseExit(tokens, true, TokenExitType.MINIMIZE_FEE_DEBT, "");
            const natShare = await wNat.balanceOf(accounts[0]);
            assert(natShare.eq(collateral));
            const fassets2 = await fAsset.balanceOf(accounts[0]);
            // taking all collateral out of the pool and keeping CR the same
            // means you have to destroy all existing f-assets
            assert(fassets2.eq(BN_ZERO));
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
            const fassets0 = await fassetsRequiredToKeepCR0(tokenShare0, accounts[0]);
            const resp0 = await collateralPool.selfCloseExit(tokenShare0, true, TokenExitType.MINIMIZE_FEE_DEBT, "",
                { from: accounts[0] });
            expectEvent.inTransaction(resp0.receipt, assetManager, "AgentRedemptionInCollateral", { _amountUBA: fassets0 });
            await fAsset.burnAmount(collateralPool.address, fassets0);
            const cr1 = await getPoolCR();
            const tokenShare1 = (await collateralPoolToken.balanceOf(accounts[1])).div(new BN(10));
            const fassets1 = await fassetsRequiredToKeepCR0(tokenShare1, accounts[1]);
            const resp1 = await collateralPool.selfCloseExit(tokenShare1, true, TokenExitType.MINIMIZE_FEE_DEBT, "",
                { from: accounts[1] });
            expectEvent.inTransaction(resp1.receipt, assetManager, "AgentRedemptionInCollateral", { _amountUBA: fassets1 });
            await fAsset.burnAmount(collateralPool.address, fassets1);
            const cr2 = await getPoolCR();
            assert(cr0[0].mul(cr1[1]).lte(cr1[0].mul(cr0[1])));
            assert(cr1[0].mul(cr2[1]).lte(cr2[0].mul(cr1[1])));
        });
    });

    describe("externally dealing with fasset debt", async () => {

        it("should fail at trying to withdraw 0 fees", async () => {
            await expectRevert(collateralPool.withdrawFees(0), "trying to withdraw zero f-assets");
        });

        it("should fail at trying to withdraw too many f-asset fees", async () => {
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            const prms = collateralPool.withdrawFees(ETH(10).add(BN_ONE));
            await expectRevert(prms, "f-asset balance too small");
        });

        it("should fail at trying to pay too much f-asset debt", async () => {
            await expectRevert(collateralPool.payFeeDebt(BN_ONE), "debt f-asset balance too small");
        })

        it("should fail at trying to pay f-asset debt with too low f-asset allowance", async () => {
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            const debt = await collateralPool.fassetDebtOf(accounts[1]);
            await fAsset.mintAmount(accounts[1], debt);
            await fAsset.increaseAllowance(accounts[1], debt.sub(BN_ONE));
            const prms = collateralPool.payFeeDebt(debt, { from: accounts[1] });
            await expectRevert(prms, "f-asset allowance too small");
        });

        it("should enter the pool accruing debt, then mint new debt to collect f-asset rewards", async () => {
            // first user enters pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            // pool gets initial f-asset fees
            await fAsset.mintAmount(collateralPool.address, ETH(1));
            // second user enters pool
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            // pool gets additional f-asset fees
            await fAsset.mintAmount(collateralPool.address, ETH(1));
            // accounts[1] withdraws his share of fees from the pool
            const virtualFassets = await collateralPool.virtualFassetOf(accounts[1]);
            const debtFassets = await collateralPool.fassetDebtOf(accounts[1]);
            const freeFassets = virtualFassets.sub(debtFassets);
            await collateralPool.withdrawFees(freeFassets, { from: accounts[1] });
            // check that user has collected his rewards
            const fassetReward = await fAsset.balanceOf(accounts[1]);
            assert(fassetReward.eq(freeFassets));
            // check that all his tokens are now locked
            const tokens = await collateralPoolToken.freeBalanceOf(accounts[1]);
            assert(tokens.eq(BN_ZERO));
        });

        // self-close exits can exit the pool even when CR is below exitCR
        it("should enter the pool accruing debt and pay it off", async () => {
            // give user some funds to pay off the debt later
            await fAsset.mintAmount(accounts[1], ETH(10));
            await fAsset.increaseAllowance(collateralPool.address, ETH(10), { from: accounts[1] });
            // first user enters pool
            await collateralPool.enter(0, true, { value: ETH(10) });
            // pool gets initial f-asset fees
            await fAsset.mintAmount(collateralPool.address, ETH(1));
            // second user enters pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[1] });
            // accounts[1] pays off the debt
            const debt = await collateralPool.fassetDebtOf(accounts[1]);
            await collateralPool.payFeeDebt(debt, { from: accounts[1] });
            // check that the debt is zero
            const newdebt = await collateralPool.fassetDebtOf(accounts[1]);
            assert(newdebt.eq(BN_ZERO));
            // check that all his tokens are now unlocked
            const lockedTokens = await collateralPool.debtTokensOf(accounts[1]);
            assert(lockedTokens.eq(BN_ZERO));
        });

    });

    describe("externally viewing pool token debt", async () => {

        it("should return that a new user has zero pool tokens", async () => {
            const tokens = await collateralPool.freeTokensOf(accounts[0]);
            assert(tokens.eq(BN_ZERO));
        });

    });

    describe("custom scenarios", async () => {
        it("should enter proportionally")
    });
});
