import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { Agent } from "../../integration/utils/Agent";
import { AssetContext } from "../../integration/utils/AssetContext";
import { BaseEvent, EventArgs, eventIs } from "../../utils/events";
import { FuzzingRunner } from "./FuzzingRunner";
import { FuzzingTimeline } from "./FuzzingTimeline";

export class FuzzingAgent {
    static byVaultAddress: Map<string, FuzzingAgent> = new Map();
    static byUnderlyingAddress: Map<string, FuzzingAgent> = new Map();
    
    constructor(
        public timeline: FuzzingTimeline,
        public runner: FuzzingRunner,
        public agent: Agent,
    ) {
        FuzzingAgent.byVaultAddress.set(agent.agentVault.address, this);
        FuzzingAgent.byUnderlyingAddress.set(agent.underlyingAddress, this);
    }
    
    static async createTest(timeline: FuzzingTimeline, runner: FuzzingRunner, ctx: AssetContext, ownerAddress: string, underlyingAddress: string) {
        const agent = await Agent.createTest(ctx, ownerAddress, underlyingAddress);
        return new FuzzingAgent(timeline, runner, agent);
    }
    
    static async dispatchEvent(context: AssetContext, event: BaseEvent) {
        if (eventIs(event, context.assetManager, 'RedemptionRequested')) {
            const agent = this.byVaultAddress.get(event.args.agentVault);
            if (agent == null) assert.fail("invalid agent address");
            await agent.handleRedemptionRequest(event.args);
        }
    }
    
    async handleRedemptionRequest(request: EventArgs<RedemptionRequested>) {
        this.runner.startThread(async () => {
            const txHash = await this.agent.performRedemptionPayment(request);
            await this.agent.confirmActiveRedemptionPayment(request, txHash);
        });
    }
}
