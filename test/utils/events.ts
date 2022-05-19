import { Contract } from "ethers";
import { TypedEventFilter } from "../../typechain/common";

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

export interface TypedEvent<A> extends BaseEvent {
    args: A;
}

export interface SelectedEvent<E extends EventSelector> extends BaseEvent {
    event: E['name'];
    args: E['args'];
}

export interface TruffleEvent extends Truffle.TransactionLog<any> {
    signature: string;
}

export type EventArgs<E extends EventSelector> = SelectedEvent<E>['args'];

export type ExtractEvent<E extends EventSelector, N extends E['name']> = SelectedEvent<Extract<E, { name: N }>>;

export type ExtractedEventArgs<E extends EventSelector, N extends E['name']> = ExtractEvent<E, N>['args'];

// truffle typed event filtering

export type TruffleExtractEvent<E extends EventSelector, N extends E['name']> = Truffle.TransactionLog<Extract<E, { name: N }>>;

export function findEvent<E extends EventSelector, N extends E['name']>(log: Truffle.TransactionLog<E>[], name: N): TruffleExtractEvent<E, N> | undefined {
    return log.find(e => e.event === name) as any;
}

export function filterEvents<E extends EventSelector, N extends E['name']>(log: Truffle.TransactionLog<E>[], name: N): TruffleExtractEvent<E, N>[] {
    return log.filter(e => e.event === name) as any;
}

export type ContractWithEventsBase = Truffle.ContractInstance & { '~eventMarker'?: any };
export type ContractWithEvents<C extends Truffle.ContractInstance, E extends EventSelector> = C & { '~eventMarker'?: E };

export type ContractTypeFor<T> = T extends ContractWithEvents<infer C, infer E> ? C : never;
export type EventNamesFor<T> = T extends ContractWithEvents<infer C, infer E> ? E['name'] : never;
export type EventForName<T, N extends EventNamesFor<T>> = T extends ContractWithEvents<infer C, infer E> ? ExtractEvent<E, N> : never;
export type EventArgsForName<T, N extends EventNamesFor<T>> = T extends ContractWithEvents<infer C, infer E> ? ExtractedEventArgs<E, N> : never;

export type EventsForMethod<C extends Truffle.ContractInstance, M extends keyof C> =
    C[M] extends (...args: any) => Promise<Truffle.TransactionResponse<infer E>> ? E : never;
    
export type ContractWithEventsForMethod<C extends Truffle.ContractInstance, M extends keyof C> = 
    ContractWithEvents<C, EventsForMethod<C, M>>;
    
export function contractWithEvents<T>(contract: ContractTypeFor<T>): T;
export function contractWithEvents<C extends Truffle.ContractInstance, M extends keyof C>(contract: C, anyMethod: M): ContractWithEventsForMethod<C, M>;
export function contractWithEvents(contract: Truffle.ContractInstance, anyMethod?: unknown) {
    return contract; // ~eventMarker are just marker for correct type, no value can ever be extracted
}

export function eventIs<C extends Truffle.ContractInstance, E extends EventSelector, N extends E['name']>(event: BaseEvent, source: ContractWithEvents<C, E>, eventName: N): event is TruffleExtractEvent<E, N> {
    return event.address === source.contract.address && event.event === eventName;
} 

export function syntheticEventIs<E extends BaseEvent>(event: BaseEvent, eventName: E['event']): event is E {
    return event.event === eventName;
}

export function findRequiredEvent<E extends EventSelector, N extends E['name']>(response: Truffle.TransactionResponse<E>, name: N): TruffleExtractEvent<E, N> {
    const event = findEvent(response.logs, name);
    assert.isDefined(event, `Missing event ${name}`);
    return event!;
}

export function checkEventNotEmited<E extends EventSelector, N extends E['name']>(response: Truffle.TransactionResponse<E>, name: N) {
    const event = findEvent(response.logs, name);
    assert.isUndefined(event, `Event ${name} emited`);
}

export function eventArgs<E extends EventSelector, N extends E['name']>(response: Truffle.TransactionResponse<E>, name: N): ExtractedEventArgs<E, N> {
    return findEvent(response.logs, name)?.args;
}

export function requiredEventArgs<E extends EventSelector, N extends E['name']>(response: Truffle.TransactionResponse<E>, name: N): ExtractedEventArgs<E, N> {
    return findRequiredEvent(response, name).args;
}

// ethers typed event filtering

export type EthersEventKeys<T extends { filters: {} }> = keyof T['filters'];

export type EthersEventArgs<T extends { filters: {} }, E extends keyof T['filters']> =
    T['filters'][E] extends (...args: any) => infer R ?
    (R extends TypedEventFilter<infer A> ? A : never) : never;

export type EthersEventType<T extends { filters: {} }, E extends keyof T['filters']> =
    TypedEvent<EthersEventArgs<T, E>>;

export function ethersFindEvent<T extends Contract, E extends EthersEventKeys<T>>(events: BaseEvent[], contract: T, eventName: E, start: number = 0, end: number = events.length): EthersEventType<T, E> | undefined {
    for (let i = start; i < end; i++) {
        const event = events[i];
        if (event.address === contract.address && event.event === eventName) {
            return event;
        }
    }
}

export function ethersFilterEvents<T extends Contract, E extends EthersEventKeys<T>>(events: BaseEvent[], contract: T, eventName: E, start: number = 0, end: number = events.length): EthersEventType<T, E>[] {
    const result: EthersEventType<T, E>[] = [];
    for (let i = start; i < end; i++) {
        const event = events[i];
        if (event.address === contract.address && event.event === eventName) {
            result.push(event);
        }
    }
    return result;
}

export function ethersEventIs<T extends Contract, E extends EthersEventKeys<T>>(event: BaseEvent, contract: T, eventName: E): event is EthersEventType<T, E> {
    return event.address === contract.address && event.event === eventName;
}
