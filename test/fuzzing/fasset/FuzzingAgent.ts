import { AssetManagerInstance } from "../../../typechain-truffle";
import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { Agent } from "../../integration/utils/Agent";
import { AssetContext } from "../../integration/utils/AssetContext";
import { BaseEvent, EventArgs, eventIs, truffleEventSource, TruffleEventSourceFromMethodResponse } from "../../utils/events";
import { FuzzingTimeline } from "./FuzzingTimeline";

export type AssetManagerEventSource = TruffleEventSourceFromMethodResponse<AssetManagerInstance, 'updateSettings'>;

export class FuzzingAgent {
    static byVaultAddress: Map<string, FuzzingAgent> = new Map();
    static byUnderlyingAddress: Map<string, FuzzingAgent> = new Map();
    
    constructor(
        public timeline: FuzzingTimeline,
        public agent: Agent,
    ) {
        FuzzingAgent.byVaultAddress.set(agent.agentVault.address, this);
        FuzzingAgent.byUnderlyingAddress.set(agent.underlyingAddress, this);
    }
    
    static async createTest(timeline: FuzzingTimeline, ctx: AssetContext, ownerAddress: string, underlyingAddress: string) {
        const agent = await Agent.createTest(ctx, ownerAddress, underlyingAddress);
        return new FuzzingAgent(timeline, agent);
    }
    
    static async dispatchEvent(context: AssetContext, event: BaseEvent) {
        const assetManagerEvents = truffleEventSource<AssetManagerEventSource>(context.assetManager);
        if (eventIs(event, assetManagerEvents, 'RedemptionRequested')) {
            const agent = this.byVaultAddress.get(event.args.agentVault);
            if (agent == null) assert.fail("invalid agent address");
            await agent.handleRedemptionRequest(event.args);
        }
    }
    
    async handleRedemptionRequest(request: EventArgs<RedemptionRequested>) {
        this.timeline.startThread(async () => {
            const txHash = await this.agent.performRedemptionPayment(request);
            await this.agent.confirmActiveRedemptionPayment(request, txHash);
        });
    }
}
