import { AssetManagerEvents } from "../fasset/IAssetContext";
import { TrackedState } from "../state/TrackedState";
import { ExtractedEventArgs } from "../utils/events/common";
import { ScopedRunner } from "../utils/events/ScopedRunner";

export class ActorBase {
    constructor(
        public runner: ScopedRunner,
        public state: TrackedState,
    ) {
    }

    context = this.state.context;
    truffleEvents = this.state.truffleEvents;
    chainEvents = this.state.chainEvents;

    assetManagerEvent<N extends AssetManagerEvents['name']>(event: N, filter?: Partial<ExtractedEventArgs<AssetManagerEvents, N>>) {
        return this.truffleEvents.event(this.context.assetManager, event, filter);
    }

    formatAddress(address: string) {
        return this.state.eventFormatter.formatAddress(address);
    }

    log(text: string) {
        if (!this.state.logger) return;
        this.state.logger.log(text);
    }
}
