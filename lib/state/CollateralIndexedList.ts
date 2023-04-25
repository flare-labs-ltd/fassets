import { CollateralToken, CollateralTokenClass } from "../fasset/AssetManagerTypes";
import { BNish, requireNotNull } from "../utils/helpers";

// this is a superinterface of CollateralToken
export interface CollateralTokenId {
    tokenClass: BNish | CollateralTokenClass;
    token: string;
}

export class CollateralIndexedList<T> implements Iterable<T> {
    list: T[] = [];
    index: Map<String, number> = new Map();

    set(token: CollateralTokenId, value: T) {
        const key = collateralTokenKey(token.tokenClass, token.token);
        const index = this.index.get(key);
        if (index) {
            this.list[index] = value;
        } else {
            this.list.push(value);
            this.index.set(key, this.list.length - 1);
        }
    }

    [Symbol.iterator](): Iterator<T> {
        return this.list[Symbol.iterator]();
    }

    get(tokenClass: BNish | CollateralTokenClass, token: string): T;
    get(collateral: CollateralTokenId): T;
    get(cc: any, token?: any) {
        const index = requireNotNull(this.index.get(token ? collateralTokenKey(cc, token) : collateralTokenKey(cc.tokenClass, cc.token)));
        return this.list[index];
    }

    getOptional(tokenClass: BNish | CollateralTokenClass, token: string): T | undefined;
    getOptional(collateral: CollateralTokenId): T | undefined;
    getOptional(cc: any, token?: any) {
        const index = this.index.get(token ? collateralTokenKey(cc, token) : collateralTokenKey(cc.tokenClass, cc.token));
        return index != undefined ? this.list[index] : undefined;
    }
}

export class CollateralList extends CollateralIndexedList<CollateralToken> {
    add(value: CollateralToken) {
        this.set(value, value);
    }
}

export function isPoolCollateral(collateral: CollateralToken) {
    return Number(collateral.tokenClass) === CollateralTokenClass.POOL && Number(collateral.validUntil) === 0;
}

export function isClass1Collateral(collateral: CollateralToken) {
    return Number(collateral.tokenClass) === CollateralTokenClass.CLASS1 && Number(collateral.validUntil) === 0;
}

export function collateralTokenKey(tokenClass: BNish | CollateralTokenClass, token: string) {
    return `${tokenClass}|${token}`;
}

export function collateralTokensEqual(a: CollateralTokenId, b: CollateralTokenId) {
    return Number(a.tokenClass) === Number(b.tokenClass) && a.token === b.token;
}
