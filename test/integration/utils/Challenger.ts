import { AgentVaultInstance } from "../../../typechain-truffle";
import { AllowedPaymentAnnounced, DustChanged, LiquidationStarted, RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { checkEventNotEmited, eventArgs, EventArgs, filterEvents, findEvent, findRequiredEvent, requiredEventArgs } from "../../utils/events";
import { PaymentReference } from "../../utils/fasset/PaymentReference";
import { BNish, toBN } from "../../utils/helpers";
import { Agent } from "./Agent";
import { AssetContext, AssetContextClient } from "./AssetContext";

const AgentVault = artifacts.require('AgentVault');

export class Challenger extends AssetContextClient {
    constructor(
        context: AssetContext,
        public address: string
    ) {
        super(context);
    }
    
    static async create(ctx: AssetContext, address: string) {
        // creater object
        return new Challenger(ctx, address);
    }
    
    async illegalPaymentChallenge(agent: Agent, txHash: string): Promise<[blockTimestamp: BNish, liquidationStarted: EventArgs<LiquidationStarted>]> {
        const proof = await this.attestationProvider.proveBalanceDecreasingTransaction(txHash, agent.underlyingAddress);
        const res = await this.assetManager.illegalPaymentChallenge(proof, agent.agentVault.address, { from: this.address });
        findRequiredEvent(res, 'IllegalPaymentConfirmed');
        const tr = await web3.eth.getTransaction(res.tx);
        const block = await web3.eth.getBlock(tr.blockHash!);
        return [block.timestamp, eventArgs(res, 'LiquidationStarted')];
    }

    async doublePaymentChallenge(agent: Agent, txHash1: string, txHash2: string): Promise<[blockTimestamp: BNish, liquidationStarted: EventArgs<LiquidationStarted>]> {
        const proof1 = await this.attestationProvider.proveBalanceDecreasingTransaction(txHash1, agent.underlyingAddress);
        const proof2 = await this.attestationProvider.proveBalanceDecreasingTransaction(txHash2, agent.underlyingAddress);
        const res = await this.assetManager.doublePaymentChallenge(proof1, proof2, agent.agentVault.address, { from: this.address });
        findRequiredEvent(res, 'DuplicatePaymentConfirmed');
        const tr = await web3.eth.getTransaction(res.tx);
        const block = await web3.eth.getBlock(tr.blockHash!);
        return [block.timestamp, eventArgs(res, 'LiquidationStarted')];
    }

    async freeBalanceNegativeChallenge(agent: Agent, txHashes: string[]): Promise<[blockTimestamp: BNish, liquidationStarted: EventArgs<LiquidationStarted>]> {
        const proofs: any[] = [];
        for (const txHash of txHashes) {
            proofs.push(await this.attestationProvider.proveBalanceDecreasingTransaction(txHash, agent.underlyingAddress));
        }
        const res = await this.assetManager.freeBalanceNegativeChallenge(proofs, agent.agentVault.address, { from: this.address });
        findRequiredEvent(res, 'UnderlyingFreeBalanceNegative');
        const tr = await web3.eth.getTransaction(res.tx);
        const block = await web3.eth.getBlock(tr.blockHash!);
        return [block.timestamp, eventArgs(res, 'LiquidationStarted')];
    }

    async confirmActiveRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string, agent?: Agent) {
        let sourceAddress: string;
        if (agent) {
            sourceAddress = agent.underlyingAddress;
        } else {
            const tx = await this.chain.getTransaction(transactionHash);
            sourceAddress = tx?.inputs[0][0]!;
        }
        const proof = await this.attestationProvider.provePayment(transactionHash, sourceAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.address });
        findRequiredEvent(res, 'RedemptionFinished');
        return requiredEventArgs(res, 'RedemptionPerformed');
    }
    
    async confirmDefaultedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string, agent?: Agent) {
        let sourceAddress: string;
        if (agent) {
            sourceAddress = agent.underlyingAddress;
        } else {
            const tx = await this.chain.getTransaction(transactionHash);
            sourceAddress = tx?.inputs[0][0]!;
        }
        const proof = await this.attestationProvider.provePayment(transactionHash, sourceAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.address });
        findRequiredEvent(res, 'RedemptionFinished');
        checkEventNotEmited(res, 'RedemptionPerformed');
        checkEventNotEmited(res, 'RedemptionPaymentFailed');
        checkEventNotEmited(res, 'RedemptionPaymentBlocked');
    }

    async confirmFailedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string, agent?: Agent) {
        let sourceAddress: string;
        if (agent) {
            sourceAddress = agent.underlyingAddress;
        } else {
            const tx = await this.chain.getTransaction(transactionHash);
            sourceAddress = tx?.inputs[0][0]!;
        }
        const proof = await this.attestationProvider.provePayment(transactionHash, sourceAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.address });
        findRequiredEvent(res, 'RedemptionFinished');
        return requiredEventArgs(res, 'RedemptionPaymentFailed');
    }

    async confirmBlockedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string, agent?: Agent) {
        let sourceAddress: string;
        if (agent) {
            sourceAddress = agent.underlyingAddress;
        } else {
            const tx = await this.chain.getTransaction(transactionHash);
            sourceAddress = tx?.inputs[0][0]!;
        }
        const proof = await this.attestationProvider.provePayment(transactionHash, sourceAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.address });
        findRequiredEvent(res, 'RedemptionFinished');
        return requiredEventArgs(res, 'RedemptionPaymentBlocked');
    }
    
    async confirmAllowedPayment(request: EventArgs<AllowedPaymentAnnounced>, transactionHash: string, agent?: Agent) {
        let sourceAddress: string;
        if (agent) {
            sourceAddress = agent.underlyingAddress;
        } else {
            const tx = await this.chain.getTransaction(transactionHash);
            sourceAddress = tx?.inputs[0][0]!;
        }
        const proof = await this.attestationProvider.provePayment(transactionHash, sourceAddress, null);
        const res = await this.assetManager.confirmAllowedPayment(proof, request.agentVault, request.announcementId, { from: this.address });
        return requiredEventArgs(res, 'AllowedPaymentConfirmed');
    }

    async getChallengerReward(backingAtChallengeUBA: BNish) {
        const backingAtChallengeAMG = this.context.convertUBAToAmg(backingAtChallengeUBA);
        return toBN(this.context.settings.paymentChallengeRewardNATWei)
            .add(
                this.context.convertAmgToNATWei(
                    toBN(backingAtChallengeAMG)
                    .mul(toBN(this.context.settings.paymentChallengeRewardBIPS))
                    .divn(10_000),
                    await this.context.currentAmgToNATWeiPrice()
                )
            );
    }
}
