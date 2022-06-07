import { AssetManagerEvents } from "../../integration/utils/AssetContext";
import { ExtractedEventArgs } from "../../utils/events";
import { FuzzingRunner } from "./FuzzingRunner";
import { EventScope } from "./ScopedEvents";

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

    formatAddress(address: string) {
        return this.runner.eventDecoder.formatAddress(address);
    }
    
    async waitForUnderlyingTransaction(scope: EventScope, txHash: string, maxBlocksToWaitForTx?: number) {
        const transaction = await this.context.chain.getTransaction(txHash);
        if (transaction != null) return transaction;
        const waitBlocks = maxBlocksToWaitForTx ?? Math.max(this.context.chain.finalizationBlocks, 1);
        const event = await Promise.race([
            this.chainEvents.transactionEvent({ hash: txHash }).qualified('found').wait(scope),
            this.timeline.underlyingBlocks(waitBlocks).qualified('timeout').wait(scope),
        ]);
        return event.name === 'found' ? event.args : null;
    }
    
    async waitForUnderlyingTransactionFinalization(scope: EventScope, txHash: string, maxBlocksToWaitForTx?: number) {
        const tx = await this.waitForUnderlyingTransaction(scope, txHash, maxBlocksToWaitForTx);
        if (tx == null) return false;
        // find transaction block
        const block = await this.context.chain.getTransactionBlock(txHash);
        if (block == null) return false;
        // wait for finalization
        await this.timeline.underlyingBlockNumber(block.number + this.context.chain.finalizationBlocks).wait(scope);
        return true;
    }
}
