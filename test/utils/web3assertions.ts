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

export function assertWeb3Equal(actual: any, expected: any, message?: string) {
    assert.strictEqual(web3Normalize(actual), web3Normalize(expected), message);
}

export function assertWeb3DeepEqual(actual: any, expected: any, message?: string) {
    assert.deepStrictEqual(web3DeepNormalize(actual), web3DeepNormalize(expected), message);
}

export function assertWeb3ArrayEqual(actual: any[], expected: any[], message?: string) {
    assert.equal(actual.length, expected.length, message ?? `Expected array length ${actual.length} to equal ${expected.length}`);
    const an: any[] = web3DeepNormalize(actual);
    const bn: any[] = web3DeepNormalize(expected);
    for (let i = 0; i < an.length; i++) {
        assert.equal(an[i], bn[i], message ?? `Expected ${actual[i]} to equal ${expected[i]} at index ${i}`);
    }
}

export function assertWeb3SetEqual(actual: any[] | Iterable<any>, expected: any[] | Iterable<any>, message?: string) {
    const aset = new Set(web3DeepNormalize(actual));
    const bset = new Set(web3DeepNormalize(expected));
    for (const elt of aset) {
        assert.isTrue(bset.has(elt), message ?? `Element ${elt} missing in second set`);
    }
    for (const elt of bset) {
        assert.isTrue(aset.has(elt), message ?? `Element ${elt} missing in first set`);
    }
}
