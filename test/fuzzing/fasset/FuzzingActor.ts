import { AssetManagerEvents } from "../../../lib/fasset/IAssetContext";
import { ExtractedEventArgs } from "../../../lib/utils/events/common";
import { FuzzingRunner } from "./FuzzingRunner";

export class FuzzingActor {
    constructor(
        public runner: FuzzingRunner,
    ) { }

    context = this.runner.context;
    state = this.runner.state;
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

    getContract<T extends Truffle.ContractInstance>(address: string) {
        return this.runner.interceptor.getContract<T>(address);
    }

    formatAddress(address: string) {
        return this.runner.eventDecoder.formatAddress(address);
    }
}
