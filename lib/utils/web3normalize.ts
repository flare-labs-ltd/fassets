import BN from "bn.js";
// import { BigNumber } from "ethers";

// convert primitive object to normalized form (mostly string)

/**
 * Web3/truffle sometimes returns numbers as BN and sometimes as strings and accepts strings, BN and numbers.
 * This function converts all number formats to string for simpler comparison.
 */
export function web3Normalize(x: any) {
    if (x == null)
        return null; // undefined also converted to null
    switch (typeof x) {
        case "boolean":
        case "string":
            return x;
        case "number":
        case "bigint":
            return "" + x;
        case "object":
            if (BN.isBN(x)) {
                return x.toString(10);
            }
            // if (BigNumber.isBigNumber(x)) {
            //     return x.toString();
            // }
            break;
    }
    throw new Error("Unsupported object type");
}

/**
 * Web3/truffle sometimes returns numbers as BN and sometimes as strings and accepts strings, BN and numbers.
 * This function converts all number formats to string for simpler comparison.
 * Also converts all struct and array members recursively.
 */
export function web3DeepNormalize<T = any>(value: T): T {
    function normalizeArray(arr: any[]) {
        const result: any[] = [];
        visited.add(arr);
        for (const v of arr) {
            result.push(normalizeImpl(v));
        }
        visited.delete(arr);
        return result;
    }
    function normalizeObject(obj: any[]) {
        if (obj.constructor !== Object) {
            throw new Error(`Unsupported object type ${obj.constructor.name}`);
        }
        const result: any = {};
        visited.add(obj);
        for (const [k, v] of Object.entries(obj)) {
            result[k] = normalizeImpl(v);
        }
        visited.delete(obj);
        return result;
    }
    function normalizeImpl(obj: any): any {
        if (obj == null) {
            return null; // undefined also converted to null
        } else if (visited.has(obj)) {
            throw new Error("Circular structure");
        } else if (typeof obj === "object") {
            if (BN.isBN(obj)) {
                return obj.toString(10);
            // } else if (BigNumber.isBigNumber(obj)) {
            //     return obj.toString();
            } else if (Array.isArray(obj)) {
                return normalizeArray(obj);
            } else {
                return normalizeObject(obj);
            }
        } else {
            return web3Normalize(obj); // normalize as primitive
        }
    }
    const visited = new Set<any>();
    return normalizeImpl(value);
}
