import { AgentVaultInstance } from "../../../typechain-truffle";
import { DustChanged, RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { EventArgs, filterEvents, findEvent, findRequiredEvent, requiredEventArgs } from "../../utils/events";
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
    
    async illegalPaymentChallenge(agent: Agent, txHash: string) {
        const proof = await this.attestationProvider.proveBalanceDecreasingTransaction(txHash, agent.underlyingAddress);
        const res = await this.assetManager.illegalPaymentChallenge(proof, agent.agentVault.address, { from: this.address });
        return requiredEventArgs(res, 'IllegalPaymentConfirmed');
    }

    async doublePaymentChallenge(agent: Agent, txHash1: string, txHash2: string) {
        const proof1 = await this.attestationProvider.proveBalanceDecreasingTransaction(txHash1, agent.underlyingAddress);
        const proof2 = await this.attestationProvider.proveBalanceDecreasingTransaction(txHash2, agent.underlyingAddress);
        const res = await this.assetManager.doublePaymentChallenge(proof1, proof2, agent.agentVault.address, { from: this.address });
        return requiredEventArgs(res, 'DuplicatePaymentConfirmed');
    }

    async freeBalanceNegativeChallenge(agent: Agent, txHashes: string[]) {
        const proofs: any[] = [];
        for (const txHash of txHashes) {
            proofs.push(await this.attestationProvider.proveBalanceDecreasingTransaction(txHash, agent.underlyingAddress));
        }
        const res = await this.assetManager.freeBalanceNegativeChallenge(proofs, agent.agentVault.address, { from: this.address });
        return requiredEventArgs(res, 'UnderlyingFreeBalanceNegative');
    }

    async getChallengerReward(backingAMGAtChallenge: BNish) {
        return toBN(this.context.settings.paymentChallengeRewardNATWei)
            .add(
                this.context.convertAmgToNATWei(
                    toBN(backingAMGAtChallenge)
                    .mul(toBN(this.context.settings.paymentChallengeRewardBIPS))
                    .divn(10_000),
                    await this.context.currentAmgToNATWeiPrice()
                )
            );
    }
}
