import { network } from "hardhat";

export class HardhatSnapshot<T = any> {
    constructor(
        public snapshotId: string,
        public variables: T,
    ) { }

    static async create<T>(variables: T): Promise<HardhatSnapshot<T>> {
        const snapshotId = await network.provider.send('evm_snapshot');
        const variablesCopy = deepCopy(variables, [{ test: isAnyClass }]);
        return new HardhatSnapshot(snapshotId, variablesCopy);
    }

    async revert(saveAgain: boolean = true): Promise<T> {
        const success: boolean = await network.provider.send('evm_revert', [this.snapshotId]);
        if (!success) throw new Error(`Cannot revert to ${this.snapshotId}`);
        if (saveAgain) {
            this.snapshotId = await network.provider.send('evm_snapshot');
        }
        return deepCopy(this.variables, [{ test: isAnyClass }]);
    }
}

function isAnyClass(obj: any) {
    return true;
}

function isTruffleContract(obj: any) {
    const c = obj as Truffle.ContractInstance;
    return typeof c.send === 'function' && typeof c.sendTransaction === 'function' &&
        typeof c.address === 'string' && Array.isArray(c.abi) && typeof c.contract === 'object';
}

function isInstance(cls: Function) {
    return (obj: any) => obj instanceof cls;
}

function isInstanceOfAny(...clsLst: Function[]) {
    return (obj: any) => clsLst.some(cls => obj instanceof cls);
}

export type DeepCopySpecialCase = {
    test: (x: any) => boolean;
    copy?: (x: any) => any;     // if omitted, object is not copied
};

export function deepCopy(object: any, specialCases: DeepCopySpecialCase[], copiedObjectsMap?: Map<any, any>) {
    copiedObjectsMap ??= new Map();
    if (copiedObjectsMap.has(object)) {
        // reference to already (partially) copied object, just return the already made copy
        // this also solves cirular object problem
        return copiedObjectsMap.get(object);
    }
    if (typeof object === "object") {
        if (object.constructor === Object) {
            const res: any = {};
            copiedObjectsMap.set(object, res);
            for (const key in object) {
                if (object.hasOwnProperty(key)) {
                    res[key] = deepCopy(object[key], specialCases, copiedObjectsMap);
                }
            }
            return res;
        } else if (object.constructor === Array) {
            const res: any[] = [];
            copiedObjectsMap.set(object, res);
            for (const elt of object) {
                res.push(deepCopy(elt, specialCases, copiedObjectsMap));
            }
            return res;
        } else if (typeof object.deepCopy === 'function') {
            // object has own deepCopy method
            return object.deepCopy(specialCases, copiedObjectsMap);
        } else {
            // one of special cases?
            const specialCase = specialCases.find(sc => sc.test(object));
            if (specialCase != null) {
                return specialCase.copy ? specialCase.copy(object) : object;
            } else {
                throw new Error(`Object contains invalid class ${object.constructor.name}`);
            }
        }
    } else {
        // atomic object (number, string, function, etc.) - return without copying
        return object;
    }
}
