// same as Trufle.AnyEvent
export interface EventSelector {
    name: string;
    args: any;
}

export interface BaseEvent {
    address: string;
    event: string;
    args: any;
}

export interface EvmEvent {
    address: string;
    event: string;
    args: any;
    blockHash: string;
    blockNumber: number;
    logIndex: number;
    transactionHash: string;
    transactionIndex: number;
    type: string;
    signature: string;
}

export interface TypedEvent<A> extends BaseEvent {
    args: A;
}

export interface SelectedEvent<E extends EventSelector> extends BaseEvent {
    event: E['name'];
    args: E['args'];
}

export type NamedFields<T> = Omit<T, number>;

export type EventArgs<E extends EventSelector> = NamedFields<SelectedEvent<E>['args']>;

export type ExtractEvent<E extends EventSelector, N extends E['name']> = SelectedEvent<Extract<E, { name: N; }>>;

export type ExtractedEventArgs<E extends EventSelector, N extends E['name']> = NamedFields<ExtractEvent<E, N>['args']>;
