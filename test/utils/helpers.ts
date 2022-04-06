import BN from "bn.js";
import { BigNumber } from "ethers";
import Web3 from "web3";

export type BNish = BN | number | string;

export type Nullable<T> = T | null | undefined;

export type Dict<T> = { [key: string]: T };

export const BN_ZERO = new BN(0);

export const BIG_NUMBER_ZERO = BigNumber.from(0);

export const BYTES32_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

export const MAX_BIPS = 10_000;

export const MINUTES = 60;
export const HOURS = 60 * MINUTES;
export const DAYS = 24 * HOURS;
export const WEEKS = 7 * DAYS;

/**
 * Asynchronously wait `ms` milliseconds.
 */
export async function sleep(ms: number) {
    await new Promise<void>(resolve => setTimeout(() => resolve(), ms));
}

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
 * Check if value is non-null.
 * Useful in array.filter, to return array of non-nullable types.
 */
export function isNotNull<T>(x: T): x is NonNullable<T> {
    return x != null;
}

/**
 * Helper wrapper to convert number to BN 
 * @param x number expressed in any reasonable type
 * @returns same number as BN
 */
export function toBN(x: BN | BigNumber | number | string): BN {
    if (x instanceof BN) return x;
    if (x instanceof BigNumber) return new BN(x.toHexString().slice(2), 16)
    return Web3.utils.toBN(x);
}

/**
 * Helper wrapper to convert BN, BigNumber or plain string to number. May lose precision, so use it for tests only.
 * @param x number expressed in any reasonable type
 * @returns same number as Number
 */
export function toNumber(x: BN | BigNumber | number | string) {
    if (typeof x === 'number') return x;
    return Number(x.toString());
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

/**
 * Check whether argument is either BN or BigNumber.
 */
export function isBigNumber(x: any): x is BigNumber | BN {
    return BN.isBN(x) || x instanceof BigNumber;
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

/**
 * Format large number in more readable format, using 'fixed-exponential' format, with 'e+18' suffix for very large numbers.
 * (This makes them easy to visually detect bigger/smaller numbers.)
 */
export function formatBN(x: BigNumber | BN | string | number) {
    const xs = x.toString();
    if (xs.length >= 18) {
        const dec = Math.max(0, 22 - xs.length);
        const xm = (Number(xs) / 1e18).toFixed(dec);
        return groupIntegerDigits(xm) + 'e+18';
    } else {
        return groupIntegerDigits(xs);
    }
}

function groupIntegerDigits(x: string) {
    let startp = x.indexOf('.');
    if (startp < 0) startp = x.length;
    for (let p = startp - 3; p > 0; p -= 3) {
        x = x.slice(0, p) + '_' + x.slice(p); x
    }
    return x;
}

/**
 * Convert value to hex with 0x prefix and optional padding.
 */
export function toHex(x: string | number | BN, padToBytes?: number) {
    if (padToBytes && padToBytes > 0) {
        return Web3.utils.leftPad(Web3.utils.toHex(x), padToBytes * 2);
    }
    return Web3.utils.toHex(x);
}
