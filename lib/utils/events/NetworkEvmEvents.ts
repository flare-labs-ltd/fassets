import { EvmEventArgsForName, IEvmEvents } from "./IEvmEvents";
import { ClearableSubscription, EventEmitter, EventExecutionQueue } from "./ScopedEvents";
import { ContractWithEventsBase, EventArgsForName, EventNamesFor } from "./truffle";

export class NetworkEvmEvents implements IEvmEvents {
    constructor(
        private eventQueue: EventExecutionQueue | null,
    ) { }
    
    event<C extends ContractWithEventsBase, N extends EventNamesFor<C>>(contract: C, event: N, filter?: Partial<EventArgsForName<C, N>>): EventEmitter<EvmEventArgsForName<C, N>> {
        return new EventEmitter<EvmEventArgsForName<C, N>>(this.eventQueue, handler => {
            const emitter = contract.allEvents({ filter: filter as any });
            emitter.addListener(event, handler);
            return ClearableSubscription.of(() => emitter.removeListener(event, handler));
        });
    }
}
