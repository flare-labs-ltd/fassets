import BN from "bn.js";
import { readFileSync, writeFileSync } from "fs";
import { toBN } from "./helpers";

export function jsonBNserializer(this: any, key: any, serializedValue: any) {
    const value = this[key];
    return BN.isBN(value) ? value.toString(10) : serializedValue;
}

export function jsonBNDeserializer(bnKeys: string[]) {
    return function (key: any, value: any) {
        return bnKeys.includes(key) ? toBN(value) : value;
    }
}

// JSON.stringify with correct BN hamdling
export function stringifyJson(data: any, indent?: string | number) {
    return JSON.stringify(data, jsonBNserializer, indent);
}

export function parseJson(json: string, bnKeys: string[] = []) {
    return JSON.parse(json, jsonBNDeserializer(bnKeys));
}

export function saveJson(file: string, data: any, indent?: string | number) {
    writeFileSync(file, JSON.stringify(data, jsonBNserializer, indent));
}

export function loadJson(file: string, bnKeys: string[] = []) {
    const buf = readFileSync(file);
    return JSON.parse(buf.toString(), jsonBNDeserializer(bnKeys));
}
