import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import { erc165InterfaceId, toBN, toWei } from "../../../../lib/utils/helpers";
import {
    AgentVaultMockInstance,
    AssetManagerMockInstance,
    CollateralPoolInstance, CollateralPoolTokenInstance,
    DistributionToDelegatorsInstance,
    ERC20MockInstance,
    IERC20Contract, IERC165Contract
} from "../../../../typechain-truffle";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { TestSettingsContracts, createTestContracts } from "../../../utils/test-settings";
import { impersonateContract, stopImpersonatingContract, transferWithSuicide } from "../../../utils/contract-test-helpers";
import { MAX_BIPS } from "../../../../lib/utils/helpers";
import { eventArgs } from "../../../../lib/utils/events/truffle";
import { requiredEventArgsFrom } from "../../../utils/Web3EventDecoder";

function assertEqualBN(a: BN, b: BN, message?: string) {
    assert.equal(a.toString(), b.toString(), message);
}

function assertEqualBNWithError(a: BN, b: BN, err: BN, message?: string) {
    const appendMessage = `expected ${a.toString()} to equal to ${b.toString()} with error ${err.toString()}`;
    assert.isTrue(a.sub(b).abs().lte(err), (message ? message + "\n" : "") + appendMessage);
}

function maxBN(x: BN, y: BN) {
    return x.gt(y) ? x : y;
}

function mulBips(x: BN, bips: number) {
    return x.muln(Math.floor(MAX_BIPS * bips)).divn(MAX_BIPS);
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
const DistributionToDelegators = artifacts.require("DistributionToDelegators");
const MockContract = artifacts.require('MockContract');

contract(`CollateralPool.sol; ${getTestFile(__filename)}; Collateral pool basic tests`, async accounts => {
    let wNat: ERC20MockInstance;
    let assetManager: AssetManagerMockInstance;
    let fAsset: ERC20MockInstance;
    let agentVault: AgentVaultMockInstance;
    let collateralPool: CollateralPoolInstance;
    let collateralPoolToken: CollateralPoolTokenInstance;
    let contracts: TestSettingsContracts;

    const agent = accounts[12];
    const governance = accounts[10];

    const exitCR = 1.2;
    const topupCR = 1.1;
    const topupTokenDiscount = 0.9;

    let MIN_NAT_TO_ENTER: BN;
    let MIN_TOKEN_SUPPLY_AFTER_EXIT: BN;
    let MIN_NAT_BALANCE_AFTER_EXIT: BN;

    async function initialize() {
        contracts = await createTestContracts(governance);
        wNat = await ERC20Mock.new("wNative", "wNat");
        assetManager = await AssetManager.new(wNat.address);
        await assetManager.setCommonOwner(agent);
        await assetManager.setCheckForValidAgentVaultAddress(false);
        fAsset = await ERC20Mock.new("fBitcoin", "fBTC");
        agentVault = await AgentVaultMock.new(assetManager.address, agent);
        collateralPool = await CollateralPool.new(
            agentVault.address,
            assetManager.address,
            fAsset.address,
            Math.floor(exitCR*MAX_BIPS),
            Math.floor(topupCR*MAX_BIPS),
            Math.floor(topupTokenDiscount*MAX_BIPS)
        );
        collateralPoolToken = await CollateralPoolToken.new(collateralPool.address);
        // set pool token
        const payload = collateralPool.contract.methods.setPoolToken(collateralPoolToken.address).encodeABI();
        await assetManager.callFunctionAt(collateralPool.address, payload);
        // synch collateral pool constants
        MIN_NAT_TO_ENTER = await collateralPool.MIN_NAT_TO_ENTER();
        MIN_TOKEN_SUPPLY_AFTER_EXIT = await collateralPool.MIN_TOKEN_SUPPLY_AFTER_EXIT();
        MIN_NAT_BALANCE_AFTER_EXIT = await collateralPool.MIN_NAT_BALANCE_AFTER_EXIT();
        // temporary fix for testing
        await assetManager.registerFAssetForCollateralPool(fAsset.address);
        return { contracts, wNat, assetManager, fAsset, agentVault, collateralPool, collateralPoolToken, MIN_NAT_TO_ENTER, MIN_TOKEN_SUPPLY_AFTER_EXIT, MIN_NAT_BALANCE_AFTER_EXIT };
    }

    beforeEach(async () => {
        ({ contracts, wNat, assetManager, fAsset, agentVault, collateralPool, collateralPoolToken, MIN_NAT_TO_ENTER, MIN_TOKEN_SUPPLY_AFTER_EXIT, MIN_NAT_BALANCE_AFTER_EXIT } =
            await loadFixtureCopyVars(initialize));
    });

    function applyTopupDiscount(x: BN) {
        return x.muln(MAX_BIPS).divn(MAX_BIPS * topupTokenDiscount);
    }

    async function poolFAssetFeeNatValue() {
        const poolFAssetFees = await collateralPool.totalFAssetFees();
        const { 0: assetPriceMul, 1: assetPriceDiv } = await assetManager.assetPriceNatWei();
        return poolFAssetFees.mul(assetPriceMul).div(assetPriceDiv);
    }

    async function givePoolFAssetFees(amount: BN) {
        await fAsset.mintAmount(collateralPool.address, amount);
        const payload = collateralPool.contract.methods.fAssetFeeDeposited(amount).encodeABI();
        await assetManager.callFunctionAt(collateralPool.address, payload);
    }

    async function getPoolCollaterals() {
        const collateral = await collateralPool.totalCollateral();
        const fassets = await collateralPool.totalFAssetFees();
        return [collateral, fassets];
    }

    async function getPoolCRBIPS() {
        const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
        const poolNatBalance = await collateralPool.totalCollateral();
        const backedFAsset = await assetManager.getFAssetsBackedByPool(agentVault.address)
        return (backedFAsset.gtn(0)) ?
            poolNatBalance.muln(MAX_BIPS).mul(priceDiv).div(priceMul).div(backedFAsset) :
            new BN(10 * MAX_BIPS);
    }

    async function getPoolVirtualFassets() {
        const poolFassetBalance = await fAsset.balanceOf(collateralPool.address);
        const poolFassetDebt = await collateralPool.totalFAssetFeeDebt();
        return poolFassetBalance.add(poolFassetDebt);
    }

    // n = (r F p / q) - N
    async function getNatRequiredToGetPoolCRAbove(CR: number) {
        const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
        const poolNatBalance = await collateralPool.totalCollateral();
        const backedFAsset = await assetManager.getFAssetsBackedByPool(agentVault.address)
        const required = mulBips(backedFAsset.mul(priceMul), CR).div(priceDiv).sub(poolNatBalance);
        return required.lt(new BN(0)) ? new BN(0) : required;
    }

    async function fassetsRequiredToKeepCR(tokens: BN) {
        const fassetSupply = await fAsset.totalSupply();
        const tokenSupply = await collateralPoolToken.totalSupply();
        const collateral = await wNat.balanceOf(collateralPool.address);
        const natShare = collateral.mul(tokens).div(tokenSupply);
        return fassetSupply.mul(natShare).div(collateral);
    }

    async function getPoolAboveCR(account: string, withFassets: boolean, cr: number) {
        const natToTopup = await getNatRequiredToGetPoolCRAbove(cr);
        const poolTokenSupply = await collateralPoolToken.totalSupply();
        let collateral = maxBN(natToTopup, MIN_NAT_TO_ENTER);
        if (poolTokenSupply.eqn(0)) {
            const natToCoverFAsset = await poolFAssetFeeNatValue();
            const natToCoverCollateral = await collateralPool.totalCollateral();
            collateral = maxBN(collateral, maxBN(natToCoverCollateral, natToCoverFAsset));
        }
        await collateralPool.enter(0, withFassets, { value: collateral, from: account });
    }

    // n = N - r f p / q
    async function getNatRequiredToGetPoolCRBelow(cr: number) {
        const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
        const poolNatBalance = await collateralPool.totalCollateral();
        const backedFAsset = await assetManager.getFAssetsBackedByPool(agentVault.address);
        const required = poolNatBalance.sub(mulBips(backedFAsset.mul(priceMul), cr).div(priceDiv));
        return required.lt(new BN(0)) ? new BN(0) : required;
    }

    async function natToTokens(nat: BN) {
        const poolTokenSupply = await collateralPoolToken.totalSupply();
        const poolCollateral = await collateralPool.totalCollateral();
        return nat.mul(poolTokenSupply).div(poolCollateral);
    }

    async function tokensToNat(tokens: BN) {
        const poolTokenSupply = await collateralPoolToken.totalSupply();
        const poolCollateral = await collateralPool.totalCollateral();
        return tokens.mul(poolCollateral).div(poolTokenSupply);
    }

    async function getFAssetRequiredToNotSpoilCR(natShare: BN): Promise<BN> {
        const poolCR = await getPoolCRBIPS();
        const backedFAsset = await assetManager.getFAssetsBackedByPool(agentVault.address);
        const poolNatBalance = await collateralPool.totalCollateral();
        if (poolCR.gtn(exitCR)) {
            const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
            const _aux = priceDiv.mul(poolNatBalance.sub(natShare)).muln(MAX_BIPS).div(priceMul).divn(MAX_BIPS * exitCR);
            return backedFAsset.gt(_aux) ? backedFAsset.sub(_aux) : toBN(0);
        } else {
            return backedFAsset.mul(natShare).div(poolNatBalance);
        }
    }

    describe("setting contract variables", async () => {

        it("should fail at calling setPoolToken from non asset manager", async () => {
            const prms = collateralPool.setPoolToken(collateralPoolToken.address);
            await expectRevert(prms, "only asset manager");
        });

        it("should fail at resetting pool token", async () => {
            const payload = collateralPool.contract.methods.setPoolToken(collateralPoolToken.address).encodeABI();
            const prms = assetManager.callFunctionAt(collateralPool.address, payload);
            await expectRevert(prms, "pool token already set");
        });

        it("should fail at setting exit collateral ratio if conditions aren't met", async () => {
            const setTo = new BN(Math.floor(MAX_BIPS * topupCR));
            const payload = collateralPool.contract.methods.setExitCollateralRatioBIPS(setTo).encodeABI();
            const prms = assetManager.callFunctionAt(collateralPool.address, payload);
            await expectRevert(prms, "value too low");
        });

        it("should correctly set exit collateral ratio", async () => {
            const setTo = BN_ONE.addn(Math.floor(MAX_BIPS * topupCR));
            const payload = collateralPool.contract.methods.setExitCollateralRatioBIPS(setTo).encodeABI();
            await assetManager.callFunctionAt(collateralPool.address, payload);
            const newExitCollateralCR = await collateralPool.exitCollateralRatioBIPS();
            assertEqualBN(newExitCollateralCR, setTo);
        });

        it("should fail at setting topup collateral ratio if conditions aren't met", async () => {
            const setTo = new BN(Math.floor(MAX_BIPS * exitCR));
            const payload = collateralPool.contract.methods.setTopupCollateralRatioBIPS(setTo).encodeABI();
            const prms = assetManager.callFunctionAt(collateralPool.address, payload);
            await expectRevert(prms, "value too high");
        });

        it("should correctly set topup collateral ratio", async () => {
            const setTo = new BN(Math.floor(MAX_BIPS * exitCR)).sub(BN_ONE);
            const payload = collateralPool.contract.methods.setTopupCollateralRatioBIPS(setTo).encodeABI();
            await assetManager.callFunctionAt(collateralPool.address, payload);
            const newExitCollateralCR = await collateralPool.topupCollateralRatioBIPS();
            assertEqualBN(newExitCollateralCR, setTo);
        });

        it("should fail at setting topup token discount if conditions aren't met", async () => {
            const payload = collateralPool.contract.methods.setTopupTokenPriceFactorBIPS(MAX_BIPS).encodeABI();
            const prms = assetManager.callFunctionAt(collateralPool.address, payload);
            await expectRevert(prms, "value too high");
        });

        it("should correctly set topup token discount", async () => {
            const setTo = new BN(MAX_BIPS).sub(BN_ONE);
            const payload = collateralPool.contract.methods.setTopupTokenPriceFactorBIPS(setTo).encodeABI();
            await assetManager.callFunctionAt(collateralPool.address, payload);
            const newExitCollateralCR = await collateralPool.topupTokenPriceFactorBIPS();
            assertEqualBN(newExitCollateralCR, setTo);
        });

        it("should upgrade wnat contract", async () => {
            // get some wnat to the collateral pool
            await collateralPool.enter(0, false, { value: ETH(100) });
            // upgrade the wnat contract
            const newWNat: ERC20MockInstance = await ERC20Mock.new("new wnat", "WNat");
            const payload = collateralPool.contract.methods.upgradeWNatContract(newWNat.address).encodeABI();
            await assetManager.callFunctionAt(collateralPool.address, payload);
            // check that wnat contract was updated
            const wnatFromCollateralPool = await collateralPool.wNat();
            expect(wnatFromCollateralPool).to.equal(newWNat.address);
            // check that funds were transferred correctly
            const fundsOnOldWNat = await wNat.balanceOf(collateralPool.address);
            assertEqualBN(fundsOnOldWNat, BN_ZERO);
            const fundsOnNewWNat = await newWNat.balanceOf(collateralPool.address);
            assertEqualBN(fundsOnNewWNat, ETH(100));
        });

        it("should upgrade wnat contract with old wnat contract", async () => {
            const payload = collateralPool.contract.methods.upgradeWNatContract(wNat.address).encodeABI();
            await assetManager.callFunctionAt(collateralPool.address, payload);
            const newWNat = await collateralPool.wNat();
            expect(newWNat).to.equal(wNat.address);
        });

    });

    // to test whether users can send debt tokens
    describe("collateral pool token tests", async () => {

        it("should fetch the pool token", async () => {
            expect(await collateralPool.poolToken()).to.equal(collateralPoolToken.address);
        });

        it("should fetch no tokens of a new account", async () => {
            const tokens = await collateralPoolToken.transferableBalanceOf(accounts[0]);
            assertEqualBN(tokens, BN_ZERO);
        });

        it("should not be able to send locked tokens", async () => {
            // account0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(100) });
            // pool gets fees
            await givePoolFAssetFees(ETH(10));
            // account1 enters the pool with some debt
            await fAsset.mintAmount(accounts[1], ETH(1));
            await fAsset.approve(collateralPool.address, ETH(1), { from: accounts[1] });
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
            await fAsset.approve(collateralPool.address, ETH(1), { from: accounts[1] });
            await collateralPool.enter(ETH(1), false, { value: ETH(100), from: accounts[1] });
            // account1 sends all his free tokens to another account
            const freeTokensOfUser1 = await collateralPoolToken.transferableBalanceOf(accounts[1]);
            await collateralPoolToken.transfer(accounts[2], freeTokensOfUser1, { from: accounts[1] });
            const freeTokensOfUser2 = await collateralPoolToken.transferableBalanceOf(accounts[2]);
            assertEqualBN(freeTokensOfUser2, freeTokensOfUser1);
            // account2 sends his tokens back to account1
            await collateralPoolToken.transfer(accounts[1], freeTokensOfUser1, { from: accounts[2] });
            const freeTokensOfUser1AfterTransfer = await collateralPoolToken.transferableBalanceOf(accounts[1]);
            assertEqualBN(freeTokensOfUser1AfterTransfer, freeTokensOfUser1);
        });

    });

    describe("entering collateral pool", async () => {

        // collateral pool now tracks its balance, so sending nat directly (without enter) is not allowed,
        // thus this test is deprecated
        it.skip("should lock entering if pool token supply is much larger than pool collateral", async () => {
            // enter the pool
            await collateralPool.enter(0, true, { value: ETH(1001) });
            // artificially burn pool collateral
            await wNat.burnAmount(collateralPool.address, ETH(1000));
            // check that entering is disabled
            const prms = collateralPool.enter(0, true, { value: MIN_NAT_TO_ENTER, from: accounts[1] });
            await expectRevert(prms, "pool nat balance too small");
        });

        it("should fail entering the pool with too little funds", async () => {
            const prms = collateralPool.enter(0, true, { value: MIN_NAT_TO_ENTER.sub(BN_ONE) });
            await expectRevert(prms, "amount of nat sent is too low");
        });

        it("should fail entering with f-assets that don't cover the one in a tokenless pool", async () => {
            await givePoolFAssetFees(ETH(10));
            const prms = collateralPool.enter(ETH(5), false, { value: MIN_NAT_TO_ENTER });
            await expectRevert(prms,
                "If pool has no tokens, but holds f-asset, you need to send at least f-asset worth of collateral");
        });

        it("should not enter the pool (with f-assets) with f-asset allowance set too small", async () => {
            // mint some tokens by accounts[1] entering the pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[1] });
            // pool gets f-asset fees
            await givePoolFAssetFees(ETH(10));
            // accounts[0] has to enter with some f-assets as there are tokens in the pool
            const prms = collateralPool.enter(0, true, { value: ETH(5), from: accounts[0] });
            await expectRevert(prms, "f-asset allowance too small");
        });

        it("should enter tokenless, f-assetless and natless pool", async () => {
            await collateralPool.enter(0, true, { value: ETH(10) });
            const tokens = await collateralPoolToken.transferableBalanceOf(accounts[0]);
            assertEqualBN(tokens, ETH(10));
            const tokenSupply = await collateralPoolToken.totalSupply();
            assertEqualBN(tokenSupply, ETH(10));
            const collateral = await wNat.balanceOf(collateralPool.address);
            assertEqualBN(collateral, ETH(10));
        });

        it("should not enter if token supply to nat balance is too small", async () => {
            await agentVault.enterPool(collateralPool.address, { value: ETH(1) });
            //Mint collateral pool tokens to increase total supply
            await impersonateContract(collateralPool.address, toBN(512526332000000000), accounts[0]);
            await collateralPoolToken.mint(accounts[12],ETH(10000), { from: collateralPool.address });
            await stopImpersonatingContract(collateralPool.address);
            const res = collateralPool.enter(0, true, { value: ETH(10) });
            await expectRevert(res, "pool nat balance too small");
        });

        it("should enter tokenless and f-assetless pool holding some collateral", async () => {
            // artificially make pool have no tokens but have collateral (this might not be possible with non-mocked asset manager)
            await agentVault.enterPool(collateralPool.address, { value: ETH(10) });
            const assetManagerPayout = collateralPool.contract.methods.payout(accounts[0], 0, ETH(10)).encodeABI();
            await assetManager.callFunctionAt(collateralPool.address, assetManagerPayout);
            assertEqualBN(await collateralPoolToken.totalSupply(), BN_ZERO);
            assertEqualBN(await wNat.balanceOf(collateralPool.address), ETH(10));
            await wNat.mintAmount(accounts[0], ETH(10));
            const prms = collateralPool.enter(0, true, { value: ETH(10).subn(1) });
            await expectRevert(prms,
                "if pool has no tokens, but holds collateral, you need to send at least that amount of collateral");
            await collateralPool.enter(0, true, { value: ETH(10) });
            assertEqualBN(await collateralPoolToken.transferableBalanceOf(accounts[0]), ETH(10));
            assertEqualBN(await collateralPoolToken.totalSupply(), ETH(10));
            assertEqualBN(await wNat.balanceOf(collateralPool.address), ETH(20));
            assertEqualBN(await collateralPool.totalCollateral(), ETH(20));
        });

        it("should enter tokenless, collateralless pool holding some f-assets", async () => {
            await givePoolFAssetFees(ETH(10));
            // calculate the amount of nat to send
            const { 0: assetPriceMul, 1: assetPriceDiv } = await assetManager.assetPriceNatWei();
            const natToEnter = ETH(10).mul(assetPriceMul).div(assetPriceDiv);
            // try to enter the pool with too little nat
            const prms = collateralPool.enter(0, true, { value: natToEnter.subn(1) });
            await expectRevert(prms, "If pool has no tokens, but holds f-asset, you need to send at least f-asset worth of collateral");
            // enter the pool
            await collateralPool.enter(0, true, { value: natToEnter });
            assertEqualBN(await collateralPool.fAssetFeesOf(accounts[0]), ETH(10));
        });

        it("should not require f-assets from users when entering f-assetless pool in any way", async () => {
            await collateralPool.enter(0, true, { value: ETH(1) });
            await collateralPool.enter(0, false, { value: ETH(1) });
            await collateralPool.enter(ETH(1), true, { value: ETH(1) });
            await collateralPool.enter(ETH(1), false, { value: ETH(1) });
        });

        it("should enter the topuped pool without f-assets, then pay off the debt", async () => {
            // mint required f-assets beforehand (topup cr should not change)
            const initialPoolFassets = ETH(5);
            await givePoolFAssetFees(initialPoolFassets);
            const fassets = initialPoolFassets.muln(2);
            await fAsset.mintAmount(accounts[0], fassets);
            await fAsset.approve(collateralPool.address, fassets);
            // externally topup the pool
            await getPoolAboveCR(accounts[1], false, topupCR);
            const initialTokens = await collateralPoolToken.balanceOf(accounts[1]);
            const initialNat = await wNat.balanceOf(collateralPool.address);
            // enter collateral pool without f-assets
            const nat = initialNat.muln(2);
            await collateralPool.enter(0, false, { value: nat });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            assertEqualBN(tokens, initialTokens.mul(nat).div(initialNat));
            const liquidTokens = await collateralPoolToken.transferableBalanceOf(accounts[0]);
            assertEqualBN(liquidTokens, BN_ZERO);
            const debtFassets = await collateralPool.fAssetFeeDebtOf(accounts[0]);
            assertEqualBN(debtFassets, initialPoolFassets.mul(tokens).div(initialTokens));
            const freeFassets = await collateralPool.fAssetFeesOf(accounts[0]);
            assertEqualBN(freeFassets, BN_ZERO);
            // pay off the f-asset debt
            await collateralPool.payFAssetFeeDebt(debtFassets, { from: accounts[0] });
            const tokensAfter = await collateralPoolToken.balanceOf(accounts[0]);
            assertEqualBN(tokensAfter, tokens);
            const liquidTokensAfter = await collateralPoolToken.transferableBalanceOf(accounts[0]);
            assertEqualBN(liquidTokensAfter, tokens);
            const debtFassetsAfter = await collateralPool.fAssetFeeDebtOf(accounts[0]);
            assertEqualBN(debtFassetsAfter, BN_ZERO);
            const freeFassetsAfter = await collateralPool.virtualFAssetOf(accounts[0]);
            assertEqualBN(freeFassetsAfter, debtFassets);
        });

    });

    describe("collateral pool topup discount", async () => {

        it("should make one user topup the pool", async () => {
            // mint some f-assets (target can be anyone)
            await fAsset.mintAmount(accounts[2], ETH(1));
            // account0 enters the pool
            const natToTopup = await getNatRequiredToGetPoolCRAbove(topupCR);
            const collateral = maxBN(natToTopup, MIN_NAT_TO_ENTER);
            await collateralPool.enter(0, true, { value: collateral });
            // check that discount tokens are calculated correctly
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const discountedTokens = applyTopupDiscount(natToTopup);
            const notDiscountedNat = collateral.sub(natToTopup);
            const notDiscountedTokens = notDiscountedNat.mul(discountedTokens).div(natToTopup);
            assertEqualBN(tokens, discountedTokens.add(notDiscountedTokens));
        });

        it("should make two users topup the pool", async () => {
            // mint some f-assets (target can be anyone)
            const { 0: priceMul, 1: priceDiv } = await assetManager.assetPriceNatWei();
            await fAsset.mintAmount(accounts[2], MIN_NAT_TO_ENTER.muln(2).mul(priceDiv).div(priceMul));
            // account0 enters the pool, but doesn't topup
            const collateralOfAccount0 = MIN_NAT_TO_ENTER;
            await collateralPool.enter(0, true, { value: collateralOfAccount0, from: accounts[0] });
            const tokensOfAccount0 = await collateralPoolToken.balanceOf(accounts[0]);
            assertEqualBN(tokensOfAccount0, applyTopupDiscount(collateralOfAccount0));
            // account1 enters the pool and topups
            const collateralOfAccount1 = await getNatRequiredToGetPoolCRAbove(topupCR);
            await collateralPool.enter(0, true, { value: collateralOfAccount1, from: accounts[1] });
            const tokensOfAccount1 = await collateralPoolToken.balanceOf(accounts[1]);
            const collateralAtTopupPrice = applyTopupDiscount(collateralOfAccount1);
            const tokensAtTopupPrice = tokensOfAccount0.mul(collateralAtTopupPrice).div(collateralOfAccount0);
            assertEqualBN(tokensOfAccount1, tokensAtTopupPrice);
        });

        it("should make sure that topup overflow gets the same amount of tokens as topuping exact amount, then entering with overflow", async () => {
            // mint some f-assets (target can be anyone)
            await fAsset.mintAmount(accounts[2], ETH(100));
            // enter the pool
            const natToTopup1 = await getNatRequiredToGetPoolCRAbove(topupCR);
            const collateral = maxBN(natToTopup1, MIN_NAT_TO_ENTER).muln(2);
            await collateralPool.enter(0, true, { value: collateral });
            // check that discount tokens are calculated correctly
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const topupTokens = applyTopupDiscount(natToTopup1);
            const overflowNat = collateral.sub(natToTopup1);
            const overflowTokens = overflowNat.mul(topupTokens).div(natToTopup1);
            assertEqualBN(tokens, topupTokens.add(overflowTokens));
            // reset the pool and try again with two enters
            await fAsset.burnAmount(accounts[2], ETH(100));
            await collateralPool.exit(tokens, TokenExitType.MINIMIZE_FEE_DEBT);
            await fAsset.mintAmount(accounts[2], ETH(100));
            // enter the pool the first time
            const natToTopup2 = await getNatRequiredToGetPoolCRAbove(topupCR);
            assertEqualBN(natToTopup2, natToTopup1);
            await collateralPool.enter(0, true, { value: natToTopup2 });
            const tokens1 = await collateralPoolToken.balanceOf(accounts[0]);
            assertEqualBN(tokens1, topupTokens);
            // enter the pool the second time
            await collateralPool.enter(0, true , { value: overflowNat });
            const tokens2 = await collateralPoolToken.balanceOf(accounts[0]);
            assertEqualBN(tokens2, topupTokens.add(overflowTokens));
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
            const prms = collateralPool.exit(tokens.add(BN_ONE), TokenExitType.MINIMIZE_FEE_DEBT);
            await expectRevert(prms, "token balance too low");
        });

        it("should require that amount of tokens left after exit is large enough", async () => {
            await collateralPool.enter(0, true, { value: MIN_TOKEN_SUPPLY_AFTER_EXIT });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const prms = collateralPool.exit(tokens.sub(MIN_TOKEN_SUPPLY_AFTER_EXIT).add(BN_ONE),
                TokenExitType.MAXIMIZE_FEE_WITHDRAWAL);
            await expectRevert(prms, "token supply left after exit is too low and non-zero");
        });

        it("should require nat share to be larger than 0", async () => {
            // to reach the state we use the topup discount
            await fAsset.mintAmount(collateralPool.address, ETH(1)); // for topup discount
            await collateralPool.enter(0, false, { value: ETH(10) });
            const prms = collateralPool.exit(BN_ONE, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL);
            await expectRevert(prms, "amount of sent tokens is too small");
        });

        it("should require nat share to leave enough pool non-zero collateral", async () => {
            await fAsset.mintAmount(collateralPool.address, ETH(10)); // for topup discount
            await collateralPool.enter(0, false, { value: MIN_NAT_BALANCE_AFTER_EXIT });
            const prms = collateralPool.exit(new BN(2), TokenExitType.KEEP_RATIO);
            await expectRevert(prms, "collateral left after exit is too low and non-zero");
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
            assertEqualBNWithError(fassets, initialFassets, BN_ONE);
            const nat = await wNat.balanceOf(accounts[0]);
            assertEqualBNWithError(nat, collateral, BN_ONE);
        });

        it("should collect all fees using the MAXIMIZE_FEE_WITHDRAWAL token exit type", async () => {
            // account0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            // collateral pool collects fees
            await givePoolFAssetFees(ETH(10));
            // account1 enters the pool with no f-assets
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            // collateral pool collects additional fees
            await givePoolFAssetFees(ETH(10));
            // account1 exits with fees using MAXIMIZE_FEE_WITHDRAWAL token exit type
            const allTokens = await collateralPoolToken.totalSupply();
            const freeTokens = await collateralPoolToken.transferableBalanceOf(accounts[1]);
            const virtualFassets = await getPoolVirtualFassets();
            const poolNatBalance = await wNat.balanceOf(collateralPool.address);
            await collateralPool.exit(freeTokens, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, { from: accounts[1] });
            // account1 should have earned wnat and all his f-asset fees
            const earnedFassets = await fAsset.balanceOf(accounts[1]);
            assertEqualBN(earnedFassets, virtualFassets.mul(freeTokens).div(allTokens));
            const earnedWnat = await wNat.balanceOf(accounts[1]);
            assertEqualBN(earnedWnat, poolNatBalance.mul(freeTokens).div(allTokens));
        });

        it("should eliminate all debt tokens using the MINIMIZE_FEE_DEBT token exit type", async () => {
            // account0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            // collateral pool collects fees
            await givePoolFAssetFees(ETH(10));
            // account1 enters the pool with no f-assets
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            // collateral pool collects additional fees
            await givePoolFAssetFees(ETH(10));
            // account1 exits with fees using MINIMIZE_FEE_DEBT token exit type
            const allTokens = await collateralPoolToken.totalSupply();
            const debtTokens = await collateralPoolToken.lockedBalanceOf(accounts[1]);
            const poolNatBalance = await wNat.balanceOf(collateralPool.address);
            await collateralPool.exit(debtTokens, TokenExitType.MINIMIZE_FEE_DEBT, { from: accounts[1] });
            // account1 should have 0 f-asset debt and earn appropriate wnat
            const debtFassets = await collateralPool.fAssetFeeDebtOf(accounts[1]);
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
            const debtTokensBefore = await collateralPoolToken.lockedBalanceOf(accounts[1]);
            const freeTokensBefore = await collateralPoolToken.transferableBalanceOf(accounts[1]);
            await collateralPool.exit(tokenBalance.div(new BN(2)), TokenExitType.KEEP_RATIO, { from: accounts[1] });
            // account1 should have kept the ratio between debt and free tokens
            const debtTokensAfter = await collateralPoolToken.lockedBalanceOf(accounts[1]);
            const freeTokensAfter = await collateralPoolToken.transferableBalanceOf(accounts[1]);
            // tokenBalance is a strictly maximum numeric error for below expression
            // this means that the ratio freeTokensBefore/debtTokensBefore is preserved
            // with error smaller than tokenBalance / (debtTokensBefore * debtTokensAfter)!
            // this is not a problem as debtTokensBefore + freeTokensBefore = tokenBalance,
            // so one of them must be >= tokenBalance / 2, thus worst case is one ratio
            // doubling and its inverse halving.
            assertEqualBNWithError(debtTokensBefore.mul(freeTokensAfter), debtTokensAfter.mul(freeTokensBefore), tokenBalance.sub(BN_ONE));
        });

    });

    describe("self-close exits", async () => {

        it("should require token share to be larger than 0", async () => {
            const prms = collateralPool.selfCloseExit(BN_ZERO, true, "");
            await expectRevert(prms, "token share is zero");
        });

        it("should require that the token balance is large enough", async () => {
            await collateralPool.enter(0, false, { value: ETH(10) });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const prms = collateralPool.selfCloseExit(tokens.add(BN_ONE), true, "");
            await expectRevert(prms, "token balance too low");
        });

        it("should require that amount of tokens left after exit is large enough", async () => {
            await collateralPool.enter(0, true, { value: MIN_TOKEN_SUPPLY_AFTER_EXIT });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const prms = collateralPool.selfCloseExit(tokens.sub(MIN_TOKEN_SUPPLY_AFTER_EXIT).add(BN_ONE),  true, "");
            await expectRevert(prms, "token supply left after exit is too low and non-zero");
        });

        it("should require nat share to be larger than 0", async () => {
            // to reach that state we use the topup discount
            await fAsset.mintAmount(collateralPool.address, ETH(1)); // for topup discount
            await collateralPool.enter(0, false, { value: ETH(10) });
            const prms = collateralPool.selfCloseExit(BN_ONE, true, "");
            await expectRevert(prms, "amount of sent tokens is too small");
        });

        it("should require nat share to leave enough pool non-zero collateral", async () => {
            await fAsset.mintAmount(collateralPool.address, ETH(10)); // for topup discount
            await collateralPool.enter(0, false, { value: MIN_NAT_BALANCE_AFTER_EXIT });
            const prms = collateralPool.selfCloseExit(new BN(2), true, "");
            await expectRevert(prms, "collateral left after exit is too low and non-zero");
        });

        it("should do a self-close exit where additional f-assets are not required", async () => {
            await givePoolFAssetFees(ETH(10));
            const natToEnter = await poolFAssetFeeNatValue();
            await collateralPool.enter(0, true, { value: natToEnter });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const resp = await collateralPool.selfCloseExit(tokens, true, "");
            await expectEvent.inTransaction(resp.tx, assetManager, "AgentRedemptionInCollateral");
        });

        it("should do a self-close exit where additional f-assets are required", async () => {
            await fAsset.mintAmount(accounts[0], ETH(100));
            await fAsset.approve(collateralPool.address, ETH(100));
            await collateralPool.enter(0, false, { value: ETH(10) });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const resp = await collateralPool.selfCloseExit(tokens, true, "");
            await expectEvent.inTransaction(resp.tx, assetManager, "AgentRedemptionInCollateral");
        });

        it("should do a self-close exit where additional f-assets are required but the allowance is not high enough", async () => {
            await fAsset.mintAmount(accounts[0], ETH(100));
            await fAsset.approve(collateralPool.address, ETH(99));
            await collateralPool.enter(0, false, { value: ETH(10) });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const prms = collateralPool.selfCloseExit(tokens, true, "");
            await expectRevert(prms, "allowance too small");
        });

        it("should do a self-close exit where there are no f-assets to redeem", async () => {
            await collateralPool.enter(0, true, { value: ETH(10) });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const resp = await collateralPool.selfCloseExit(tokens, true, "");
            await expectEvent.notEmitted.inTransaction(resp.tx, assetManager, "AgentRedemptionInCollateral");
            await expectEvent.notEmitted.inTransaction(resp.tx, assetManager, "AgentRedemption");
        });

        it("should do a self-close exit where redemption is done in underlying asset", async () => {
            await givePoolFAssetFees(ETH(100));
            const natToEnter = await poolFAssetFeeNatValue();
            await collateralPool.enter(0, true, { value: natToEnter });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const resp = await collateralPool.selfCloseExit(tokens, false, "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2");
            await expectEvent.inTransaction(resp.tx, assetManager, "AgentRedemption");
            assert((await getPoolCRBIPS()).gten(exitCR * MAX_BIPS))
        });

        it("should do a self-close exit where redemption fails to be done in underlying asset as it does not exceed one lot", async () => {
            await assetManager.setLotSize(ETH(100));
            await fAsset.mintAmount(accounts[0], ETH(100));
            await fAsset.increaseAllowance(collateralPool.address, ETH(100));
            await getPoolAboveCR(accounts[0], false, exitCR);
            const requiredFAssets = await collateralPool.fAssetRequiredForSelfCloseExit(ETH(1));
            const resp = await collateralPool.selfCloseExit(ETH(1), false, "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2");
            await expectEvent.inTransaction(resp.tx, assetManager, "AgentRedemptionInCollateral");
            assert((await getPoolCRBIPS()).gten(exitCR * MAX_BIPS))
            const fAssetBalance = await fAsset.balanceOf(accounts[0]);
            assertEqualBN(ETH(100).sub(fAssetBalance), requiredFAssets);
        });

        it("should do a self-close exit where some of the free f-assets are sent back", async () => {
            await givePoolFAssetFees(ETH(100));
            await getPoolAboveCR(accounts[0], false, exitCR + 1);
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            const collateral = await collateralPool.totalCollateral();
            const fAssetRequired = await getFAssetRequiredToNotSpoilCR(collateral.divn(2));
            const resp = await collateralPool.selfCloseExit(tokens.divn(2), true, "");
            await expectEvent.inTransaction(resp.tx, assetManager, "AgentRedemptionInCollateral");
            assert((await getPoolCRBIPS()).gten(exitCR * MAX_BIPS))
            const fAssetBalance = await fAsset.balanceOf(accounts[0]);
            assertEqualBNWithError(fAssetBalance, ETH(50).sub(fAssetRequired), BN_ONE);
        });

        it("should do a simple self-close exit with one user who has no f-asset debt", async () => {
            const collateral = ETH(100);
            const fassetBalanceBefore = ETH(100);
            await fAsset.mintAmount(accounts[0], fassetBalanceBefore);
            await fAsset.approve(collateralPool.address, fassetBalanceBefore);
            await collateralPool.enter(0, true, { value: collateral });
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            await collateralPool.selfCloseExit(tokens, true, "");
            const natBalance = await wNat.balanceOf(accounts[0]);
            assertEqualBN(natBalance, collateral);
            const fassetBalanceAfter = await fAsset.balanceOf(accounts[0]);
            // taking all collateral out of the pool and keeping CR the same
            // means you have to destroy all existing f-assets
            assertEqualBN(fassetBalanceAfter, BN_ZERO);
        });

        it("should do a simple self-close exit with one user who has f-asset debt", async () => {
            const collateral = ETH(1);
            // account1 enters the pool
            await collateralPool.enter(0, true, { value: ETH(1000), from: accounts[1] });
            // pool gets fees
            await fAsset.mintAmount(collateralPool.address, ETH(1));
            // account0 enters the pool with f-asset debt
            await collateralPool.enter(0, false, { value: collateral });
            await fAsset.mintAmount(accounts[0], ETH(10));
            await fAsset.approve(collateralPool.address, ETH(10));
            // account0 does self-close exit
            const tokens = await collateralPoolToken.balanceOf(accounts[0]);
            await collateralPool.selfCloseExit(tokens, true, "");
            // check that account0's added collateral was repaid
            const natBalance = await wNat.balanceOf(accounts[0]);
            assertEqualBN(natBalance, collateral);
        });

        it("should do an incomplete self-close exit (agent's max redeeemed f-assets is zero)", async () => {
            // mint some f-assets for minter to be able to do redemption
            await fAsset.mintAmount(accounts[0], ETH(100));
            await fAsset.approve(collateralPool.address, ETH(100));
            // user enters the pool
            await collateralPool.enter(0, false, { value: ETH(100), from: accounts[0] });
            // agent can only redeem 1 f-asset at a time
            await assetManager.setMaxRedemptionFromAgent(ETH(0));
            // user wants to redeem all tokens, which means he would need to
            // take all 100 f-assets out of circulation
            const exitCRBIPS = await collateralPool.exitCollateralRatioBIPS();
            const exitCR = exitCRBIPS.toNumber() / MAX_BIPS;
            const natToGetCRToExitCR = await getNatRequiredToGetPoolCRBelow(exitCR);
            const fAssetBefore = await fAsset.balanceOf(accounts[0]);
            const tokensBefore = await collateralPoolToken.balanceOf(accounts[0]);
            const resp = await collateralPool.selfCloseExit(tokensBefore, true, "");
            const fAssetAfter = await fAsset.balanceOf(accounts[0]);
            const tokensAfter = await collateralPoolToken.balanceOf(accounts[0]);
            expectEvent(resp, "IncompleteSelfCloseExit");
            assert((await getPoolCRBIPS()).gten(exitCR * MAX_BIPS))
            // account had been taken one f-asset
            assertEqualBN(fAssetBefore.sub(fAssetAfter), ETH(0));
            assertEqualBN(tokensBefore.sub(tokensAfter), await natToTokens(natToGetCRToExitCR));
            // user's withdrawal would leave pool's CR at 0, so he was only
            // allowed to withdraw the collateral that gets pool at exitCR
            assertEqualBN(await getPoolCRBIPS(), exitCRBIPS);
            const wNatBalance = await wNat.balanceOf(accounts[0]);
            assertEqualBN(wNatBalance, natToGetCRToExitCR);
        });

        it("should do an incomplete self-close exit, where agent's max redemption value is 0", async () => {
            // mint some f-assets for minter to be able to do redemption
            await fAsset.mintAmount(accounts[0], ETH(100));
            await fAsset.approve(collateralPool.address, ETH(100));
            // account0 enters the pool
            await collateralPool.enter(0, false, { value: ETH(100), from: accounts[0] });
            // agent cannot redeem any f-assets
            await assetManager.setMaxRedemptionFromAgent(ETH(0));
            // account0 wants to redeem all tokens, which means he would need to take all 100 f-assets out of circulation
            const exitCRBIPS = await collateralPool.exitCollateralRatioBIPS();
            const exitCR = exitCRBIPS.toNumber() / MAX_BIPS;
            const natToGetCRToExitCR = await getNatRequiredToGetPoolCRBelow(exitCR);
            const fAssetBefore = await fAsset.balanceOf(accounts[0]);
            const tokensBefore = await collateralPoolToken.balanceOf(accounts[0]);
            const resp = await collateralPool.selfCloseExit(tokensBefore, true, "");
            const tokensAfter = await collateralPoolToken.balanceOf(accounts[0]);
            const fAssetAfter = await fAsset.balanceOf(accounts[0]);
            expectEvent(resp, "IncompleteSelfCloseExit");
            // account had not been taken any f-assets
            assertEqualBN(fAssetBefore, fAssetAfter);
            // user's withdrawal leaves pool's CR at exitCR as beyond that f-assets would need to get burned/redeemed
            assertEqualBN(await getPoolCRBIPS(), exitCRBIPS);
            // user could withdraw only the collateral that gets pool at exitCR
            const wNatBalance = await wNat.balanceOf(accounts[0]);
            assertEqualBN(wNatBalance, natToGetCRToExitCR);
            // check that user's pool tokens evaluate to correct amount of collateral
            const userPoolNatBalance = await tokensToNat(tokensAfter);
            assertEqualBN(userPoolNatBalance, ETH(100).sub(natToGetCRToExitCR));
        });

        it("should fail self-close exit because agent's max redemption allows for too few f-assets to be redeemed", async () => {
            // mint some f-assets for minter to be able to do redemption
            await fAsset.mintAmount(accounts[0], ETH(100));
            await fAsset.approve(collateralPool.address, ETH(100));
            // account0 enters the pool
            await collateralPool.enter(0, false, { value: ETH(100), from: accounts[0] });
            // agent can redeem no f-assets in one transaction (this can actually never happen)
            await assetManager.setMaxRedemptionFromAgent(ETH(0));
            // pool's cr goes to exitCR (we should raise prices but we raise exitCR instead)
            const payload = await collateralPool.contract.methods.setExitCollateralRatioBIPS(await getPoolCRBIPS()).encodeABI();
            await assetManager.callFunctionAt(collateralPool.address, payload);
            // user wants to redeem all tokens, which means he would need to take all 100 f-assets out of circulation
            const account0Tokens = await collateralPoolToken.balanceOf(accounts[0]);
            // user cannot self-exit because pool being at exitCR requires redeemed f-assets, which agent cannot redeem,
            // as his max redemption is 0
            const prms = collateralPool.selfCloseExit(account0Tokens, true, "");
            await expectRevert(prms, "amount of sent tokens is too small after agent max redempton correction");
        });

        it("should do an incomplete self-close exit, where agent's max redeemed f-assets is non-zero but less than required", async () => {
            // mint some f-assets for minter to be able to do redemption
            await fAsset.mintAmount(accounts[0], ETH(100));
            await fAsset.approve(collateralPool.address, ETH(100));
            // user enters the pool
            await collateralPool.enter(0, false, { value: ETH(100), from: accounts[0] });
            // agent can only redeem 1 f-asset at a time
            await assetManager.setMaxRedemptionFromAgent(ETH(1));
            // user wants to redeem all tokens, which means he would need to take all 100 f-assets out of circulation
            const exitCRBIPS = await collateralPool.exitCollateralRatioBIPS();
            const natToGetCRToExitCR = await getNatRequiredToGetPoolCRBelow(exitCRBIPS.toNumber() / MAX_BIPS);
            const fAssetBefore = await fAsset.balanceOf(accounts[0]);
            const userTokens = await collateralPoolToken.balanceOf(accounts[0]);
            const resp = await collateralPool.selfCloseExit(userTokens, true, "");
            const fAssetAfter = await fAsset.balanceOf(accounts[0]);
            expectEvent(resp, "IncompleteSelfCloseExit");
            // account had been taken one f-asset
            assertEqualBN(fAssetBefore.sub(fAssetAfter), ETH(1));
            // user's withdrawal would leave pool's CR at 0, so he was only allowed to withdraw the collateral that
            // gets pool at exitCR and a bit more that was covered by the 1 redeemed f-asset
            assertEqualBN(await getPoolCRBIPS(), exitCRBIPS);
            // burning one f-asset gives user additional (exitCR * priceMul / priceDiv) released nat
            const { 0: assetPriceMul, 1: assetPriceDiv } = await assetManager.assetPriceNatWei();
            const natCoveringOneFAsset = ETH(1).mul(assetPriceMul).mul(exitCRBIPS).divn(MAX_BIPS).div(assetPriceDiv);
            assertEqualBN(await wNat.balanceOf(accounts[0]), natToGetCRToExitCR.add(natCoveringOneFAsset));
        });

        // this test describes a problem when agent's max redemption can cause a very unexpected error to a
        // user that tries to self-close exit with ALL of their collateral. This is a very unlikely scenario though
        it("should fail at doing an incomplete self-close exit, where agent's max redeemed f-assets reduce user's withdrawal by a microscopic amount", async () => {
            // mint some f-assets for minter to be able to do redemption
            await fAsset.mintAmount(accounts[0], ETH(100));
            await fAsset.approve(collateralPool.address, ETH(100));
            // user enters the pool
            await collateralPool.enter(0, false, { value: ETH(100), from: accounts[0] });
            // agent should be able to redeem a an amount of f-assets that is just a bit lower than required to
            const requiredFAssets = await getFAssetRequiredToNotSpoilCR(ETH(100));
            await assetManager.setMaxRedemptionFromAgent(requiredFAssets.subn(10));
            // user wants to redeem all tokens, but agent's max redemption forces him to leave a tiny amount of collateral
            const userTokens = await collateralPoolToken.balanceOf(accounts[0]);
            const tx = collateralPool.selfCloseExit(userTokens, true, "");
            await expectRevert(tx, "collateral left after exit is too low and non-zero");
        });

        it("should simulate a situation where agent's max redemption is lower than required but does not effect the spent collateral", async () => {
            // make f-asset cheaper than nat (it is required by this test)
            await assetManager.setAssetPriceNatWei(1, 100);
            // mint some f-assets for minter to be able to do redemption
            await fAsset.mintAmount(accounts[0], ETH(100));
            await fAsset.approve(collateralPool.address, ETH(100));
            // user enters the pool
            await collateralPool.enter(0, false, { value: ETH(100), from: accounts[0] });
            // agent should be able to redeem a an amount of f-assets that is just a bit lower than required to
            const requiredFAssets = await getFAssetRequiredToNotSpoilCR(ETH(100));
            await assetManager.setMaxRedemptionFromAgent(requiredFAssets.subn(1));
            // user can redeem all tokens, as agent's max redemption forces him to leave a tiny amount of collateral
            const userTokensBefore = await collateralPoolToken.balanceOf(accounts[0]);
            const resp = await collateralPool.selfCloseExit(userTokensBefore, true, "");
            const userTokensAfter = await collateralPoolToken.balanceOf(accounts[0]);
            expectEvent(resp, "IncompleteSelfCloseExit");
            await expectEvent.inTransaction(resp.tx, assetManager, "AgentRedemptionInCollateral");
            // check that all user's tokens were spent
            const incompleteSelfCloseExit = eventArgs(resp, "IncompleteSelfCloseExit");
            assertEqualBN(incompleteSelfCloseExit.burnedTokensWei, userTokensBefore);
            assertEqualBN(incompleteSelfCloseExit.redeemedFAssetUBA, requiredFAssets.subn(1));
            assertEqualBN(userTokensAfter, BN_ZERO);
            const agentRedemption = requiredEventArgsFrom(resp, assetManager, "AgentRedemptionInCollateral");
            // @ts-ignore
            assertEqualBN(agentRedemption._amountUBA, requiredFAssets.subn(1));
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
            await expectRevert(collateralPool.payFAssetFeeDebt(BN_ONE), "debt f-asset balance too small");
        });

        it("should fail at trying to pay f-asset debt with too low f-asset allowance", async () => {
            await givePoolFAssetFees(ETH(10));
            const natToEnterEmptyPool = await poolFAssetFeeNatValue();
            await collateralPool.enter(0, false, { value: natToEnterEmptyPool, from: accounts[0] });
            await collateralPool.enter(0, false, { value: MIN_NAT_TO_ENTER, from: accounts[1] });
            const debt = await collateralPool.fAssetFeeDebtOf(accounts[1]);
            await fAsset.mintAmount(accounts[1], debt);
            await fAsset.approve(collateralPool.address, debt.sub(BN_ONE), { from: accounts[1] });
            const prms = collateralPool.payFAssetFeeDebt(debt, { from: accounts[1] });
            await expectRevert(prms, "f-asset allowance too small");
        });

        it("should enter the pool accruing debt, then mint new debt to collect f-asset rewards", async () => {
            // first user enters pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[0] });
            // pool gets initial f-asset fees
            await givePoolFAssetFees(ETH(1));
            // second user enters pool
            await collateralPool.enter(0, false, { value: ETH(10), from: accounts[1] });
            // pool gets additional f-asset fees
            await givePoolFAssetFees(ETH(1));
            // account1 withdraws his share of fees from the pool
            const freeFassets = await collateralPool.fAssetFeesOf(accounts[1]);
            await collateralPool.withdrawFees(freeFassets, { from: accounts[1] });
            // check that user has collected his rewards
            const fassetReward = await fAsset.balanceOf(accounts[1]);
            assertEqualBN(fassetReward, freeFassets);
            // check that all his tokens are now locked
            const tokens = await collateralPoolToken.transferableBalanceOf(accounts[1]);
            assertEqualBN(tokens, BN_ZERO);
        });

        it("should enter the pool accruing debt, then pay them off", async () => {
            // give user some funds to pay off the debt later
            await fAsset.mintAmount(accounts[1], ETH(10));
            await fAsset.approve(collateralPool.address, ETH(10), { from: accounts[1] });
            // first user enters pool
            await collateralPool.enter(0, true, { value: ETH(10) });
            // pool gets initial f-asset fees
            await fAsset.mintAmount(collateralPool.address, ETH(1));
            // second user enters pool
            await collateralPool.enter(0, true, { value: ETH(10), from: accounts[1] });
            // accounts[1] pays off the debt
            const debt = await collateralPool.fAssetFeeDebtOf(accounts[1]);
            await collateralPool.payFAssetFeeDebt(debt, { from: accounts[1] });
            // check that the debt is zero
            const newdebt = await collateralPool.fAssetFeeDebtOf(accounts[1]);
            assertEqualBN(newdebt, BN_ZERO);
            // check that all his tokens are now unlocked
            const lockedTokens = await collateralPool.lockedTokensOf(accounts[1]);
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
                assertEqualBNWithError(wnat, nats[i], BN_ONE);
                const fassetBalance = await fAsset.balanceOf(accounts[i]);
                assertEqualBNWithError(fassetBalance, fassets[i], BN_ONE);
            }
        });

        it("should do a self-close exit with two users", async () => {
            const fassetBalanceOfAccount0 = ETH(2000);
            const fassetBalanceOfAccount1 = ETH(1000);
            await fAsset.mintAmount(accounts[0], fassetBalanceOfAccount0);
            await fAsset.mintAmount(accounts[1], fassetBalanceOfAccount1);
            await fAsset.approve(collateralPool.address, fassetBalanceOfAccount0, { from: accounts[0] });
            await fAsset.approve(collateralPool.address, fassetBalanceOfAccount1, { from: accounts[1] });
            // users enter the pool
            await collateralPool.enter(0, false, { value: ETH(100), from: accounts[0] });
            await collateralPool.enter(0, false, { value: ETH(100), from: accounts[1] });
            // account1 does self-close exit with all his tokens
            const cr0 = await getPoolCollaterals();
            const tokenShareOfAccount0 = await collateralPoolToken.balanceOf(accounts[0]);
            const fassetsRequiredFromAccount0 = await fassetsRequiredToKeepCR(tokenShareOfAccount0);
            let fAssetsBefore = await fAsset.totalSupply();
            const resp0 = await collateralPool.selfCloseExit(tokenShareOfAccount0, true, "", { from: accounts[0] });
            let fAssetsAfter = await fAsset.totalSupply();
            await expectEvent.inTransaction(resp0.tx, assetManager, "AgentRedemptionInCollateral", { _amountUBA: fassetsRequiredFromAccount0 });
            assertEqualBN(fAssetsBefore.sub(fAssetsAfter), fassetsRequiredFromAccount0); // f-assets were burned
            // account0 does self-close exit with one tenth of his tokens
            const cr1 = await getPoolCollaterals();
            const tokenShareOfAccount1 = (await collateralPoolToken.balanceOf(accounts[1])).div(new BN(10));
            const fassetsRequiredFromAccount1 = await fassetsRequiredToKeepCR(tokenShareOfAccount1);
            fAssetsBefore = await fAsset.totalSupply();
            const resp1 = await collateralPool.selfCloseExit(tokenShareOfAccount1, true, "", { from: accounts[1] });
            fAssetsAfter = await fAsset.totalSupply();
            await expectEvent.inTransaction(resp1.tx, assetManager, "AgentRedemptionInCollateral", { _amountUBA: fassetsRequiredFromAccount1 });
            assertEqualBN(fAssetsBefore.sub(fAssetsAfter), fassetsRequiredFromAccount1); // f-assets were burned
            const cr2 = await getPoolCollaterals();
            // check that pool's collateral ratio has stayed the same
            assertEqualBN(cr0[0].mul(cr1[1]), cr1[0].mul(cr0[1]));
            assertEqualBN(cr1[0].mul(cr2[1]), cr2[0].mul(cr1[1]));
            // note that collateral ratio could have increased, but here there were no free f-assets held by users,
            // so redeemed f-assets were exactly those necessary to preserve pool collateral ratio
        });

        it("should show that token value price drop via topup discount does not effect users' free f-assets", async () => {
            // account0 enters the pool
            await collateralPool.enter(0, true, { value: ETH(20), from: accounts[0] });
            // pool gets rewards (CR doesn't drop below topupCR)
            await fAsset.mintAmount(collateralPool.address, ETH(10));
            // account1 enters the pool with ETH(10) f-assets
            await fAsset.mintAmount(accounts[1], ETH(10));
            await fAsset.approve(collateralPool.address, ETH(10), { from: accounts[1] });
            await collateralPool.enter(ETH(10), false, { value: ETH(10), from: accounts[1] });
            const account1FreeFassetBefore = await collateralPool.fAssetFeesOf(accounts[1]);
            // a lot of f-assets get minted, dropping pool CR well below topupCR
            await fAsset.mintAmount(accounts[2], ETH(10000));
            // account2 enters the pool buying up many tokens at topup discount (simulate pool token price drop)
            await fAsset.approve(collateralPool.address, ETH(10000), { from: accounts[2] });
            await collateralPool.enter(0, true, { value: ETH(1000), from: accounts[2] });
            // check how much (free) f-assets does account1 have
            const account1FreeFassetAfter = await collateralPool.fAssetFeesOf(accounts[1]);
            assertEqualBNWithError(account1FreeFassetAfter, account1FreeFassetBefore, BN_ONE);
        });

    });

    describe("methods for pool liquidation through asset manager", async () => {

        it("should not receive any collateral during internalWithdraw = false", async () => {
            const prms = collateralPool.send(ETH(1));
            await expectRevert(prms, "only internal use");
        });

        it("should fail destroying a pool with issued tokens", async () => {
            await collateralPool.enter(0, false, { value: ETH(1) });
            const payload = collateralPool.contract.methods.destroy(agent).encodeABI();
            const prms = assetManager.callFunctionAt(collateralPool.address, payload);
            await expectRevert(prms, "cannot destroy a pool with issued tokens");
        });

        it("should fail destroying a pool with collateral", async () => {
            // give some collateral using mock airdrop
            const mockAirdrop = await MockContract.new();
            await mockAirdrop.givenAnyReturnUint(ETH(1));
            await collateralPool.claimAirdropDistribution(mockAirdrop.address, 1, { from: agent });
            // destroy
            const payload = collateralPool.contract.methods.destroy(agent).encodeABI();
            const prms = assetManager.callFunctionAt(collateralPool.address, payload);
            await expectRevert(prms, "cannot destroy a pool holding collateral");
        });

        it("should fail at destroying a pool holding f-assets", async () => {
            await givePoolFAssetFees(ETH(1));
            const payload = collateralPool.contract.methods.destroy(agent).encodeABI();
            const prms = assetManager.callFunctionAt(collateralPool.address, payload);
            await expectRevert(prms, "cannot destroy a pool holding f-assets");
        });

        it("should destroy the pool (without nat balances)", async () => {
            // mint untracked f-assets, wNat and send nat to pool
            await wNat.mintAmount(collateralPool.address, ETH(1));
            await fAsset.mintAmount(collateralPool.address, ETH(2));
            // destroy through asset manager
            const payload = collateralPool.contract.methods.destroy(agent).encodeABI();
            await assetManager.callFunctionAt(collateralPool.address, payload);
            // check that funds were transacted correctly
            assertEqualBN(await wNat.balanceOf(collateralPool.address), BN_ZERO);
            assertEqualBN(await fAsset.balanceOf(collateralPool.address), BN_ZERO);
            assertEqualBN(await wNat.balanceOf(agent), ETH(1));
            assertEqualBN(await fAsset.balanceOf(agent), ETH(2));
        });

        it("should destroy the pool (with nat balance)", async () => {
            // send nat to contract
            await transferWithSuicide(ETH(3), accounts[0], collateralPool.address);
            // destroy through asset manager
            const natBefore = new BN(await web3.eth.getBalance(agent));
            const payload = collateralPool.contract.methods.destroy(agent).encodeABI();
            await assetManager.callFunctionAt(collateralPool.address, payload);
            const natAfter = new BN(await web3.eth.getBalance(agent));
            // check that funds were transacted correctly
            assert.equal(await web3.eth.getBalance(collateralPool.address), "0");
            assertEqualBN(natAfter.sub(natBefore), ETH(3));
        });

        it("should try destroying the pool, but fail because nat cannot be sent to receiver", async () => {
            // send nat to contract
            await transferWithSuicide(ETH(3), accounts[0], collateralPool.address);
            // destroy through asset manager (note that collateral pool has receive fucntion disabled)
            const payload = collateralPool.contract.methods.destroy(collateralPool.address).encodeABI();
            const prms = assetManager.callFunctionAt(collateralPool.address, payload);
            await expectRevert(prms, "transfer failed");
        });

        it("should payout collateral from collateral pool", async () => {
            // agentVault enters the pool
            await agentVault.enterPool(collateralPool.address, { value: ETH(100) });
            const agentVaultTokensBeforePayout = await collateralPoolToken.balanceOf(agentVault.address);
            // force payout from asset manager
            const collateralPayoutPayload = collateralPool.contract.methods.payout(accounts[0], ETH(1), ETH(1)).encodeABI();
            await assetManager.callFunctionAt(collateralPool.address, collateralPayoutPayload);
            // check that account0 has received specified wNat
            const natOfAccount0 = await wNat.balanceOf(accounts[0]);
            assertEqualBN(natOfAccount0, ETH(1));
            // check that tokens were slashed accordingly
            const agentTokensAfterPayout = await collateralPoolToken.balanceOf(agentVault.address);
            assertEqualBN(agentTokensAfterPayout, agentVaultTokensBeforePayout.sub(ETH(1)));
        });
    });

    describe("distribution claiming and wnat delegation", async () => {

        it("should fail claiming airdropped distribution from non-agent address", async () => {
            const distributionToDelegators: DistributionToDelegatorsInstance = await DistributionToDelegators.new(wNat.address);
            const prms = collateralPool.claimAirdropDistribution(distributionToDelegators.address, 0, { from: accounts[0] });
            await expectRevert(prms, "only agent");
        });

        it("should claim airdropped distribution", async () => {
            const distributionToDelegators: DistributionToDelegatorsInstance = await DistributionToDelegators.new(wNat.address);
            await wNat.mintAmount(distributionToDelegators.address, ETH(1));
            await collateralPool.claimAirdropDistribution(distributionToDelegators.address, 0, { from: agent });
            const collateralPoolBalance = await wNat.balanceOf(collateralPool.address);
            assertEqualBN(collateralPoolBalance, ETH(1));
        });

        it("should fail opting out of airdrop from non-agent address", async () => {
            const distributionToDelegators: DistributionToDelegatorsInstance = await DistributionToDelegators.new(wNat.address);
            const prms = collateralPool.optOutOfAirdrop(distributionToDelegators.address, { from: accounts[0] });
            await expectRevert(prms, "only agent");
        });

        it("should opt out of airdrop", async () => {
            const distributionToDelegators: DistributionToDelegatorsInstance = await DistributionToDelegators.new(wNat.address);
            const resp = await collateralPool.optOutOfAirdrop(distributionToDelegators.address, { from: agent });
            await expectEvent.inTransaction(resp.tx, distributionToDelegators, "OptedOutOfAirdrop",  { account: collateralPool.address });
        });

        it("should claim rewards from ftso reward manager", async () => {
            const distributionToDelegators: DistributionToDelegatorsInstance = await DistributionToDelegators.new(wNat.address);
            await wNat.mintAmount(distributionToDelegators.address, ETH(1));
            await collateralPool.claimFtsoRewards(distributionToDelegators.address, 0, { from: agent });
            const collateralPoolBalance = await wNat.balanceOf(collateralPool.address);
            assertEqualBN(collateralPoolBalance, ETH(1));
        });

    });

    describe("ERC-165 interface identification for Collateral Pool", () => {
        it("should properly respond to supportsInterface", async () => {
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as any) as any as IERC165Contract;
            const ICollateralPool = artifacts.require("ICollateralPool");
            const IICollateralPool= artifacts.require("IICollateralPool");
            const iERC165 = await IERC165.at(agentVault.address);
            const iCollateralPool = await ICollateralPool.at(collateralPool.address);
            const iiCollateralPool = await IICollateralPool.at(collateralPool.address);
            assert.isTrue(await collateralPool.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await collateralPool.supportsInterface(erc165InterfaceId(iCollateralPool.abi)));
            assert.isTrue(await collateralPool.supportsInterface(erc165InterfaceId(iiCollateralPool.abi, [iCollateralPool.abi])));
            assert.isFalse(await collateralPool.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });

    describe("ERC-165 interface identification for CollateralPoolFactory", () => {
        it("should properly respond to supportsInterface", async () => {
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as any) as any as IERC165Contract;
            const ICollateralPoolFactory = artifacts.require("ICollateralPoolFactory");
            const iERC165 = await IERC165.at(contracts.collateralPoolFactory.address);
            const iCollateralPoolFactory = await ICollateralPoolFactory.at(contracts.collateralPoolFactory.address);
            assert.isTrue(await contracts.collateralPoolFactory.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await contracts.collateralPoolFactory.supportsInterface(erc165InterfaceId(iCollateralPoolFactory.abi)));
            assert.isFalse(await contracts.collateralPoolFactory.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });

    describe("ERC-165 interface identification for CollateralPoolTokenFactory", () => {
        it("should properly respond to supportsInterface", async () => {
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as any) as any as IERC165Contract;
            const ICollateralPoolTokenFactory = artifacts.require("ICollateralPoolTokenFactory");
            const iERC165 = await IERC165.at(contracts.collateralPoolTokenFactory.address);
            const iCollateralPoolTokenFactory = await ICollateralPoolTokenFactory.at(contracts.collateralPoolTokenFactory.address);
            assert.isTrue(await contracts.collateralPoolTokenFactory.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await contracts.collateralPoolTokenFactory.supportsInterface(erc165InterfaceId(iCollateralPoolTokenFactory.abi)));
            assert.isFalse(await contracts.collateralPoolTokenFactory.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });

    describe("ERC-165 interface identification for Collateral Pool Token", () => {
        it("should properly respond to supportsInterface", async () => {
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as any) as any as IERC165Contract;
            const IERC20 = artifacts.require("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20" as any) as any as IERC20Contract;
            const ICollateralPoolToken = artifacts.require("ICollateralPoolToken");
            const iERC165 = await IERC165.at(collateralPoolToken.address);
            const iERC20 = await IERC20.at(collateralPoolToken.address);
            const iCollateralPoolToken = await ICollateralPoolToken.at(collateralPoolToken.address);
            assert.isTrue(await collateralPoolToken.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await collateralPoolToken.supportsInterface(erc165InterfaceId(iCollateralPoolToken.abi, [iERC20.abi])));
            assert.isTrue(await collateralPoolToken.supportsInterface(erc165InterfaceId(iERC20.abi)));
            assert.isFalse(await collateralPoolToken.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });

    describe("branch tests", () => {
        it("random address shouldn't be able to set exit collateral RatioBIPS", async () => {
            const setTo = BN_ONE.addn(Math.floor(10_000 * topupCR));
            const res = collateralPool.setExitCollateralRatioBIPS(setTo, { from: accounts[12] });
            await expectRevert(res, "only asset manager");
        });

        it("random address shouldn't be able to set topup collateral ratio BIPS", async () => {
            const setTo = new BN(Math.floor(10_000 * exitCR)).sub(BN_ONE);
            const res = collateralPool.setTopupCollateralRatioBIPS(setTo, { from: accounts[12] });
            await expectRevert(res, "only asset manager");
        });

        it("random address shouldn't be able to set topup token price factor BIPS", async () => {
            const setTo = new BN(10_000).sub(BN_ONE);
            const res = collateralPool.setTopupTokenPriceFactorBIPS(setTo, { from: accounts[12] });
            await expectRevert(res, "only asset manager");
        });

        it("random address shouldn't be able to mint collateral pool tokens", async () => {
            let res = collateralPoolToken.mint(accounts[12],ETH(10000), { from: accounts[5] });
            await expectRevert(res, "only collateral pool");
        });

        it("random address shouldn't be able to burn collateral pool tokens", async () => {
            let res = collateralPoolToken.burn(accounts[12],ETH(1), { from: accounts[5] });
            await expectRevert(res, "only collateral pool");
        });

        it("random address shouldn't be able to destroy collateral pool token", async () => {
            let res = collateralPoolToken.destroy(accounts[12], { from: accounts[5] });
            await expectRevert(res, "only collateral pool");
        });

        it("random address shouldn't be able to deposit fasset fees", async () => {
            let res = collateralPool.fAssetFeeDeposited(ETH(1), { from: accounts[5] });
            await expectRevert(res, "only asset manager");
        });

        it("random address shouldn't be able to destory collateral pool", async () => {
            let res = collateralPool.destroy(accounts[5], { from: accounts[5] });
            await expectRevert(res, "only asset manager");
        });

        it("random address shouldn't be able to payout", async () => {
            let res = collateralPool.payout(accounts[5], toWei(1), toWei(1), { from: accounts[5] });
            await expectRevert(res, "only asset manager");
        });

        it("random address shouldn't be able to upgrade wNat contract", async () => {
            const newWNat: ERC20MockInstance = await ERC20Mock.new("new wnat", "WNat");
            let res = collateralPool.upgradeWNatContract(newWNat.address, { from: accounts[5] });
            await expectRevert(res, "only asset manager");
        });

        it("random address shouldn't be able to claim rewards from ftso reward manager", async () => {
            const distributionToDelegators: DistributionToDelegatorsInstance = await DistributionToDelegators.new(wNat.address);
            await wNat.mintAmount(distributionToDelegators.address, ETH(1));
            let res = collateralPool.claimFtsoRewards(distributionToDelegators.address, 0, { from: accounts[5] });
            await expectRevert(res, "only agent");
        });

        it("random addresses shouldn't be able to set delegations", async () => {
            const res = collateralPool.delegate([accounts[2]], [5_000], { from: accounts[5] });
            await expectRevert(res, "only agent");
        });

        it("random address shouldn't be able to undelegate all", async () => {
            const res = collateralPool.undelegateAll({ from: accounts[5] });
            await expectRevert(res, "only agent");
        });

        it("random address shouldn't be able to revoke delegation at block", async () => {
            const blockNumber = await web3.eth.getBlockNumber();
            const res = collateralPool.revokeDelegationAt(accounts[2], blockNumber, { from: accounts[5] });
            await expectRevert(res, "only agent");
        });

        it("random address shouldn't be able to delegate governance", async () => {
            const res = collateralPool.delegateGovernance(accounts[2], { from: accounts[5] });
            await expectRevert(res, "only agent");
        });

        it("random address shouldn't be able to undelegate governance", async () => {
            const res = collateralPool.undelegateGovernance({ from: accounts[5] });
            await expectRevert(res, "only agent");
        });

        it("random address shouldn't be able to set auto claiming", async () => {
            const contract = await MockContract.new();
            const res = collateralPool.setAutoClaiming(contract.address, [accounts[2]], { from: accounts[2] });
            await expectRevert(res, "only agent");
        });

        it("should set auto claiming", async () => {
            const contract = await MockContract.new();
            await collateralPool.setAutoClaiming(contract.address, [accounts[2]], { from: agent });
        });

    });
});
