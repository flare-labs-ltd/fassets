import BN from "bn.js";
import { BigNumber } from "ethers";
import { toStringExp } from "../../lib/utils/helpers";

export const BIG_NUMBER_ZERO = BigNumber.from(0);

// return BigNumber(x * 10^exponent)
export function toBigNumberExp(x: number | string, exponent: number): BigNumber {
    return BigNumber.from(toStringExp(x, exponent));
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
