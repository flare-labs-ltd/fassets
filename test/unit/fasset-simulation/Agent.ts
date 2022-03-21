import { AgentVaultInstance } from "../../../typechain-truffle";
import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { EventArgs, filterEvents, findRequiredEvent, requiredEventArgs } from "../../utils/events";
import { PaymentReference } from "../../utils/fasset/PaymentReference";
import { BNish, toBN } from "../../utils/helpers";
import { AssetContext, AssetContextClient } from "./AssetContext";

const AgentVault = artifacts.require('AgentVault');

export class Agent extends AssetContextClient {
    constructor(
        context: AssetContext,
        public ownerAddress: string,
        public agentVault: AgentVaultInstance,
        public underlyingAddress: string,
    ) {
        super(context);
    }
    
    get vaultAddress() {
        return this.agentVault.address;
    }
    
    static async create(ctx: AssetContext, ownerAddress: string, underlyingAddress: string) {
        // mint some funds on underlying address (just enough to make EOA proof)
        ctx.chain.mint(underlyingAddress, 1);
        // create and prove transaction from underlyingAddress
        const tx = ctx.chain.addSimpleTransaction(underlyingAddress, underlyingAddress, 1, 0, PaymentReference.addressOwnership(ownerAddress));
        const proof = await ctx.attestationProvider.provePayment(tx.hash, underlyingAddress, underlyingAddress);
        await ctx.assetManager.proveUnderlyingAddressEOA(proof, { from: ownerAddress });
        // create agent
        const response = await ctx.assetManager.createAgent(underlyingAddress, { from: ownerAddress });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(event.args.agentVault);
        // creater object
        return new Agent(ctx, ownerAddress, agentVault, underlyingAddress);
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
    
    async performRedemptionPayment(request: EventArgs<RedemptionRequested>) {
        const paymentAmount = request.valueUBA.sub(request.feeUBA);
        return await this.performPayment(request.paymentAddress, paymentAmount, 0, request.paymentReference);
    }

    async confirmRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerAddress });
        return requiredEventArgs(res, 'RedemptionPerformed');
    }

    async selfClose(amountUBA: BN): Promise<[dustChangesUBA: BN[], selfClosedValueUBA: BN]> {
        const res = await this.assetManager.selfClose(this.agentVault.address, amountUBA, { from: this.ownerAddress });
        const dustChangedEvents = filterEvents(res.logs, 'DustChanged').map(e => e.args);
        const selfClose = requiredEventArgs(res, 'SelfClose');
        dustChangedEvents.every(dc => assert.equal(dc.agentVault, this.agentVault.address));
        assert.equal(selfClose.agentVault, this.agentVault.address);
        return [dustChangedEvents.map(dc => dc.dustUBA), selfClose.valueUBA];
    }

    async performPayment(paymentAddress: string, paymentAmount: BNish, gasUsed: BNish = 0, paymentReference: string | null = null, status: number = 0) {
        return this.chain.addSimpleTransaction(this.underlyingAddress, paymentAddress, paymentAmount, gasUsed, paymentReference, status);
    }
}
