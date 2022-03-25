import { AgentVaultInstance } from "../../../typechain-truffle";
import { AllowedPaymentAnnounced, CollateralReserved, RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { checkEventNotEmited, EventArgs, filterEvents, findRequiredEvent, requiredEventArgs } from "../../utils/events";
import { IChainWallet } from "../../utils/fasset/ChainInterfaces";
import { MockChain, MockChainWallet } from "../../utils/fasset/MockChain";
import { PaymentReference } from "../../utils/fasset/PaymentReference";
import { BNish, toBN } from "../../utils/helpers";
import { AssetContext, AssetContextClient } from "./AssetContext";
import { Minter } from "./Minter";

const AgentVault = artifacts.require('AgentVault');

export class Agent extends AssetContextClient {
    constructor(
        context: AssetContext,
        public ownerAddress: string,
        public agentVault: AgentVaultInstance,
        public underlyingAddress: string,
        public wallet: IChainWallet,
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
    
    static async create(ctx: AssetContext, ownerAddress: string, underlyingAddress: string, wallet: IChainWallet) {
        // create and prove transaction from underlyingAddress if EOA required
        if (ctx.chainInfo.requireEOAProof) {
            const txHash = await wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(ownerAddress));
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
        await this.agentVault.deposit({ from: this.ownerAddress, value: toBN(amountNATWei) });
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
    
    async announceWithdrawal(amountNATWei: BNish) {
        const res = await this.assetManager.announceCollateralWithdrawal(this.vaultAddress, amountNATWei, { from: this.ownerAddress });
    }
    
    async destroy() {
        const res = await this.assetManager.destroyAgent(this.vaultAddress, this.ownerAddress, { from: this.ownerAddress });
        const args = requiredEventArgs(res, 'AgentDestroyed');
        assert.equal(args.agentVault, this.vaultAddress);
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

    async announceAllowedPayment() {
        const res = await this.assetManager.announceAllowedPayment(this.agentVault.address, { from: this.ownerAddress });
        return requiredEventArgs(res, 'AllowedPaymentAnnounced');
    }

    async performAllowedPayment(request: EventArgs<AllowedPaymentAnnounced>, amount: BNish, underlyingAddress: string = "someAddress") {
        return await this.wallet.addTransaction(this.underlyingAddress, underlyingAddress, amount, request.paymentReference);
    }

    async confirmAllowedPayment(request: EventArgs<AllowedPaymentAnnounced>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, null);
        const res = await this.assetManager.confirmAllowedPayment(proof, this.agentVault.address, request.announcementId, { from: this.ownerAddress });
        return requiredEventArgs(res, 'AllowedPaymentConfirmed');
    }
    
    async performRedemptionPayment(request: EventArgs<RedemptionRequested>) {
        const paymentAmount = request.valueUBA.sub(request.feeUBA);
        return await this.performPayment(request.paymentAddress, paymentAmount, request.paymentReference);
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

    async confirmFailedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerAddress });
        findRequiredEvent(res, 'RedemptionFinished');
        return requiredEventArgs(res, 'RedemptionPaymentFailed');
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

    async finishRedemptionWithoutPayment(request: EventArgs<RedemptionRequested>) {
        const res = await this.assetManager.finishRedemptionWithoutPayment(request.requestId, { from: this.ownerAddress });
        return requiredEventArgs(res, 'RedemptionFinished');
    }

    async getRedemptionPaymentDefaultValue(lots: BNish) {
        return this.context.convertAmgToNATWei(
                toBN(this.context.convertLotsToAMG(lots))
                .mul(toBN(this.context.settings.redemptionFailureFactorBIPS))
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

    async selfMint(amountUBA: BNish, lots: BNish) {
        const transactionHash = await this.performPayment(this.underlyingAddress, amountUBA, PaymentReference.selfMint(this.agentVault.address));
        const proof = await this.attestationProvider.provePayment(transactionHash, null, this.underlyingAddress);
        const res = await this.assetManager.selfMint(proof, this.agentVault.address, lots, { from: this.ownerAddress });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async selfClose(amountUBA: BNish): Promise<[dustChangesUBA: BN[], selfClosedValueUBA: BN]> {
        const res = await this.assetManager.selfClose(this.agentVault.address, amountUBA, { from: this.ownerAddress });
        const dustChangedEvents = filterEvents(res.logs, 'DustChanged').map(e => e.args);
        const selfClose = requiredEventArgs(res, 'SelfClose');
        dustChangedEvents.every(dc => assert.equal(dc.agentVault, this.agentVault.address));
        assert.equal(selfClose.agentVault, this.agentVault.address);
        return [dustChangedEvents.map(dc => dc.dustUBA), selfClose.valueUBA];
    }

    async performPayment(paymentAddress: string, paymentAmount: BNish, paymentReference: string | null = null) {
        return this.wallet.addTransaction(this.underlyingAddress, paymentAddress, paymentAmount, paymentReference);
    }
}
