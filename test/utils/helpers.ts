import BN from "bn.js";
import { BigNumber } from "ethers";

export type BNish = BN | number | string;

export type Dict<T> = { [key: string]: T };

export const BN_ZERO = new BN(0);

export const BIG_NUMBER_ZERO = BigNumber.from(0);

export const MAX_BIPS = 10_000;

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
export function toStringExp(x: number, exponent: number): string {
    const significantDecimals = x !== 0 ? Math.max(0, 14 - Math.floor(Math.log10(x))) : 0;
    const precision = Math.min(exponent, significantDecimals);
    const xstr = x.toFixed(precision);
    const dot = xstr.indexOf('.');
    const mantissa = xstr.slice(0, dot) + xstr.slice(dot + 1);
    if (precision === exponent) return mantissa;
    const zeros = Array.from({ length: exponent - precision }, () => '0').join('');   // trailing zeros
    return mantissa + zeros;
}

// return BN(x * 10^exponent)
export function toBNExp(x: number, exponent: number): BN {
    return toBN(toStringExp(x, exponent));
}

// return BigNumber(x * 10^exponent)
export function toBigNumberFixedPrecision(x: number, exponent: number): BigNumber {
    return BigNumber.from(toStringExp(x, exponent));
}
