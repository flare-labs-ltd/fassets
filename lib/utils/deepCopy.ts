export interface DeepCopyable {
    deepCopyThis(copiedObjectsMap: Map<any, any>): this;
}

type DeepCopyFunction<T = any> = (object: T, copiedObjectsMap?: Map<any, any>) => T;

type DeepCopyCondition<T = any> = (object: T) => boolean;

const deepCopySpecialCases: Array<{ name: string, condition: DeepCopyCondition, copy: DeepCopyFunction }> = [];

function isInstance(cls: Function) {
    return (obj: any) => obj instanceof cls;
}

function isDeepCopyable(object: {}): object is DeepCopyable {
    return typeof (object as any).deepCopyThis === 'function';
}

export function setDeepCopyForClass<C extends { new(...args: any): any }>(classConstructor: C, copy: DeepCopyFunction<InstanceType<C>>) {
    setDeepCopyForCondition(classConstructor.name, isInstance(classConstructor), copy);
}

export function setDeepCopyForCondition<T>(name: string, condition: DeepCopyCondition<T>, copy: DeepCopyFunction<T>) {
    const index = deepCopySpecialCases.findIndex(sc => sc.name === name);
    if (index >= 0) return; // do not add twice
    deepCopySpecialCases.push({ name, condition, copy });
}

export function deepCopy<T>(object: T, copiedObjectsMap?: Map<any, any>): T {
    copiedObjectsMap ??= new Map();
    if (copiedObjectsMap.has(object)) {
        // reference to already (partially) copied object, just return the already made copy
        // this also solves cirular object problem
        return copiedObjectsMap.get(object);
    }
    if (typeof object === "object") {
        const specialCase = deepCopySpecialCases.find(sc => sc.condition(object));
        if (specialCase != null) {
            // object is one of predefined special cases, use the special copy function
            return specialCase.copy(object);
        } else if (object == null) {
            return object;
        } else if (object.constructor === Object) {
            const res: any = {};
            copiedObjectsMap.set(object, res);
            for (const key in object) {
                if (object.hasOwnProperty(key)) {
                    res[key] = deepCopy(object[key], copiedObjectsMap);
                }
            }
            return res;
        } else if (object.constructor === Array) {
            const res: any[] = [];
            copiedObjectsMap.set(object, res);
            for (const elt of object as any[]) {
                res.push(deepCopy(elt, copiedObjectsMap));
            }
            return res as T;
        } else if ((object.constructor as any).deepCopyWithObjectCreate) {
            // class object can be copied with deepCopyWithObjectCreate
            return deepCopyWithObjectCreate(object, copiedObjectsMap);
        } else if (isDeepCopyable(object)) {
            // object has own `deepCopyThis` method
            return object.deepCopyThis(copiedObjectsMap);
        } else {
            // do not copy classes if there is no special case method
            return object;
        }
    } else {
        // atomic object (number, string, function, etc.) - return without copying
        return object;
    }
}

export function deepCopyWithObjectCreate<T extends {}>(object: T, copiedObjectsMap: Map<any, any>): T {
    const res = Object.create(object.constructor.prototype, {
        constructor: { value: object.constructor, enumerable: false, writable: true, configurable: true },
    });
    copiedObjectsMap.set(object, res);
    for (const key in object) {
        if (object.hasOwnProperty(key)) {
            res[key] = deepCopy(object[key], copiedObjectsMap);
        }
    }
    return res;
}
