import { AssetContext } from "../../integration/utils/AssetContext";
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
        public interceptor: TruffleTransactionInterceptor,
        public timeline: FuzzingTimeline,
        public truffleEvents: TruffleEvents,
        public chainEvents: UnderlyingChainEvents,
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

}
