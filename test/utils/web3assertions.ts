import { web3Normalize, web3DeepNormalize } from "../../lib/utils/web3normalize";

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
