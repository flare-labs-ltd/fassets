import { AssetManagerEvents } from "../../integration/utils/AssetContext";
import { ExtractedEventArgs } from "../../utils/events";
import { FuzzingRunner } from "./FuzzingRunner";

export class FuzzingActor {
    constructor(
        public runner: FuzzingRunner,
    ) { }
    
    context = this.runner.context;
    timeline = this.runner.timeline;
    truffleEvents = this.runner.truffleEvents;
    chainEvents = this.runner.chainEvents;
    avoidErrors = this.runner.avoidErrors;

    comment(msg: string) {
        this.runner.interceptor.comment(msg);
    }
    
    assetManagerEvent<N extends AssetManagerEvents['name']>(event: N, filter?: Partial<ExtractedEventArgs<AssetManagerEvents, N>>) {
        return this.truffleEvents.event(this.context.assetManager, event, filter);
    }

    formatAddress(address: string) {
        return this.runner.eventDecoder.formatAddress(address);
    }
}
