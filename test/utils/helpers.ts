import BN from "bn.js";
import { BigNumber } from "ethers";
import { findEvent } from "flare-smart-contracts/test/utils/EventDecoder";

export type BNish = BN | number | string;

export type Dict<T> = { [key: string]: T };

export const BN_ZERO = new BN(0);

export const BIG_NUMBER_ZERO = BigNumber.from(0);

export const MAX_BIPS = 10_000;

export type EventArgs<E extends Truffle.AnyEvent> = Truffle.TransactionLog<E>['args'];

/**
 * Return system time as timestamp (seconds since 1.1.1970).
 */
export function systemTimestamp() {
    return Math.round(new Date().getTime() / 1000);
}

/**
 * Returns truncated file path.
 * @param file module filename
 * @returns file path from `test/` on, separated by `'/'`
 */
export function getTestFile(myFile: string) {
    return myFile.slice(myFile.replace(/\\/g, '/').indexOf("test/"));
};

/**
 * Like Array.map but for JavaScript objects.
 */
export function objectMap<T, R>(obj: { [key: string]: T }, func: (x: T) => R): { [key: string]: R } {
    const result: { [key: string]: R } = {};
    for (const key of Object.keys(obj)) {
        result[key] = func(obj[key]);
    }
    return result;
}

/**
 * Helper wrapper to convert number to BN 
 * @param x number expressed in any reasonable type
 * @returns same number as BN
 */
export function toBN(x: BN | BigNumber | number | string): BN {
    if (x instanceof BN) return x;
    if (x instanceof BigNumber) return new BN(x.toHexString().slice(2), 16)
    return web3.utils.toBN(x);
}

/**
 * Helper wrapper to convert number to Ethers' BigNumber 
 * @param x number expressed in any reasonable type
 * @returns same number as BigNumber
 */
export function toBigNumber(x: BN | BigNumber | number | string): BigNumber {
    if (x instanceof BigNumber) return x;
    if (x instanceof BN) return BigNumber.from(`0x${x.toString(16)}`);
    return BigNumber.from(x);
}

// return String(Math.round(x * 10^exponent)), but sets places below float precision to zero instead of some random digits
export function toStringExp(x: number | string, exponent: number): string {
    let xstr: string;
    if (typeof x === 'number') {
        const significantDecimals = x !== 0 ? Math.max(0, 14 - Math.floor(Math.log10(x))) : 0;
        const decimals = Math.min(exponent, significantDecimals);
        xstr = x.toFixed(decimals);
    } else {
        xstr = x.indexOf('.') >= 0 ? x : x + ".";   // always add dot
    }
    const dot = xstr.indexOf('.');
    const mantissa = xstr.slice(0, dot) + xstr.slice(dot + 1);
    const precision = xstr.length - (dot + 1);
    if (precision === exponent) return mantissa;
    assert.isTrue(exponent >= precision, "toStringExp: loss of precision");
    const zeros = Array.from({ length: exponent - precision }, () => '0').join('');   // trailing zeros
    return mantissa + zeros;
}

// return BN(x * 10^exponent)
export function toBNExp(x: number | string, exponent: number): BN {
    return toBN(toStringExp(x, exponent));
}

// return BigNumber(x * 10^exponent)
export function toBigNumberExp(x: number | string, exponent: number): BigNumber {
    return BigNumber.from(toStringExp(x, exponent));
}

// convert NAT amount to base units (wei)
export function toWei(amount: number | string) {
    return toBNExp(amount, 18);
}

export function findRequiredEvent<E extends Truffle.AnyEvent, N extends E['name']>(response: Truffle.TransactionResponse<E>, name: N): Truffle.TransactionLog<Extract<E, { name: N }>> {
    const event = findEvent(response.logs, name);
    assert.isNotNull(event, `Missing event ${name}`);
    return event!;
}

export function requiredEventArgs<E extends Truffle.AnyEvent, N extends E['name']>(response: Truffle.TransactionResponse<E>, name: N): EventArgs<Extract<E, { name: N }>> {
    return findRequiredEvent(response, name).args;
}
