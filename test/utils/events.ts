import { BigNumber, Contract, ContractReceipt } from "ethers";
import { TypedEventFilter } from "../../typechain/common";
import { Log as EthersRawEvent, TransactionReceipt as EthersTransactionReceipt } from "@ethersproject/abstract-provider";
import { EthersEventDecoder } from "./EventDecoder";

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

export function checkEventNotEmited<E extends Truffle.AnyEvent, N extends E['name']>(response: Truffle.TransactionResponse<E>, name: N) {
    const event = findEvent(response.logs, name);
    assert.isUndefined(event, `Event ${name} emited`);
}

export function eventArgs<E extends Truffle.AnyEvent, N extends E['name']>(response: Truffle.TransactionResponse<E>, name: N): EventArgs<Extract<E, { name: N }>> {
    return findEvent(response.logs, name)?.args;
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

export type StringOrNumberForBigNum<T extends {}> =
    { [K in keyof T]: T[K] extends BigNumber ? BigNumber | string | number : T[K] };

export type SimpleEthersEventArgs<T extends { filters: {} }, E extends keyof T['filters']> =
    Omit<StringOrNumberForBigNum<EthersEventArgs<T, E>>, keyof typeof Array.prototype>;

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

export function expectEthersEvent<T extends Contract, E extends EthersEventKeys<T>>(tx: EthersTransactionReceipt | ContractReceipt, contract: T, eventName: E, args?: Partial<SimpleEthersEventArgs<T, E>>) {
    const eventDecoder = new EthersEventDecoder({ contract });
    const allEvents = eventDecoder.decodeEvents(tx);
    const events = ethersFilterEvents(allEvents, contract, eventName);
    if (events.length === 0) assert.fail(`Missing event ${eventName}`);
    if (args != undefined) {
        let mismatch: [string, any] | undefined;
        for (const event of events) {
            mismatch = Object.entries(args)
                .find(([k, v]) => (event.args as any)[k]?.toString() !== (v as any)?.toString());
            if (mismatch == null) return;  // found exact match
        }
        const [mismatchKey, mismatchValue] = mismatch!;
        assert.fail(`Event ${eventName} mismatch for '${mismatchKey}': ${mismatchValue} != ${(events[0].args as any)[mismatchKey]}`);
    }
}

export function expectEthersEventNotEmitted<T extends Contract, E extends EthersEventKeys<T>>(tx: EthersTransactionReceipt | ContractReceipt, contract: T, eventName: E) {
    const eventDecoder = new EthersEventDecoder({ contract });
    const allEvents = eventDecoder.decodeEvents(tx);
    const events = ethersFilterEvents(allEvents, contract, eventName);
    if (events.length > 0) assert.fail(`Expected event ${eventName} not to be emitted`);
}
