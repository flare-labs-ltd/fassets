import { IBlockChainEvents, IBlockId, ITransaction } from "./ChainInterfaces";
import { ClearableSubscription, EventEmitter, EventExecutionQueue } from "./ScopedEvents";

export class UnderlyingChainEvents {
    constructor(
        private events: IBlockChainEvents,
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
}
