import { AvailableAgentInfo } from "../../../lib/fasset/AssetManagerTypes";
import { UnderlyingChainEvents } from "../../../lib/underlying-chain/UnderlyingChainEvents";
import { ExtractedEventArgs } from "../../../lib/utils/events/common";
import { ScopedRunner } from "../../../lib/utils/events/ScopedRunner";
import { AssetContext, AssetManagerEvents } from "../../integration/utils/AssetContext";
import { Web3EventDecoder } from "../../utils/Web3EventDecoder";
import { FuzzingAgent } from "./FuzzingAgent";
import { FuzzingCustomer } from "./FuzzingCustomer";
import { FuzzingState } from "./FuzzingState";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { IEvmEvents } from "../../../lib/utils/events/IEvmEvents";
import { TruffleTransactionInterceptor } from "./TransactionInterceptor";

export class FuzzingRunner extends ScopedRunner {
    constructor(
        public context: AssetContext,
        public eventDecoder: Web3EventDecoder,
        public interceptor: TruffleTransactionInterceptor,
        public timeline: FuzzingTimeline,
        public truffleEvents: IEvmEvents,
        public chainEvents: UnderlyingChainEvents,
        public state: FuzzingState,
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

    log(text: string) {
        this.interceptor.log(text);
    }
    
    comment(text: string) {
        this.interceptor.comment(text);
    }
}
