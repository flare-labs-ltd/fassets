import { EventArgs, EventSelector, EvmEvent } from "./common";
import { EventEmitter } from "./ScopedEvents";
import { ContractWithEventsBase, EventArgsForName, EventNamesFor } from "./truffle";

export type EvmEventArgs<E extends EventSelector> = EventArgs<E> & { $event: EvmEvent; };
export type EvmEventArgsForName<T, N extends EventNamesFor<T>> = EventArgsForName<T, N> & { $event: EvmEvent; };

export interface IEvmEvents {
    event<C extends ContractWithEventsBase, N extends EventNamesFor<C>>(contract: C, event: N, filter?: Partial<EventArgsForName<C, N>>): EventEmitter<EvmEventArgsForName<C, N>>;
}
