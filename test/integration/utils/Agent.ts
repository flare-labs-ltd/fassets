import { time } from "@openzeppelin/test-helpers";
import { AgentSetting, AgentSettings, AgentStatus } from "../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../lib/fasset/PaymentReference";
import { IBlockChainWallet } from "../../../lib/underlying-chain/interfaces/IBlockChainWallet";
import { EventArgs } from "../../../lib/utils/events/common";
import { checkEventNotEmited, eventArgs, filterEvents, findRequiredEvent, requiredEventArgs } from "../../../lib/utils/events/truffle";
import { BN_ZERO, BNish, MAX_BIPS, maxBN, randomAddress, requireNotNull, toBN } from "../../../lib/utils/helpers";
import { web3DeepNormalize } from "../../../lib/utils/web3normalize";
import { AgentVaultInstance, CollateralPoolInstance, CollateralPoolTokenInstance } from "../../../typechain-truffle";
import { CollateralReserved, LiquidationEnded, RedemptionDefault, RedemptionFinished, RedemptionPaymentFailed, RedemptionRequested, UnderlyingWithdrawalAnnounced } from "../../../typechain-truffle/AssetManager";
import { createTestAgentSettings } from "../../unit/fasset/test-settings";
import { MockChain, MockChainWallet, MockTransactionOptionsWithFee } from "../../utils/fasset/MockChain";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { AssetContext, AssetContextClient } from "./AssetContext";
import { Minter } from "./Minter";
import { AgentInfo } from "../../../lib/fasset/AssetManagerTypes";
import { AgentCollateral } from "../../utils/fasset/AgentCollateral";

const AgentVault = artifacts.require('AgentVault');
const CollateralPool = artifacts.require('CollateralPool');
const CollateralPoolToken = artifacts.require('CollateralPoolToken');

export type CheckAgentInfo = { [K in keyof AgentInfo]?: AgentInfo[K] extends BN ? BNish : AgentInfo[K] }
    & { actualUnderlyingBalance?: BNish };

export const CHECK_DEFAULTS: CheckAgentInfo = {
    status: AgentStatus.NORMAL, mintedUBA: 0, reservedUBA: 0, redeemingUBA: 0,
    announcedClass1WithdrawalWei: 0, announcedPoolTokensWithdrawalWei: 0, announcedUnderlyingWithdrawalId: 0
};

export class Agent extends AssetContextClient {
    constructor(
        context: AssetContext,
        public ownerColdAddress: string,
        public agentVault: AgentVaultInstance,
        public collateralPool: CollateralPoolInstance,
        public collateralPoolToken: CollateralPoolTokenInstance,
        public wallet: IBlockChainWallet,
        public settings: AgentSettings,
    ) {
        super(context);
    }

    vaultAddress = this.agentVault.address;
    underlyingAddress = this.settings.underlyingAddressString;

    class1Token = requireNotNull(Object.values(this.context.stablecoins).find(token => token.address === this.settings.class1CollateralToken));
    class1Collateral = requireNotNull(this.context.collaterals.find(c => c.token === this.settings.class1CollateralToken));

    static coldToHotOwnerAddress: Map<string, string> = new Map();
    static hotToColdOwnerAddress: Map<string, string> = new Map();

    static changeHotAddress(coldAddress: string, hotAddress: string) {
        Agent.coldToHotOwnerAddress.set(coldAddress, hotAddress);
        Agent.hotToColdOwnerAddress.set(hotAddress, coldAddress);
    }

    static getColdAddress(address: string) {
        return this.hotToColdOwnerAddress.get(address) ?? address;
    }

    static getHotAddress(address: string) {
        return this.coldToHotOwnerAddress.get(address) ?? address;
    }

    get ownerHotAddress() {
        return Agent.getHotAddress(this.ownerColdAddress);
    }

    static async createTest(ctx: AssetContext, ownerAddress: string, underlyingAddress: string, options?: Partial<AgentSettings>) {
        if (!(ctx.chain instanceof MockChain)) assert.fail("only for mock chains");
        // mint some funds on underlying address (just enough to make EOA proof)
        if (ctx.chainInfo.requireEOAProof) {
            ctx.chain.mint(underlyingAddress, ctx.chain.requiredFee.addn(1));
        }
        // create mock wallet
        const wallet = new MockChainWallet(ctx.chain);
        // complete settings
        const settings = createTestAgentSettings(underlyingAddress, options?.class1CollateralToken ?? ctx.usdc.address, options);
        return await Agent.create(ctx, ownerAddress, wallet, settings);
    }

    static async create(ctx: AssetContext, ownerAddress: string, wallet: IBlockChainWallet, settings: AgentSettings) {
        // create and prove transaction from underlyingAddress if EOA required
        if (ctx.chainInfo.requireEOAProof) {
            const underlyingAddress = settings.underlyingAddressString;
            const txHash = await wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(ownerAddress));
            if (ctx.chain.finalizationBlocks > 0) {
                await ctx.waitForUnderlyingTransactionFinalization(undefined, txHash);
            }
            const proof = await ctx.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
            await ctx.assetManager.proveUnderlyingAddressEOA(proof, { from: ownerAddress });
        }
        // create agent
        const response = await ctx.assetManager.createAgent(web3DeepNormalize(settings), { from: ownerAddress });
        // extract agent vault address from AgentCreated event
        const args = requiredEventArgs(response, 'AgentCreated');
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(args.agentVault);
        // get collateral pool
        const collateralPool = await CollateralPool.at(args.collateralPool);
        // get pool token
        const poolTokenAddress = await collateralPool.poolToken();
        const collateralPoolToken = await CollateralPoolToken.at(poolTokenAddress);
        // create object
        const ownerColdAddress = Agent.getColdAddress(ownerAddress);
        return new Agent(ctx, ownerColdAddress, agentVault, collateralPool, collateralPoolToken, wallet, settings);
    }

    async changeSettings(changes: Record<AgentSetting, BNish>) {
        let validAt = BN_ZERO;
        for (const [name, value] of Object.entries(changes)) {
            const res = await this.assetManager.announceAgentSettingUpdate(this.vaultAddress, name, value, { from: this.ownerHotAddress });
            const announcement = requiredEventArgs(res, 'AgentSettingChangeAnnounced');
            validAt = maxBN(validAt, toBN(announcement.validAt));
        }
        if (validAt.isZero()) return;   // no execute needed
        await time.increaseTo(validAt);
        for (const [name, value] of Object.entries(changes)) {
            return await this.assetManager.executeAgentSettingUpdate(this.vaultAddress, name, { from: this.ownerHotAddress });
        }
    }

    async depositClass1Collateral(amountTokenWei: BNish) {
        await this.class1Token.mintAmount(this.ownerHotAddress, amountTokenWei);
        await this.class1Token.approve(this.agentVault.address, amountTokenWei, { from: this.ownerHotAddress });
        return await this.agentVault.depositCollateral(this.class1Token.address, amountTokenWei, { from: this.ownerHotAddress });
    }

    // adds pool collateral and agent pool tokens
    async buyCollateralPoolTokens(amountNatWei: BNish) {
        return await this.agentVault.buyCollateralPoolTokens({ from: this.ownerHotAddress, value: toBN(amountNatWei) });
    }

    async hasLiquidationEnded(tx: Truffle.TransactionResponse<any>) {
        // const tr = await web3.eth.getTransaction(res.tx);
        // const res2 = await this.assetManager.getPastEvents('LiquidationEnded', { fromBlock: tr.blockNumber!, toBlock: tr.blockNumber!, filter: { transactionHash: res.tx } })
        // return res2.length > 0 ? (res2[0] as any).args as EventArgs<LiquidationEnded> : undefined;
    }

    async makeAvailable() {
        const res = await this.assetManager.makeAgentAvailable(this.vaultAddress, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'AgentAvailable');
    }

    async depositCollateralsAndMakeAvailable(class1Collateral: BNish, poolCollateral: BNish) {
        await this.depositClass1Collateral(class1Collateral);
        await this.buyCollateralPoolTokens(poolCollateral);
        await this.makeAvailable();
    }

    async announceExitAvailable() {
        const res = await this.assetManager.announceExitAvailableAgentList(this.vaultAddress, { from: this.ownerHotAddress });
        const args = requiredEventArgs(res, 'AvailableAgentExitAnnounced');
        assert.equal(args.agentVault, this.vaultAddress);
        return args.exitAllowedAt;
    }

    async exitAvailable() {
        const res = await this.assetManager.exitAvailableAgentList(this.vaultAddress, { from: this.ownerHotAddress });
        const args = requiredEventArgs(res, 'AvailableAgentExited');
        assert.equal(args.agentVault, this.vaultAddress);
    }

    async exitAndDestroy(collateral: BNish) {
        // exit available
        const exitAllowedAt = await this.announceExitAvailable();
        await time.increaseTo(exitAllowedAt);
        await this.exitAvailable();
        // withdraw pool fees
        const poolFeeBalance = await this.poolFeeBalance();
        const ownerFAssetBalance = await this.fAsset.balanceOf(this.ownerHotAddress);
        await this.withdrawPoolFees(poolFeeBalance);
        const ownerFAssetBalanceAfter = await this.fAsset.balanceOf(this.ownerHotAddress);
        // check that we recived exactly the agent vault's fees in fasset
        assertWeb3Equal(await this.poolFeeBalance(), 0);
        assertWeb3Equal(ownerFAssetBalanceAfter.sub(ownerFAssetBalance), poolFeeBalance);
        // self close all received pool fees - otherwise we cannot withdraw all pool collateral
        await this.selfClose(poolFeeBalance);
        // nothing must be minted now
        const info = await this.getAgentInfo();
        assertWeb3Equal(info.mintedUBA, 0);
        // redeem pool tokens to empty the pool (this only works in tests where there are no other pool token holders)
        const poolTokenBalance = await this.poolTokenBalance();
        const { withdrawalAllowedAt } = await this.announcePoolTokenRedemption(poolTokenBalance);
        await time.increaseTo(withdrawalAllowedAt);
        await this.redeemCollateralPoolTokens(poolTokenBalance);
        // destroy (no need to pool out class1 collateral first, it will be withdrawn automatically during destroy)
        const destroyAllowedAt = await this.announceDestroy();
        await time.increaseTo(destroyAllowedAt);
        const ownerClass1Balance = await this.class1Token.balanceOf(this.ownerHotAddress);
        await this.destroy();
        const ownerClass1BalanceAfterDestroy = await this.class1Token.balanceOf(this.ownerHotAddress);
        assertWeb3Equal(ownerClass1BalanceAfterDestroy.sub(ownerClass1Balance), collateral);
    }

    async announceClass1CollateralWithdrawal(amountWei: BNish) {
        await this.assetManager.announceClass1CollateralWithdrawal(this.vaultAddress, amountWei, { from: this.ownerHotAddress });
    }

    async withdrawClass1Collateral(amountWei: BNish) {
        return await this.agentVault.withdrawCollateral(this.class1Token.address, amountWei, this.ownerHotAddress, { from: this.ownerHotAddress });
    }

    async poolTokenBalance() {
        return await this.collateralPoolToken.balanceOf(this.vaultAddress);
    }

    async announcePoolTokenRedemption(amountWei: BNish) {
        const res = await this.assetManager.announceAgentPoolTokenRedemption(this.vaultAddress, amountWei, { from: this.ownerHotAddress });
        const args = requiredEventArgs(res, 'PoolTokenRedemptionAnnounced');
        assert.equal(args.agentVault, this.vaultAddress);
        return args;
    }

    async redeemCollateralPoolTokens(amountWei: BNish) {
        return await this.agentVault.redeemCollateralPoolTokens(amountWei, this.ownerHotAddress, { from: this.ownerHotAddress });
    }

    async withdrawPoolFees(amountUBA: BNish) {
        await this.agentVault.withdrawPoolFees(amountUBA, this.ownerHotAddress, { from: this.ownerHotAddress });
    }

    async poolFeeBalance() {
        return await this.collateralPool.freeFassetOf(this.vaultAddress);
    }

    async announceDestroy() {
        const res = await this.assetManager.announceDestroyAgent(this.vaultAddress, { from: this.ownerHotAddress });
        const args = requiredEventArgs(res, 'AgentDestroyAnnounced');
        assert.equal(args.agentVault, this.vaultAddress);
        return args.destroyAllowedAt;
    }

    async destroy() {
        const res = await this.assetManager.destroyAgent(this.vaultAddress, this.ownerHotAddress, { from: this.ownerHotAddress });
        const args = requiredEventArgs(res, 'AgentDestroyed');
        assert.equal(args.agentVault, this.vaultAddress);
        return res;
    }

    async performTopupPayment(amount: BNish, mint: boolean = true, underlyingAddress: string = "someAddress") {
        if (mint) {
            if (!(this.chain instanceof MockChain)) assert.fail("only for mock chains");
            this.chain.mint(underlyingAddress, amount);
        }
        return await this.wallet.addTransaction(underlyingAddress, this.underlyingAddress, amount, PaymentReference.topup(this.agentVault.address));
    }

    async confirmTopupPayment(transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, null, this.underlyingAddress);
        await this.assetManager.confirmTopupPayment(proof, this.agentVault.address, { from: this.ownerHotAddress });
    }

    async announceUnderlyingWithdrawal() {
        const res = await this.assetManager.announceUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalAnnounced');
    }

    async performUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, amount: BNish, underlyingAddress: string = "someAddress") {
        return await this.wallet.addTransaction(this.underlyingAddress, underlyingAddress, amount, request.paymentReference);
    }

    async confirmUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, null);
        const res = await this.assetManager.confirmUnderlyingWithdrawal(proof, this.agentVault.address, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalConfirmed');
    }

    async cancelUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>) {
        const res = await this.assetManager.cancelUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalCancelled');
    }

    async performRedemptionPayment(request: EventArgs<RedemptionRequested>, options?: MockTransactionOptionsWithFee) {
        const paymentAmount = request.valueUBA.sub(request.feeUBA);
        return await this.performPayment(request.paymentAddress, paymentAmount, request.paymentReference, options);
    }

    async confirmActiveRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerHotAddress });
        findRequiredEvent(res, 'RedemptionFinished');
        return requiredEventArgs(res, 'RedemptionPerformed');
    }

    async confirmDefaultedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerHotAddress });
        findRequiredEvent(res, 'RedemptionFinished');
        checkEventNotEmited(res, 'RedemptionPerformed');
        checkEventNotEmited(res, 'RedemptionPaymentFailed');
        checkEventNotEmited(res, 'RedemptionPaymentBlocked');
    }

    async confirmFailedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string): Promise<[redemptionPaymentFailed: EventArgs<RedemptionPaymentFailed>, redemptionDefault: EventArgs<RedemptionDefault>]>  {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerHotAddress });
        findRequiredEvent(res, 'RedemptionFinished');
        return [requiredEventArgs(res, 'RedemptionPaymentFailed'), requiredEventArgs(res, 'RedemptionDefault')];
    }

    async confirmBlockedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerHotAddress });
        findRequiredEvent(res, 'RedemptionFinished');
        return requiredEventArgs(res, 'RedemptionPaymentBlocked');
    }

    async redemptionPaymentDefault(request: EventArgs<RedemptionRequested>) {
        const proof = await this.attestationProvider.proveReferencedPaymentNonexistence(
            request.paymentAddress,
            request.paymentReference,
            request.valueUBA.sub(request.feeUBA),
            request.lastUnderlyingBlock.toNumber(),
            request.lastUnderlyingTimestamp.toNumber());
        const res = await this.assetManager.redemptionPaymentDefault(proof, request.requestId, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'RedemptionDefault');
    }

    async finishRedemptionWithoutPayment(request: EventArgs<RedemptionRequested>): Promise<[redemptionFinished: EventArgs<RedemptionFinished>, redemptionDefault: EventArgs<RedemptionDefault>]> {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists();
        const res = await this.assetManager.finishRedemptionWithoutPayment(proof, request.requestId, { from: this.ownerHotAddress });
        return [eventArgs(res, 'RedemptionFinished'), eventArgs(res, "RedemptionDefault")];
    }

    // async getRedemptionPaymentDefaultValue(lots: BNish) {
    //     return this.context.convertAmgToNATWei(
    //         toBN(await this.context.convertLotsToAMG(lots))
    //             .mul(toBN(this.context.settings.redemptionDefaultFactorBIPS))
    //             .divn(10_000),
    //         await this.context.currentAmgToNATWeiPrice()
    //     );
    //     // TODO collateral share
    // }

    async executeMinting(crt: EventArgs<CollateralReserved>, transactionHash: string, minter?: Minter) {
        let sourceAddress: string;
        if (minter) {
            sourceAddress = minter.underlyingAddress;
        } else {
            const tx = await this.chain.getTransaction(transactionHash);
            sourceAddress = tx?.inputs[0][0]!;
        }
        const proof = await this.attestationProvider.provePayment(transactionHash, sourceAddress, this.underlyingAddress);
        const res = await this.assetManager.executeMinting(proof, crt.collateralReservationId, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async mintingPaymentDefault(crt: EventArgs<CollateralReserved>) {
        const proof = await this.attestationProvider.proveReferencedPaymentNonexistence(
            this.underlyingAddress,
            crt.paymentReference,
            crt.valueUBA.add(crt.feeUBA),
            crt.lastUnderlyingBlock.toNumber(),
            crt.lastUnderlyingTimestamp.toNumber());
        const res = await this.assetManager.mintingPaymentDefault(proof, crt.collateralReservationId, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'MintingPaymentDefault');
    }

    async unstickMinting(crt: EventArgs<CollateralReserved>) {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists();
        await this.assetManager.unstickMinting(proof, crt.collateralReservationId, { from: this.ownerHotAddress });
    }

    async selfMint(amountUBA: BNish, lots: BNish) {
        if (!(this.context.chain instanceof MockChain)) assert.fail("only for mock chains");
        const randomAddr = randomAddress();
        this.context.chain.mint(randomAddr, amountUBA);
        const transactionHash = await this.wallet.addTransaction(randomAddr, this.underlyingAddress, amountUBA, PaymentReference.selfMint(this.agentVault.address));
        const proof = await this.attestationProvider.provePayment(transactionHash, null, this.underlyingAddress);
        const res = await this.assetManager.selfMint(proof, this.agentVault.address, lots, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async selfClose(amountUBA: BNish): Promise<[dustChangesUBA: BN[], selfClosedValueUBA: BN, liquidationCancelledEvent: EventArgs<LiquidationEnded>]> {
        const res = await this.assetManager.selfClose(this.agentVault.address, amountUBA, { from: this.ownerHotAddress });
        const dustChangedEvents = filterEvents(res, 'DustChanged').map(e => e.args);
        const selfClose = requiredEventArgs(res, 'SelfClose');
        dustChangedEvents.every(dc => assert.equal(dc.agentVault, this.agentVault.address));
        assert.equal(selfClose.agentVault, this.agentVault.address);
        return [dustChangedEvents.map(dc => dc.dustUBA), selfClose.valueUBA, eventArgs(res, "LiquidationEnded")];
    }

    async performPayment(paymentAddress: string, paymentAmount: BNish, paymentReference: string | null = null, options?: MockTransactionOptionsWithFee) {
        return this.wallet.addTransaction(this.underlyingAddress, paymentAddress, paymentAmount, paymentReference, options);
    }

    // async getCollateralRatioBIPS(fullCollateral: BNish, mintedUBA: BNish, reservedUBA: BNish = 0, redeemingUBA: BNish = 0) {
    //     const [amgToNATWeiPrice, amgToNATWeiPriceTrusted] = await this.context.currentAmgToNATWeiPriceWithTrusted();
    //     const mintedAMG = this.context.convertUBAToAmg(mintedUBA);
    //     const reservedAMG = this.context.convertUBAToAmg(reservedUBA);
    //     const redeemingAMG = this.context.convertUBAToAmg(redeemingUBA);
    //     const ratio = await this.collateralRatio(fullCollateral, amgToNATWeiPrice, mintedAMG, reservedAMG, redeemingAMG);
    //     const ratioTrusted = await this.collateralRatio(fullCollateral, amgToNATWeiPriceTrusted, mintedAMG, reservedAMG, redeemingAMG);
    //     return ratio.gt(ratioTrusted) ? ratio : ratioTrusted;
    // }

    private async collateralRatio(fullCollateral: BNish, amgToNATWeiPrice: BNish, mintedAMG: BNish, reservedAMG: BNish = 0, redeemingAMG: BNish = 0) {
        const totalAMG = toBN(reservedAMG).add(toBN(mintedAMG)).add(toBN(redeemingAMG));
        if (totalAMG.eqn(0)) return toBN(2).pow(toBN(256)).subn(1);    // nothing minted - ~infinite collateral ratio
        const backingNATWei = this.context.convertAmgToNATWei(totalAMG, amgToNATWeiPrice);
        return toBN(fullCollateral).muln(MAX_BIPS).div(backingNATWei);
    }

    // async getPrices() {
    //     return await this.context.getPrices([this.class1Collateral.ftsoSymbol]);
    // }

//     async lockedCollateralWei(mintedUBA: BNish, reservedUBA: BNish = 0, redeemingUBA: BNish = 0, withdrawalAnnouncedNATWei: BNish = 0) {
//         const settings = await this.assetManager.getSettings();
//         const agentInfo = await this.assetManager.getAgentInfo(this.agentVault.address);
//         const prices = await this.getPrices();
//         const mintedAMG = this.context.convertUBAToAmg(mintedUBA);
//         const reservedAMG = this.context.convertUBAToAmg(reservedUBA);
//         const redeemingAMG = this.context.convertUBAToAmg(redeemingUBA);
//         const mintingAMG = reservedAMG.add(mintedAMG);
//         const minCollateralRatio = agentInfo.agentMinCollateralRatioBIPS;
//         const mintingCollateral = this.context.convertAmgToNATWei(mintingAMG, amgToNATWeiPrice)
//             .mul(toBN(minCollateralRatio)).divn(10_000);
//         const redeemingCollateral = this.context.convertAmgToNATWei(redeemingAMG, amgToNATWeiPrice)
//             .mul(toBN(settings.minCollateralRatioBIPS)).divn(10_000);
//         return mintingCollateral.add(redeemingCollateral).add(toBN(withdrawalAnnouncedNATWei));
//    }

    async endLiquidation() {
        const res = await this.assetManager.endLiquidation(this.vaultAddress, { from: this.ownerHotAddress });
        assert.equal(requiredEventArgs(res, 'LiquidationEnded').agentVault, this.vaultAddress);
    }

    async buybackAgentCollateral() {
        await this.assetManager.buybackAgentCollateral(this.agentVault.address, { from: this.ownerHotAddress });
    }

    // async getBuybackAgentCollateralValue(mintedUBA: BNish, reservedUBA: BNish = 0) {
    //     const mintedAMG = this.context.convertUBAToAmg(mintedUBA);
    //     const reservedAMG = this.context.convertUBAToAmg(reservedUBA);
    //     return this.context.convertAmgToNATWei(
    //             toBN(mintedAMG.add(reservedAMG))
    //             .mul(toBN(this.context.settings.buybackCollateralFactorBIPS))
    //             .divn(10_000),
    //             await this.context.currentAmgToNATWeiPrice()
    //         );
    // }

    // async calculateFreeCollateralLots(freeCollateralUBA: BNish) {
    //     const settings = await this.context.assetManager.getSettings();
    //     const agentInfo = await this.context.assetManager.getAgentInfo(this.agentVault.address);
    //     const minCollateralRatio = Math.max(toBN(agentInfo.agentMinCollateralRatioBIPS).toNumber(), toBN(settings.minCollateralRatioBIPS).toNumber());
    //     const lotCollateral = this.context.convertAmgToNATWei(settings.lotSizeAMG, await this.context.currentAmgToNATWeiPrice())
    //         .muln(minCollateralRatio)
    //         .divn(10_000);
    //     return toBN(freeCollateralUBA).div(lotCollateral);
    // }

    lastAgentInfoCheck: CheckAgentInfo = CHECK_DEFAULTS;

    async checkAgentInfo(check: CheckAgentInfo, keepPreviousChecks: boolean = true) {
        const agentCollateral = await AgentCollateral.create(this.assetManager, this.context.settings, this.vaultAddress);
        const agentInfo = agentCollateral.agentInfo;
        // collateral calculation checks
        assertWeb3Equal(agentCollateral.class1.balance, agentInfo.totalClass1CollateralWei);
        assertWeb3Equal(agentCollateral.pool.balance, agentInfo.totalPoolCollateralNATWei);
        assertWeb3Equal(agentCollateral.agentPoolTokens.balance, agentInfo.totalAgentPoolTokensWei);
        assertWeb3Equal(agentCollateral.freeCollateralLots(), agentInfo.freeCollateralLots);
        assertWeb3Equal(agentCollateral.freeCollateralWei(agentCollateral.class1), agentInfo.freeClass1CollateralWei);
        assertWeb3Equal(agentCollateral.freeCollateralWei(agentCollateral.pool), agentInfo.freePoolCollateralNATWei);
        assertWeb3Equal(agentCollateral.freeCollateralWei(agentCollateral.agentPoolTokens), agentInfo.freeAgentPoolTokensWei);
        assertWeb3Equal(agentCollateral.collateralRatioBIPS(agentCollateral.class1), agentInfo.class1CollateralRatioBIPS);
        assertWeb3Equal(agentCollateral.collateralRatioBIPS(agentCollateral.pool), agentInfo.poolCollateralRatioBIPS);
        // keep the check from prevous
        if (keepPreviousChecks) {
            check = { ...this.lastAgentInfoCheck, ...check };
        }
        for (const key of Object.keys(check) as Array<keyof CheckAgentInfo>) {
            let value: any;
            if (key === 'actualUnderlyingBalance') {
                value = await this.chain.getBalance(this.underlyingAddress);
            } else {
                value = agentInfo[key];
            }
            assertWeb3Equal(value, check[key], `Agent info mismatch at '${key}'`);
        }
        this.lastAgentInfoCheck = check;
        return agentInfo;
    }

    async getAgentInfo() {
        return await this.assetManager.getAgentInfo(this.agentVault.address);
    }
}
