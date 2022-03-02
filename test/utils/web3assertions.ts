import BN from "bn.js";
import { BigNumber } from "ethers";

// Web3 returns struct results as union of array and struct, but later methods interpet it as an array.
// So this method just extracts all non-array properties.
export function web3ResultStruct<T>(value: T): T {
    const obj = value as any;
    const result: any = {};
    for (const key of Object.keys(obj)) {
        if (!/^\d+$/.test(key)) {
            result[key] = obj[key];
        }
    }
    return result;
}

// convert primitive object to normalized form (mostly string)
export function web3Normalize(x: any) {
    if (x == null) return null;     // undefined also converted to null
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
            if (BigNumber.isBigNumber(x)) {
                return x.toString();
            }
            break;
    }
    throw new Error("Unsupported object type");
}

export function web3DeepNormalize(value: any): any {
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
            return null;                // undefined also converted to null
        } else if (visited.has(obj)) {
            throw new Error("Circular structure");
        } else if (typeof obj === "object") {
            if (BN.isBN(obj)) {
                return obj.toString(10);
            } else if (BigNumber.isBigNumber(obj)) {
                return obj.toString();
            } else if (Array.isArray(obj)) {
                return normalizeArray(obj);
            } else {
                return normalizeObject(obj);
            }
        } else {
            return web3Normalize(obj);  // normalize as primitive
        }
    }
    const visited = new Set<any>();
    return normalizeImpl(value);
}

export function assertWeb3Equal(x: any, y: any, message?: string) {
    assert.strictEqual(web3Normalize(x), web3Normalize(y), message);
}

export function assertWeb3DeepEqual(x: any, y: any, message?: string) {
    assert.deepStrictEqual(web3DeepNormalize(x), web3DeepNormalize(y), message);
}

export function assertWeb3ArrayEqual(a: any[], b: any[], message?: string) {
    assert.equal(a.length, b.length, message ?? `Expected array length ${a.length} to equal ${b.length}`);
    const an: any[] = web3DeepNormalize(a);
    const bn: any[] = web3DeepNormalize(b);
    for (let i = 0; i < an.length; i++) {
        assert.equal(an[i], bn[i], message ?? `Expected ${a[i]} to equal ${b[i]} at index ${i}`);
    }
}

export function assertWeb3SetEqual(a: any[] | Iterable<any>, b: any[] | Iterable<any>, message?: string) {
    const aset = new Set(web3DeepNormalize(a));
    const bset = new Set(web3DeepNormalize(b));
    for (const elt of aset) {
        assert.isTrue(bset.has(elt), message ?? `Element ${elt} missing in second set`);
    }
    for (const elt of bset) {
        assert.isTrue(aset.has(elt), message ?? `Element ${elt} missing in first set`);
    }
}
