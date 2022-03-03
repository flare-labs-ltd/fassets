export type BNish = BN | number | string;

export function systemTimestamp() {
    return Math.round(new Date().getTime() / 1000);
}

export function objectMap<T, R>(obj: { [key: string]: T }, func: (x: T) => R): { [key: string]: R } {
    const result: { [key: string]: R } = {};
    for (const key of Object.keys(obj)) {
        result[key] = func(obj[key]);
    }
    return result;
}
