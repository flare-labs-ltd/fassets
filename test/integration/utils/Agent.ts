import { time } from "@openzeppelin/test-helpers";
import { AgentVaultInstance } from "../../../typechain-truffle";
import { UnderlyingWithdrawalAnnounced, CollateralReserved, LiquidationEnded, RedemptionDefault, RedemptionFinished, RedemptionRequested, RedemptionPaymentFailed } from "../../../typechain-truffle/AssetManager";
import { calcGasCost } from "../../utils/eth";
import { checkEventNotEmited, eventArgs, filterEvents, findRequiredEvent, requiredEventArgs } from "../../../lib/utils/events/truffle";
import { EventArgs } from "../../../lib/utils/events/common";
import { IBlockChainWallet } from "../../../lib/underlying-chain/interfaces/IBlockChainWallet";
import { MockChain, MockChainWallet, MockTransactionOptionsWithFee } from "../../utils/fasset/MockChain";
import { PaymentReference } from "../../../lib/fasset/PaymentReference";
import { BNish, BN_ZERO, MAX_BIPS, randomAddress, toBN } from "../../../lib/utils/helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { AssetContext, AssetContextClient } from "./AssetContext";
import { Minter } from "./Minter";

const AgentVault = artifacts.require('AgentVault');

export class Agent extends AssetContextClient {
    constructor(
        context: AssetContext,
        public ownerAddress: string,
        public agentVault: AgentVaultInstance,
        public underlyingAddress: string,
        public wallet: IBlockChainWallet,
    ) {
        super(context);
    }
    
    get vaultAddress() {
        return this.agentVault.address;
    }
    
    static async createTest(ctx: AssetContext, ownerAddress: string, underlyingAddress: string) {
        if (!(ctx.chain instanceof MockChain)) assert.fail("only for mock chains");
        // mint some funds on underlying address (just enough to make EOA proof)
        if (ctx.chainInfo.requireEOAProof) {
            ctx.chain.mint(underlyingAddress, ctx.chain.requiredFee.addn(1));
        }
        // create mock wallet
        const wallet = new MockChainWallet(ctx.chain);
        return await Agent.create(ctx, ownerAddress, underlyingAddress, wallet);
    }
    
    static async create(ctx: AssetContext, ownerAddress: string, underlyingAddress: string, wallet: IBlockChainWallet) {
        // create and prove transaction from underlyingAddress if EOA required
        if (ctx.chainInfo.requireEOAProof) {
            const txHash = await wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(ownerAddress));
            if (ctx.chain.finalizationBlocks > 0) {
                await ctx.waitForUnderlyingTransactionFinalization(undefined, txHash);
            }
            const proof = await ctx.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
            await ctx.assetManager.proveUnderlyingAddressEOA(proof, { from: ownerAddress });
        }
        // create agent
        const response = await ctx.assetManager.createAgent(underlyingAddress, { from: ownerAddress });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(event.args.agentVault);
        // creater object
        return new Agent(ctx, ownerAddress, agentVault, underlyingAddress, wallet);
    }
    
    async depositCollateral(amountNATWei: BNish) {
        const res = await this.agentVault.deposit({ from: this.ownerAddress, value: toBN(amountNATWei) });
        const tr = await web3.eth.getTransaction(res.tx);
        const res2 = await this.assetManager.getPastEvents('LiquidationEnded', { fromBlock: tr.blockNumber!, toBlock: tr.blockNumber!, filter: {transactionHash: res.tx} })
        return res2.length > 0 ? (res2[0] as any).args as EventArgs<LiquidationEnded> : undefined;
    }
    
    async makeAvailable(feeBIPS: BNish, collateralRatioBIPS: BNish) {
        const res = await this.assetManager.makeAgentAvailable(this.vaultAddress, feeBIPS, collateralRatioBIPS, { from: this.ownerAddress });
        return requiredEventArgs(res, 'AgentAvailable');
    }

    async exitAvailable() {
        const res = await this.assetManager.exitAvailableAgentList(this.vaultAddress, { from: this.ownerAddress });
        const args = requiredEventArgs(res, 'AvailableAgentExited');
        assert.equal(args.agentVault, this.vaultAddress);
    }

    async exitAndDestroy(collateral: BNish) {
        await this.exitAvailable();
        await this.announceDestroy();
        await time.increase(300);
        const startBalance = toBN(await web3.eth.getBalance(this.ownerAddress));
        const res = await this.destroy();
        const endBalance = toBN(await web3.eth.getBalance(this.ownerAddress));
        assertWeb3Equal(endBalance.sub(startBalance).add(await calcGasCost(res)), collateral);
    }
    
    async announceCollateralWithdrawal(amountNATWei: BNish) {
        await this.assetManager.announceCollateralWithdrawal(this.vaultAddress, amountNATWei, { from: this.ownerAddress });
    }

    async withdrawCollateral(amountNATWei: BNish) {
        return await this.agentVault.withdraw(amountNATWei, { from: this.ownerAddress });
    }

    async announceDestroy() {
        await this.assetManager.announceDestroyAgent(this.vaultAddress, { from: this.ownerAddress });
    }
    
    async destroy() {
        const res = await this.assetManager.destroyAgent(this.vaultAddress, { from: this.ownerAddress });
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
        await this.assetManager.confirmTopupPayment(proof, this.agentVault.address, { from: this.ownerAddress });
    }

    async announceUnderlyingWithdrawal() {
        const res = await this.assetManager.announceUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalAnnounced');
    }

    async performUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, amount: BNish, underlyingAddress: string = "someAddress") {
        return await this.wallet.addTransaction(this.underlyingAddress, underlyingAddress, amount, request.paymentReference);
    }

    async confirmUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, null);
        const res = await this.assetManager.confirmUnderlyingWithdrawal(proof, this.agentVault.address, { from: this.ownerAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalConfirmed');
    }

    async cancelUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>) {
        const res = await this.assetManager.cancelUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalCancelled');
    }
    
    async performRedemptionPayment(request: EventArgs<RedemptionRequested>, options?: MockTransactionOptionsWithFee) {
        const paymentAmount = request.valueUBA.sub(request.feeUBA);
        return await this.performPayment(request.paymentAddress, paymentAmount, request.paymentReference, options);
    }

    async confirmActiveRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerAddress });
        findRequiredEvent(res, 'RedemptionFinished');
        return requiredEventArgs(res, 'RedemptionPerformed');
    }
    
    async confirmDefaultedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerAddress });
        findRequiredEvent(res, 'RedemptionFinished');
        checkEventNotEmited(res, 'RedemptionPerformed');
        checkEventNotEmited(res, 'RedemptionPaymentFailed');
        checkEventNotEmited(res, 'RedemptionPaymentBlocked');
    }

    async confirmFailedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string): Promise<[redemptionPaymentFailed: EventArgs<RedemptionPaymentFailed>, redemptionDefault: EventArgs<RedemptionDefault>]>  {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerAddress });
        findRequiredEvent(res, 'RedemptionFinished');
        return [requiredEventArgs(res, 'RedemptionPaymentFailed'), requiredEventArgs(res, 'RedemptionDefault')];
    }

    async confirmBlockedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerAddress });
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
        const res = await this.assetManager.redemptionPaymentDefault(proof, request.requestId, { from: this.ownerAddress });
        return requiredEventArgs(res, 'RedemptionDefault');
    }

    async finishRedemptionWithoutPayment(request: EventArgs<RedemptionRequested>): Promise<[redemptionFinished: EventArgs<RedemptionFinished>, redemptionDefault: EventArgs<RedemptionDefault>]> {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists();
        const res = await this.assetManager.finishRedemptionWithoutPayment(proof, request.requestId, { from: this.ownerAddress });
        return [eventArgs(res, 'RedemptionFinished'), eventArgs(res, "RedemptionDefault")];
    }

    async getRedemptionPaymentDefaultValue(lots: BNish) {
        return this.context.convertAmgToNATWei(
                toBN(await this.context.convertLotsToAMG(lots))
                .mul(toBN(this.context.settings.redemptionDefaultFactorBIPS))
                .divn(10_000),
                await this.context.currentAmgToNATWeiPrice()
            );
            // TODO collateral share
    }

    async executeMinting(crt: EventArgs<CollateralReserved>, transactionHash: string, minter?: Minter) {
        let sourceAddress: string;
        if (minter) {
            sourceAddress = minter.underlyingAddress;
        } else {
            const tx = await this.chain.getTransaction(transactionHash);
            sourceAddress = tx?.inputs[0][0]!;
        }
        const proof = await this.attestationProvider.provePayment(transactionHash, sourceAddress, this.underlyingAddress);
        const res = await this.assetManager.executeMinting(proof, crt.collateralReservationId, { from: this.ownerAddress });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async mintingPaymentDefault(crt: EventArgs<CollateralReserved>) {
        const proof = await this.attestationProvider.proveReferencedPaymentNonexistence(
            this.underlyingAddress,
            crt.paymentReference,
            crt.valueUBA.add(crt.feeUBA),
            crt.lastUnderlyingBlock.toNumber(),
            crt.lastUnderlyingTimestamp.toNumber());
        const res = await this.assetManager.mintingPaymentDefault(proof, crt.collateralReservationId, { from: this.ownerAddress });
        return requiredEventArgs(res, 'MintingPaymentDefault');
    }

    async unstickMinting(crt: EventArgs<CollateralReserved>) {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists();
        await this.assetManager.unstickMinting(proof, crt.collateralReservationId, { from: this.ownerAddress });
    }

    async selfMint(amountUBA: BNish, lots: BNish) {
        if (!(this.context.chain instanceof MockChain)) assert.fail("only for mock chains");
        const randomAddr = randomAddress();
        this.context.chain.mint(randomAddr, amountUBA);
        const transactionHash = await this.wallet.addTransaction(randomAddr, this.underlyingAddress, amountUBA, PaymentReference.selfMint(this.agentVault.address));
        const proof = await this.attestationProvider.provePayment(transactionHash, null, this.underlyingAddress);
        const res = await this.assetManager.selfMint(proof, this.agentVault.address, lots, { from: this.ownerAddress });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async selfClose(amountUBA: BNish): Promise<[dustChangesUBA: BN[], selfClosedValueUBA: BN, liquidationCancelledEvent: EventArgs<LiquidationEnded>]> {
        const res = await this.assetManager.selfClose(this.agentVault.address, amountUBA, { from: this.ownerAddress });
        const dustChangedEvents = filterEvents(res, 'DustChanged').map(e => e.args);
        const selfClose = requiredEventArgs(res, 'SelfClose');
        dustChangedEvents.every(dc => assert.equal(dc.agentVault, this.agentVault.address));
        assert.equal(selfClose.agentVault, this.agentVault.address);
        return [dustChangedEvents.map(dc => dc.dustUBA), selfClose.valueUBA, eventArgs(res, "LiquidationEnded")];
    }

    async performPayment(paymentAddress: string, paymentAmount: BNish, paymentReference: string | null = null, options?: MockTransactionOptionsWithFee) {
        return this.wallet.addTransaction(this.underlyingAddress, paymentAddress, paymentAmount, paymentReference, options);
    }

    async getCollateralRatioBIPS(fullCollateral: BNish, mintedUBA: BNish, reservedUBA: BNish = 0, redeemingUBA: BNish = 0) {
        const [amgToNATWeiPrice, amgToNATWeiPriceTrusted] = await this.context.currentAmgToNATWeiPriceWithTrusted();
        const mintedAMG = this.context.convertUBAToAmg(mintedUBA);
        const reservedAMG = this.context.convertUBAToAmg(reservedUBA);
        const redeemingAMG = this.context.convertUBAToAmg(redeemingUBA);
        const ratio = await this.collateralRatio(fullCollateral, amgToNATWeiPrice, mintedAMG, reservedAMG, redeemingAMG);
        const ratioTrusted = await this.collateralRatio(fullCollateral, amgToNATWeiPriceTrusted, mintedAMG, reservedAMG, redeemingAMG);
        return ratio.gt(ratioTrusted) ? ratio : ratioTrusted;
    }

    private async collateralRatio(fullCollateral: BNish, amgToNATWeiPrice: BNish, mintedAMG: BNish, reservedAMG: BNish = 0, redeemingAMG: BNish = 0) {
        const totalAMG = toBN(reservedAMG).add(toBN(mintedAMG)).add(toBN(redeemingAMG));
        if (totalAMG.eqn(0)) return toBN(2).pow(toBN(256)).subn(1);    // nothing minted - ~infinite collateral ratio
        const backingNATWei = this.context.convertAmgToNATWei(totalAMG, amgToNATWeiPrice);
        return toBN(fullCollateral).muln(MAX_BIPS).div(backingNATWei);
    }

    async lockedCollateralWei(mintedUBA: BNish, reservedUBA: BNish = 0, redeemingUBA: BNish = 0, withdrawalAnnouncedNATWei: BNish = 0) {
        const settings = await this.assetManager.getSettings();
        const agentInfo = await this.assetManager.getAgentInfo(this.agentVault.address);
        const amgToNATWeiPrice = await this.context.currentAmgToNATWeiPrice();
        const mintedAMG = this.context.convertUBAToAmg(mintedUBA);
        const reservedAMG = this.context.convertUBAToAmg(reservedUBA);
        const redeemingAMG = this.context.convertUBAToAmg(redeemingUBA);
        const mintingAMG = reservedAMG.add(mintedAMG);
        const minCollateralRatio = agentInfo.agentMinCollateralRatioBIPS;
        const mintingCollateral = this.context.convertAmgToNATWei(mintingAMG, amgToNATWeiPrice)
            .mul(toBN(minCollateralRatio)).divn(10_000);
        const redeemingCollateral = this.context.convertAmgToNATWei(redeemingAMG, amgToNATWeiPrice)
            .mul(toBN(settings.minCollateralRatioBIPS)).divn(10_000);
        return mintingCollateral.add(redeemingCollateral).add(toBN(withdrawalAnnouncedNATWei));
   }

    async endLiquidation() {
        const res = await this.assetManager.endLiquidation(this.vaultAddress, { from: this.ownerAddress });
        assert.equal(requiredEventArgs(res, 'LiquidationEnded').agentVault, this.vaultAddress);
    }

    async buybackAgentCollateral() {
        await this.assetManager.buybackAgentCollateral(this.agentVault.address, { from: this.ownerAddress });
    }

    async getBuybackAgentCollateralValue(mintedUBA: BNish, reservedUBA: BNish = 0) {
        const mintedAMG = this.context.convertUBAToAmg(mintedUBA);
        const reservedAMG = this.context.convertUBAToAmg(reservedUBA);
        return this.context.convertAmgToNATWei(
                toBN(mintedAMG.add(reservedAMG))
                .mul(toBN(this.context.settings.buybackCollateralFactorBIPS))
                .divn(10_000),
                await this.context.currentAmgToNATWeiPrice()
            );
    }

    async calculateFreeCollateralLots(freeCollateralUBA: BNish) {
        const settings = await this.context.assetManager.getSettings();
        const agentInfo = await this.context.assetManager.getAgentInfo(this.agentVault.address);
        const minCollateralRatio = Math.max(toBN(agentInfo.agentMinCollateralRatioBIPS).toNumber(), toBN(settings.minCollateralRatioBIPS).toNumber());
        const lotCollateral = this.context.convertAmgToNATWei(settings.lotSizeAMG, await this.context.currentAmgToNATWeiPrice())
            .muln(minCollateralRatio)
            .divn(10_000);
        return toBN(freeCollateralUBA).div(lotCollateral);
    }

    async checkAgentInfo(fullAgentCollateral: BNish, freeUnderlyingBalanceUBA: BNish, lockedUnderlyingBalanceUBA: BNish, mintedUBA: BNish, reservedUBA: BNish = 0, redeemingUBA: BNish = 0, withdrawalAnnouncedNATWei: BNish = 0, status: BNish = 0) {
        const info = await this.context.assetManager.getAgentInfo(this.agentVault.address);
        const lockedAgentCollateral = await this.lockedCollateralWei(mintedUBA, reservedUBA, redeemingUBA, withdrawalAnnouncedNATWei);
        assertWeb3Equal(info.totalCollateralNATWei, fullAgentCollateral);
        assertWeb3Equal(info.freeCollateralNATWei, lockedAgentCollateral.gt(toBN(fullAgentCollateral)) ? 0 : toBN(fullAgentCollateral).sub(lockedAgentCollateral));
        assertWeb3Equal(info.freeUnderlyingBalanceUBA, freeUnderlyingBalanceUBA);
        assertWeb3Equal(info.lockedUnderlyingBalanceUBA, lockedUnderlyingBalanceUBA);
        assertWeb3Equal(info.mintedUBA, mintedUBA);
        assertWeb3Equal(info.reservedUBA, reservedUBA);
        assertWeb3Equal(info.redeemingUBA, redeemingUBA);
        assert.equal(info.status, status);
        assert.equal(info.underlyingAddressString, this.underlyingAddress);
        assertWeb3Equal(info.collateralRatioBIPS, await this.getCollateralRatioBIPS(fullAgentCollateral, mintedUBA, reservedUBA, redeemingUBA));

        return info;
    }
}
