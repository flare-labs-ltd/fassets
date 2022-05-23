import { AssetContext, AssetManagerEvents } from "../../integration/utils/AssetContext";
import { Web3EventDecoder } from "../../utils/EventDecoder";
import { ExtractedEventArgs } from "../../utils/events";
import { AvailableAgentInfo } from "../../utils/fasset/AssetManagerTypes";
import { FuzzingAgent } from "./FuzzingAgent";
import { FuzzingCustomer } from "./FuzzingCustomer";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { ScopedRunner } from "./ScopedRunner";
import { TruffleTransactionInterceptor } from "./TransactionInterceptor";
import { TruffleEvents, UnderlyingChainEvents } from "./WrappedEvents";

export class FuzzingRunner extends ScopedRunner {
    constructor(
        public context: AssetContext,
        public eventDecoder: Web3EventDecoder,
        public interceptor: TruffleTransactionInterceptor,
        public timeline: FuzzingTimeline,
        public truffleEvents: TruffleEvents,
        public chainEvents: UnderlyingChainEvents,
        public avoidErrors: boolean,
    ) {
        super();
        this.logError = (e) => this.interceptor.logUnexpectedError(e, "!!! THREAD ERROR");
    }

    agents: FuzzingAgent[] = [];
    customers: FuzzingCustomer[] = [];
    availableAgents: AvailableAgentInfo[] = [];

    async refreshAvailableAgents() {
        const { 0: _availableAgents } = await this.context.assetManager.getAvailableAgentsDetailedList(0, 1000);
        this.availableAgents = _availableAgents;
    }

    assetManagerEvent<N extends AssetManagerEvents['name']>(event: N, filter?: Partial<ExtractedEventArgs<AssetManagerEvents, N>>) {
        return this.truffleEvents.event(this.context.assetManager, event, filter);
    }
}
