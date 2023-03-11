import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import {
    CollateralPoolInstance, CollateralPoolTokenInstance,
    ERC20MockInstance, AssetManagerMockInstance,
    AgentVaultMockInstance
} from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";
import BN from "bn.js";

function assertEqualBN(a: BN, b: BN, message?: string) {
    assert.equal(a.toString(), b.toString(), message);
}

function assertLessOrEqualBN(a: BN, b: BN, message?: string) {
    const appendMessage = `expected ${a.toString()} to be less or equal than ${b.toString()}`;
    assert.isTrue(a.lte(b), (message ? message + "\n" : "") + appendMessage);
}

function assertLessBN(a: BN, b: BN, message?: string) {
    const appendMessage = `expected ${a.toString()} to be less than ${b.toString()}`;
    assert.isTrue(a.lt(b), (message ? message + "\n" : "") + appendMessage);
}

const BN_ZERO = new BN(0);
const BN_ONE = new BN(1);

enum TokenExitType { MAXIMIZE_FEE_WITHDRAWAL, MINIMIZE_FEE_DEBT, KEEP_RATIO };
const ONE_ETH = new BN("1000000000000000000");
const ETH = (x: number | BN | string) => ONE_ETH.mul(new BN(x));

const ERC20Mock = artifacts.require("ERC20Mock");
const AgentVaultMock = artifacts.require("AgentVaultMock");
const AssetManager = artifacts.require("AssetManagerMock")
const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");

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

    let MIN_ENTER_NAT: BN;
    let MIN_TOKEN_BALANCE_AFTER_EXIT: BN;

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
        // synch collateral pool constants
        MIN_ENTER_NAT = await collateralPool.MIN_NAT_TO_ENTER();
        MIN_TOKEN_BALANCE_AFTER_EXIT = await collateralPool.MIN_TOKEN_BALANCE_AFTER_EXIT();
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

    async function getPoolVirtualFassets() {
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

    async function fassetsRequiredToKeepCR0(tokens: BN) {
        const fassetSupply = await fAsset.totalSupply();
        const tokenSupply = await collateralPoolToken.totalSupply();
        const collateral = await wNat.balanceOf(collateralPool.address);
        const natShare = collateral.mul(tokens).div(tokenSupply);
        return fassetSupply.mul(natShare).div(collateral);
    }

    async function getPoolAboveCR(account: string, withFassets: boolean, cr: number) {
        const natToTopup = await getNatRequiredToGetPoolCRAbove(cr);
        const collateral = maxBN(natToTopup, MIN_ENTER_NAT);
        await collateralPool.enter(0, withFassets, { value: collateral, from: account });
    }

    describe("setting contract variables", async () => {

        it("should fail at calling setPoolToken from non asset manager", async () => {
            const prms = collateralPool.setPoolToken(collateralPoolToken.address);
            await expectRevert(prms, "only asset manager");
        });

        it("should fail at resetting pool token", async () => {
            const prms = assetManager.setPoolToken(collateralPool.address, collateralPoolToken.address);
            await expectRevert(prms, "pool token already set");
        });

        it("should fail at setting exit collateral ratio if conditions aren't met", async () => {
            const setTo = new BN(Math.floor(10_000 * topupCR));
            const prms = assetManager.callFunction(collateralPool.address, "setExitCollateralRatioBIPS(uint256)", setTo);
            await expectRevert(prms, "function call failed");
        });

        it("should correctly set exit collateral ratio", async () => {
            const setTo = (new BN(Math.floor(10_000 * topupCR))).add(BN_ONE);
            await assetManager.callFunction(collateralPool.address, "setExitCollateralRatioBIPS(uint256)", setTo);
            const newExitCollateralCR = await collateralPool.exitCollateralRatioBIPS();
            assertEqualBN(newExitCollateralCR, setTo);
        });

        it("should fail at setting topup collateral ratio if conditions aren't met", async () => {
            const setTo = new BN(Math.floor(10_000 * exitCR));
            const prms = assetManager.callFunction(collateralPool.address, "setTopupCollateralRatioBIPS(uint256)", setTo);
            await expectRevert(prms, "function call failed");
        });

        it("should correctly set topup collateral ratio", async () => {
            const setTo = new BN(Math.floor(10_000 * exitCR)).sub(BN_ONE);
            await assetManager.callFunction(collateralPool.address, "setTopupCollateralRatioBIPS(uint256)", setTo);
            const newExitCollateralCR = await collateralPool.topupCollateralRatioBIPS();
            assertEqualBN(newExitCollateralCR, setTo);
        });


        it("should fail at setting topup token discount if conditions aren't met", async () => {
            const prms = assetManager.callFunction(collateralPool.address, "setTopupTokenDiscountBIPS(uint256)", 10_000);
            await expectRevert(prms, "function call failed");
        });

        it("should correctly set topup token discount", async () => {
            const setTo = new BN(10_000).sub(BN_ONE);
            await assetManager.callFunction(collateralPool.address, "setTopupTokenDiscountBIPS(uint256)", setTo);
            const newExitCollateralCR = await collateralPool.topupTokenDiscountBIPS();
            assertEqualBN(newExitCollateralCR, setTo);
        });

    });

    // to test whether users can send debt tokens
    describe("collateral pool token tests", async () => {

        it("should fetch the pool token", async () => {
            expect(await collateralPool.poolToken()).to.equal(collateralPoolToken.address);
        });

        it("should fetch no tokens of a new account", async () => {
            const tokens = await collateralPoolToken.freeBalanceOf(accounts[0]);
            assertEqualBN(tokens, BN_ZERO);
        });

        it("should not be able to send locked tokens", async () => {
            // account0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(100) });
            // pool gets fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // account1 enters the pool with some debt
            await fAsset.mintAmount(accounts[1], ETH(1));
            await fAsset.increaseAllowance(collateralPool.address, ETH(1), { from: accounts[1] });
            await collateralPool.enter(ETH(1), false, { value: ETH(100), from: accounts[1] });
            // account1 tries to send too many tokens to another account
            const tokens = await collateralPoolToken.balanceOf(accounts[1]);
            const prms = collateralPoolToken.transfer(accounts[2], tokens, { from: accounts[1] });
            await expectRevert(prms, "free balance too low");
        });

        it("should transfer free tokens between users", async () => {
            // account0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(100) });
            // pool gets fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // account1 enters the pool with some debt
            await fAsset.mintAmount(accounts[1], ETH(1));
            await fAsset.increaseAllowance(collateralPool.address, ETH(1), { from: accounts[1] });
            await collateralPool.enter(ETH(1), false, { value: ETH(100), from: accounts[1] });
            // account1 sends all his free tokens to another account
            const freeTokensOfUser1 = await collateralPoolToken.freeBalanceOf(accounts[1]);
            await collateralPoolToken.transfer(accounts[2], freeTokensOfUser1, { from: accounts[1] });
            const freeTokensOfUser2 = await collateralPoolToken.freeBalanceOf(accounts[2]);
            assertEqualBN(freeTokensOfUser2, freeTokensOfUser1);
            // account2 sends his tokens back to account1
            await collateralPoolToken.transfer(accounts[1], freeTokensOfUser1, { from: accounts[2] });
            const freeTokensOfUser1AfterTransfer = await collateralPoolToken.freeBalanceOf(accounts[1]);
            assertEqualBN(freeTokensOfUser1AfterTransfer, freeTokensOfUser1);
        });

    });

    describe("entering collateral pool", async () => {

        it("should lock entering if pool token supply is much larger than pool collateral", async () => {
            // enter the pool
            await collateralPool.enter(0, true, { value: ETH(1001) });
            // artificially burn pool collateral
            wNat.burnAmount(collateralPool.address, ETH(1000));
            // check that entering is disabled
            const prms = collateralPool.enter(0, true, { value: MIN_ENTER_NAT, from: accounts[1] });
            await expectRevert(prms, "pool nat balance too small")
        });

        it("should fail entering the pool with too little funds", async () => {
            const prms = collateralPool.enter(0, true, { value: MIN_ENTER_NAT.sub(BN_ONE) });
            await expectRevert(prms, "amount of nat sent is too low");
        });

        it("should fail entering with collateral that doesn't cover the one in a tokenless pool", async () => {
            await wNat.mintAmount(collateralPool.address, ETH(10));
            const prms = collateralPool.enter(0, true, { value: ETH(5) });
            await expectRevert(prms,
                "if pool has no tokens, but has collateral, you need to send at least that amount of collateral");
        });

        it("should not enter the pool (with f-assets) with f-asset allowance set too small", async () => {
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            await fAsset.mintAmount(accounts[1], ETH(1000));
            await collateralPool.enter(0, true, { value: ETH(5), from: accounts[0] });
            const prms = collateralPool.enter(0, true, { value: ETH(5), from: accounts[1] });
            await expectRevert(prms, "f-asset allowance too small");
        });

        it("should enter tokenless, f-assetless and natless pool", async () => {
            await collateralPool.enter(0, true, { value: ETH(10) });
            const tokens = await collateralPoolToken.freeBalanceOf(accounts[0]);
            assertEqualBN(tokens, ETH(10));
            const tokenSupply = await collateralPoolToken.totalSupply();
            assertEqualBN(tokenSupply, ETH(10));
            const collateral = await wNat.balanceOf(collateralPool.address);
            assertEqualBN(collateral, ETH(10));
        });

        it("should enter tokenless and f-assetless pool holding some collateral", async () => {
            await wNat.mintAmount(collateralPool.address, ETH(10));
            await collateralPool.enter(0, true, { value: ETH(10) });
            const tokens = await collateralPoolToken.freeBalanceOf(accounts[0]);
            assertEqualBN(tokens, ETH(10));
            const tokenSupply = await collateralPoolToken.totalSupply();
            assertEqualBN(tokenSupply, ETH(10));
            const collateral = await wNat.balanceOf(collateralPool.address);
            assertEqualBN(collateral, ETH(20));
        });

        it("should not require f-assets from users when entering f-assetless pool in any way", async () => {
            await collateralPool.enter(0, true, { value: ETH(1) });
            await collateralPool.enter(0, false, { value: ETH(1) });
            await collateralPool.enter(ETH(1), true, { value: ETH(1) });
            await collateralPool.enter(ETH(1), false, { value: ETH(1) });
        });

        it("should make one user topup the pool", async () => {
            // mint some f-assets (target can be anyone)
            await fAsset.mintAmount(accounts[2], ETH(1));
            // account0 enters the pool
            const natToTopup = await getNatRequiredToGetPoolCRAbove(topupCR);
            const collateral = maxBN(natToTopup, MIN_ENTER_NAT);
            await collateralPool.enter(0, true, { value: collateral });
            // check that discount tokens are calculated correctly
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            assertEqualBN(tokens, collateral.sub(natToTopup).add(mulBips(natToTopup, 1 / topupTokenDiscount)),
        );
        });

        it("should make two users topup the pool", async () => {
            // mint some f-assets (target can be anyone)
            const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
            await fAsset.mintAmount(accounts[2], MIN_ENTER_NAT.mul(priceDiv).div(priceMul).mul(new BN(2)));
            // account0 enters the pool, but doesn't topup
            const collateralOfAccount0 = MIN_ENTER_NAT;
            await collateralPool.enter(0, true, { value: collateralOfAccount0, from: accounts[0] });
            const tokensOfAccount0 = await collateralPoolToken.balanceOf(accounts[0]);
            assertEqualBN(tokensOfAccount0, mulBips(collateralOfAccount0, 1 / topupTokenDiscount),
        );
            // account1 enters the pool and topups
            const collateralOfAccount1 = await getNatRequiredToGetPoolCRAbove(topupCR);
            await collateralPool.enter(0, true, { value: collateralOfAccount1, from: accounts[1] });
            const tokensOfAccount1 = await collateralPoolToken.balanceOf(accounts[1]);
            const standardPriceTokens = tokensOfAccount0.mul(collateralOfAccount1).div(collateralOfAccount0);
            assertEqualBN(tokensOfAccount1, mulBips(standardPriceTokens, 1 / topupTokenDiscount),
        );
        });

        it("should enter the topuped pool without f-assets, then pay off the debt", async () => {
            // mint required f-assets beforehand (topup cr should not change)
            const initialPoolFassets = ETH(5);
            await fAsset.mintAmount(collateralPool.address, initialPoolFassets);
            const fassets = initialPoolFassets.mul(new BN(2));
            await fAsset.mintAmount(accounts[0], fassets);
            await fAsset.increaseAllowance(collateralPool.address, fassets);
            // externally topup the pool
            await getPoolAboveCR(accounts[1], false, topupCR);
            const initialTokens = await collateralPoolToken.balanceOf(accounts[1]);
            const initialNat = await wNat.balanceOf(collateralPool.address);
            // enter collateral pool without f-assets
            const nat = initialNat.mul(new BN(2));
            await collateralPool.enter(0, false, { value: nat });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            assertEqualBN(tokens, initialTokens.mul(nat).div(initialNat));
            const liquidTokens = await collateralPoolToken.freeBalanceOf(accounts[0]);
            assertEqualBN(liquidTokens, BN_ZERO);
            const debtFassets = await collateralPool.fassetDebtOf(accounts[0]);
            assertEqualBN(debtFassets, initialPoolFassets.mul(tokens).div(initialTokens));
            const freeFassets = await collateralPool.freeFassetOf(accounts[0]);
            assertEqualBN(freeFassets, BN_ZERO);
            // pay off the f-asset debt
            await collateralPool.payFeeDebt(debtFassets, { from: accounts[0] });
            const tokensAfter = await collateralPoolToken.balanceOf(accounts[0]);
            assertEqualBN(tokensAfter, tokens);
            const liquidTokensAfter = await collateralPoolToken.freeBalanceOf(accounts[0]);
            assertEqualBN(liquidTokensAfter, tokens);
            const debtFassetsAfter = await collateralPool.fassetDebtOf(accounts[0]);
            assertEqualBN(debtFassetsAfter, BN_ZERO);
            const freeFassetsAfter = await collateralPool.virtualFassetOf(accounts[0]);
            assertEqualBN(freeFassetsAfter, debtFassets);
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

        it("should require that amount of tokens left after exit is large enough", async () => {
            await collateralPool.enter(0, true, { value: MIN_TOKEN_BALANCE_AFTER_EXIT });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const prms = collateralPool.exit(tokens.sub(MIN_TOKEN_BALANCE_AFTER_EXIT).add(BN_ONE),
                TokenExitType.MAXIMIZE_FEE_WITHDRAWAL);
            await expectRevert(prms, "token balance left after exit too low and non-zero");
        });

        it("should require nat share to be larger than 0", async () => {
            // to reach the state we use the topup discount
            await fAsset.mintAmount(collateralPool.address, ETH(1)); // for topup discount
            await collateralPool.enter(0, false, { value: ETH(10) });
            const prms = collateralPool.exit(BN_ONE, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL);
            await expectRevert(prms, "amount of sent tokens is too small");
        });

        it("should enter the pool and fail to exit due to CR falling below exitCR", async () => {
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

        it("should enter and exit correctly when f-asset supply is zero", async () => {
            const collateral = ETH(1);
            await collateralPool.enter(0, false, { value: collateral });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            assertEqualBN(tokens, collateral);
            await collateralPool.exit(tokens, TokenExitType.MINIMIZE_FEE_DEBT);
            const nat = await wNat.balanceOf(accounts[0]);
            assertEqualBN(nat, collateral);
        });

        it("should enter and exit, yielding no profit and no (at most 1wei) loss", async () => {
            const collateral = ETH(100);
            const initialFassets = ETH(1);
            await fAsset.mintAmount(accounts[1], ETH(10));
            await fAsset.mintAmount(accounts[0], initialFassets);
            // get f-assets into the pool and get collateral above exitCR
            const natToGetAboveExitCR = maxBN(await getNatRequiredToGetPoolCRAbove(exitCR), ETH(1));
            await collateralPool.enter(0, true, { value: natToGetAboveExitCR, from: accounts[1] });
            // user enters the pool
            await collateralPool.enter(0, true, { value: collateral });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            await collateralPool.exit(tokens, TokenExitType.MINIMIZE_FEE_DEBT);
            const fassets = await fAsset.balanceOf(accounts[0]);
            assertLessOrEqualBN(fassets.sub(initialFassets), BN_ONE);
            const nat = await wNat.balanceOf(accounts[0]);
            assertLessOrEqualBN(nat.sub(collateral), BN_ONE);
        });

        it("should collect all fees using the MAXIMIZE_FEE_WITHDRAWAL token exit type", async () => {
            // account0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            // collateral pool collects fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // account1 enters the pool with no f-assets
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            // collateral pool collects additional fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // account1 exits with fees using MAXIMIZE_FEE_WITHDRAWAL token exit type
            const allTokens = await collateralPoolToken.totalSupply();
            const freeTokens = await collateralPoolToken.freeBalanceOf(accounts[1]);
            const virtualFassets = await getPoolVirtualFassets();
            const poolNatBalance = await wNat.balanceOf(collateralPool.address);
            await collateralPool.exit(freeTokens, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, { from: accounts[1] });
            // account1 should have earned 0 wnat and all his f-asset fees
            const earnedFassets = await fAsset.balanceOf(accounts[1]);
            assertEqualBN(earnedFassets, virtualFassets.mul(freeTokens).div(allTokens));
            const earnedWnat = await wNat.balanceOf(accounts[1]);
            assertEqualBN(earnedWnat, poolNatBalance.mul(freeTokens).div(allTokens));
        });

        it("should eliminate all debt tokens using the MINIMIZE_FEE_DEBT token exit type", async () => {
            // account0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            // collateral pool collects fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // account1 enters the pool with no f-assets
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            // collateral pool collects additional fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // account1 exits with fees using MINIMIZE_FEE_DEBT token exit type
            const allTokens = await collateralPoolToken.totalSupply();
            const debtTokens = await collateralPoolToken.debtBalanceOf(accounts[1]);
            const poolNatBalance = await wNat.balanceOf(collateralPool.address);
            await collateralPool.exit(debtTokens, TokenExitType.MINIMIZE_FEE_DEBT, { from: accounts[1] });
            // account1 should have 0 f-asset debt and earn appropriate wnat
            const debtFassets = await collateralPool.fassetDebtOf(accounts[1]);
            assertEqualBN(debtFassets, BN_ZERO);
            const earnedWnat = await wNat.balanceOf(accounts[1]);
            assertEqualBN(earnedWnat, poolNatBalance.mul(debtTokens).div(allTokens));
        });

        it("should collect rewards while keeping debt/free token ratio the same using KEEP_RATIO token exit type", async () => {
            // account0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            // collateral pool collects fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // account1 enters the pool with no f-assets
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            // collateral pool collects additional fees
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // account1 exits with fees using KEEP_RATIO token exit type
            const tokenBalance = await collateralPoolToken.balanceOf(accounts[1]);
            const debtTokensBefore = await collateralPoolToken.debtBalanceOf(accounts[1]);
            const freeTokensBefore = await collateralPoolToken.freeBalanceOf(accounts[1]);
            await collateralPool.exit(tokenBalance.div(new BN(2)), TokenExitType.KEEP_RATIO, { from: accounts[1] });
            // account1 should have kept the ratio between debt and free tokens
            const debtTokensAfter = await collateralPoolToken.debtBalanceOf(accounts[1]);
            const freeTokensAfter = await collateralPoolToken.freeBalanceOf(accounts[1]);
            // tokenBalance is a strictly maximum numeric error for below expression
            // this means that the ratio freeTokensBefore/debtTokensBefore is preserved
            // with error smaller than tokenBalance / (debtTokensBefore * debtTokensAfter)!
            // this is not a problem as debtTokensBefore + freeTokensBefore = tokenBalance,
            // so one of them must be >= tokenBalance / 2, thus worst case is one ratio
            // doubling and its inverse halving.
            assertLessBN(debtTokensBefore.mul(freeTokensAfter).sub(debtTokensAfter.mul(freeTokensBefore)), tokenBalance);
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

        it("should require that amount of tokens left after exit is large enough", async () => {
            await collateralPool.enter(0, true, { value: MIN_TOKEN_BALANCE_AFTER_EXIT });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const prms = collateralPool.selfCloseExit(tokens.sub(MIN_TOKEN_BALANCE_AFTER_EXIT).add(BN_ONE), true,
                TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, "");
            await expectRevert(prms, "token balance left after exit too low and non-zero");
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
            const fassetBalanceBefore = ETH(100);
            await fAsset.mintAmount(accounts[0], fassetBalanceBefore);
            await fAsset.increaseAllowance(collateralPool.address, fassetBalanceBefore);
            await collateralPool.enter(0, true, { value: collateral });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            await collateralPool.selfCloseExit(tokens, true, TokenExitType.MINIMIZE_FEE_DEBT, "");
            const natShare = await wNat.balanceOf(accounts[0]);
            assertEqualBN(natShare, collateral);
            const fassetBalanceAfter = await fAsset.balanceOf(accounts[0]);
            // taking all collateral out of the pool and keeping CR the same
            // means you have to destroy all existing f-assets
            assertEqualBN(fassetBalanceAfter, BN_ZERO);
        });

        // find out how to calculate fassets needed for preservation of pool CR
        // also, why can't the second account exit with all tokens?
        it("should do a self-close exit with two users", async () => {
            const fassetBalanceOfAccount0 = ETH(2000);
            const fassetBalanceOfAccount1 = ETH(1000);
            await fAsset.mintAmount(accounts[0], fassetBalanceOfAccount0);
            await fAsset.mintAmount(accounts[1], fassetBalanceOfAccount1);
            await fAsset.increaseAllowance(collateralPool.address, fassetBalanceOfAccount0, { from: accounts[0] });
            await fAsset.increaseAllowance(collateralPool.address, fassetBalanceOfAccount1, { from: accounts[1] });
            // users enter the pool
            const natInvestmentFromAccount0 = ETH(100);
            const natInvestmentFromAccount1 = ETH(100)
            await collateralPool.enter(0, false, { value: natInvestmentFromAccount0, from: accounts[0] });
            await collateralPool.enter(0, false, { value: natInvestmentFromAccount1, from: accounts[1] });
            // account1 does self-close exit with all his tokens
            const cr0 = await getPoolCR();
            const tokenShareOfAccount0 = await collateralPoolToken.balanceOf(accounts[0]);
            const fassetsRequiredFromAccount0 = await fassetsRequiredToKeepCR0(tokenShareOfAccount0);
            const resp0 = await collateralPool.selfCloseExit(tokenShareOfAccount0, true, TokenExitType.MINIMIZE_FEE_DEBT, "",
                { from: accounts[0] });
            expectEvent.inTransaction(resp0.receipt, assetManager, "AgentRedemptionInCollateral",
                { _amountUBA: fassetsRequiredFromAccount0 });
            await fAsset.burnAmount(collateralPool.address, fassetsRequiredFromAccount0); // artificially burn "redeemed" f-assets
            // account0 does self-close exit with one tenth of his tokens
            const cr1 = await getPoolCR();
            const tokenShareOfAccount1 = (await collateralPoolToken.balanceOf(accounts[1])).div(new BN(10));
            const fassetsRequiredFromAccount1 = await fassetsRequiredToKeepCR0(tokenShareOfAccount1);
            const resp1 = await collateralPool.selfCloseExit(tokenShareOfAccount1, true, TokenExitType.MINIMIZE_FEE_DEBT, "",
                { from: accounts[1] });
            expectEvent.inTransaction(resp1.receipt, assetManager, "AgentRedemptionInCollateral",
                { _amountUBA: fassetsRequiredFromAccount1 });
            await fAsset.burnAmount(collateralPool.address, fassetsRequiredFromAccount1);
            const cr2 = await getPoolCR();
            // check that pool's collateral ratio has stayed the same
            assertEqualBN(cr0[0].mul(cr1[1]), cr1[0].mul(cr0[1]));
            assertEqualBN(cr1[0].mul(cr2[1]), cr2[0].mul(cr1[1]));
            // note that collateral ratio could have increased, but here there were no free f-assets held by users,
            // so redeemed f-assets were exactly those necessary to preserve pool collateral ratio
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
            // account1 withdraws his share of fees from the pool
            const freeFassets = await collateralPool.freeFassetOf(accounts[1]);
            await collateralPool.withdrawFees(freeFassets, { from: accounts[1] });
            // check that user has collected his rewards
            const fassetReward = await fAsset.balanceOf(accounts[1]);
            assertEqualBN(fassetReward, freeFassets);
            // check that all his tokens are now locked
            const tokens = await collateralPoolToken.freeBalanceOf(accounts[1]);
            assertEqualBN(tokens, BN_ZERO);
        });

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
            assertEqualBN(newdebt, BN_ZERO);
            // check that all his tokens are now unlocked
            const lockedTokens = await collateralPool.debtTokensOf(accounts[1]);
            assertEqualBN(lockedTokens, BN_ZERO);
        });

    });

    describe("scenarios", async () => {

        it("should yield no wei profit and at most 1wei loss to multiple people entering and exiting", async () => {
            const fassets = [ETH(10), ETH(100), ETH(1000)];
            const nats = [ETH(10), ETH(10), ETH(100000)];
            for (let i = 0; i < fassets.length; i++)
                await fAsset.mintAmount(accounts[i], fassets[i]);
            // get pool above exitCR (by non-included account)
            await getPoolAboveCR(accounts[10], false, exitCR);
            // users enter the pool
            for (let i = 0; i < fassets.length; i++)
                await collateralPool.enter(0, true, { value: nats[i], from: accounts[i] });
            // users exit the pool (in reverse order)
            for (let i = fassets.length-1; i >= 0; i--) {
                const tokens = await collateralPoolToken.balanceOf(accounts[i]);
                await collateralPool.exit(tokens, TokenExitType.MINIMIZE_FEE_DEBT, { from: accounts[i] });
                const wnat = await wNat.balanceOf(accounts[i]);
                assertLessOrEqualBN(wnat.sub(nats[i]), BN_ONE);
                const fassetBalance = await fAsset.balanceOf(accounts[i]);
                assertLessOrEqualBN(fassetBalance.sub(fassets[i]), BN_ONE);
            }
        });

        it("should simulate scenario where topupCR allows users to 'steal' f-assets", async () => {
            // account0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(20), from: accounts[0] });
            // pool gets rewards (CR doesn't drop below topupCR)
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // account1 enters the pool with ETH(10) f-assets
            await fAsset.mintAmount(accounts[1], ETH(10));
            await fAsset.increaseAllowance(collateralPool.address, ETH(10), { from: accounts[1] });
            await collateralPool.enter(ETH(10), false, { value: ETH(10), from: accounts[1] });
            // a lot of f-assets get minted, dropping pool CR well below topupCR
            await fAsset.mintAmount(accounts[2], ETH(10000));
            // account2 enters the pool buying up many tokens at topup discount
            await fAsset.increaseAllowance(collateralPool.address, ETH(10000), { from: accounts[2] });
            await collateralPool.enter(0, true, { value: ETH(1000), from: accounts[2] })
            // check how much (free) f-assets does account1 have
            const account1FreeFasset = await collateralPool.freeFassetOf(accounts[1]);
            assertLessBN(account1FreeFasset, ETH(10), "strategy should make user lose f-assets");
        });
    });

});
