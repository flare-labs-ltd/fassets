import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { Agent } from "../../integration/utils/Agent";
import { AssetContext } from "../../integration/utils/AssetContext";
import { EventArgs } from "../../utils/events";
import { FuzzingRunner } from "./FuzzingRunner";

export class FuzzingAgent {
    constructor(
        public runner: FuzzingRunner,
        public agent: Agent,
    ) {
        this.registerForEvents();
    }

    context = this.runner.context;

    static async createTest(runner: FuzzingRunner, ctx: AssetContext, ownerAddress: string, underlyingAddress: string) {
        const agent = await Agent.createTest(ctx, ownerAddress, underlyingAddress);
        return new FuzzingAgent(runner, agent);
    }

    registerForEvents() {
        this.runner.assetManagerEvent('RedemptionRequested', { agentVault: this.agent.vaultAddress })
            .subscribe((args) => this.handleRedemptionRequest(args));
    }

    async handleRedemptionRequest(request: EventArgs<RedemptionRequested>) {
        this.runner.startThread(async (scope) => {
            const txHash = await this.agent.performRedemptionPayment(request);
            await this.agent.confirmActiveRedemptionPayment(request, txHash);
        });
    }
}
