import { IBlockChain, IBlockId, ITransaction } from "./interfaces/IBlockChain";
import { IBlockChainEvents } from "./interfaces/IBlockChainEvents";
import { ClearableSubscription, EventEmitter, EventExecutionQueue, EventScope } from "../utils/events/ScopedEvents";

export class UnderlyingChainEvents {
    constructor(
        public chain: IBlockChain,
        public events: IBlockChainEvents,
        public executionQueue: EventExecutionQueue | null
    ) { }

    blockEvent(): EventEmitter<IBlockId> {
        return new EventEmitter(this.executionQueue, handler => {
            const subscriptionId = this.events.addBlockHandler(handler);
            return ClearableSubscription.of(() => this.events.removeHandler(subscriptionId));
        });
    }
    
    blockHeightReachedEvent(height: number): EventEmitter<IBlockId> {
        return new EventEmitter(this.executionQueue, handler => {
            const subscriptionId = this.events.addBlockHandler(blockId => {
                if (blockId.number >= height) {
                    this.events.removeHandler(subscriptionId);
                    handler(blockId);
                }
            });
            return ClearableSubscription.of(() => this.events.removeHandler(subscriptionId));
        });
    }

    transactionEvent(filter: { [name: string]: string; } | null = null): EventEmitter<ITransaction> {
        return new EventEmitter(this.executionQueue, handler => {
            const subscriptionId = this.events.addTransactionHandler(filter, handler);
            return ClearableSubscription.of(() => this.events.removeHandler(subscriptionId));
        });
    }
    
    async waitForUnderlyingTransaction(scope: EventScope | undefined, txHash: string, maxBlocksToWaitForTx?: number) {
        const transaction = await this.chain.getTransaction(txHash);
        if (transaction != null) return transaction;
        const blockHeight = await this.chain.getBlockHeight();
        const waitBlocks = maxBlocksToWaitForTx ?? Math.max(this.chain.finalizationBlocks, 1);
        const event = await Promise.race([
            this.transactionEvent({ hash: txHash }).qualified('found').wait(scope),
            this.blockHeightReachedEvent(blockHeight + waitBlocks).qualified('timeout').wait(scope),
        ]);
        return event.name === 'found' ? event.args : null;
    }

    async waitForUnderlyingTransactionFinalization(scope: EventScope | undefined, txHash: string, maxBlocksToWaitForTx?: number) {
        const transaction = await this.waitForUnderlyingTransaction(scope, txHash, maxBlocksToWaitForTx);
        if (transaction == null) return null;
        // find transaction block
        const block = await this.chain.getTransactionBlock(txHash);
        if (block == null) return null;
        // wait for finalization
        await this.blockHeightReachedEvent(block.number + this.chain.finalizationBlocks).wait(scope);
        return transaction;
    }
}
