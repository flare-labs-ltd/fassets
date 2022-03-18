import { Contract } from "ethers";
import { TypedEventFilter } from "../../typechain/common";

export interface BaseEvent {
    address: string;
    event: string;
    args: any;
}

export interface TypedEvent<A> extends BaseEvent {
    args: A;
}

export interface TruffleEvent extends Truffle.TransactionLog<any> {
    signature: string;
}

export type EventArgs<E extends Truffle.AnyEvent> = Truffle.TransactionLog<E>['args'];

// truffle typed event filtering

export function findEvent<E extends Truffle.AnyEvent, N extends E['name']>(log: Truffle.TransactionLog<E>[], name: N): Truffle.TransactionLog<Extract<E, { name: N }>> | undefined {
    return log.find(e => e.event === name) as any;
}

export function filterEvents<E extends Truffle.AnyEvent, N extends E['name']>(log: Truffle.TransactionLog<E>[], name: N): Truffle.TransactionLog<Extract<E, { name: N }>>[] {
    return log.filter(e => e.event === name) as any;
}

export function eventIs<T extends Truffle.AnyEvent>(event: BaseEvent, name: string): event is Truffle.TransactionLog<T> {
    return event.event === name;
}

export function findRequiredEvent<E extends Truffle.AnyEvent, N extends E['name']>(response: Truffle.TransactionResponse<E>, name: N): Truffle.TransactionLog<Extract<E, { name: N }>> {
    const event = findEvent(response.logs, name);
    assert.isNotNull(event, `Missing event ${name}`);
    return event!;
}

export function requiredEventArgs<E extends Truffle.AnyEvent, N extends E['name']>(response: Truffle.TransactionResponse<E>, name: N): EventArgs<Extract<E, { name: N }>> {
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
