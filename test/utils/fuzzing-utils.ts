import BN from "bn.js";
import { BigNumber } from "ethers";
import { readFileSync, writeFileSync } from "fs";
import { toBN } from "./helpers";

export class Statistics {
    min?: number;
    max?: number;
    count: number = 0;
    sum: number = 0;

    get average() {
        return this.count > 0 ? this.sum / this.count : undefined;
    }

    add(x: BN | number) {
        if (typeof x !== 'number') x = x.toNumber();
        if (this.min == undefined || this.min > x) this.min = x;
        if (this.max == undefined || this.max < x) this.max = x;
        this.count += 1;
        this.sum += x;
    }

    toString(decimals = 2) {
        const min = this.min?.toFixed(decimals) ?? '---';
        const max = this.max?.toFixed(decimals) ?? '---';
        const avg = this.average?.toFixed(decimals) ?? '---';
        return `n: ${this.count}  min: ${min}  avg: ${avg}  max: ${max}`;
    }
}

export function toNumber(x: BN | BigNumber | number | string) {
    if (typeof x === 'number') return x;
    return Number(x.toString());
}

export function jsonBNserializer(this: any, key: any, serializedValue: any) {
    const value = this[key];
    return BN.isBN(value) ? value.toString(10) : serializedValue;
}

export function jsonBNDeserializer(bnKeys: string[]) {
    return function (key: any, value: any) {
        return bnKeys.includes(key) ? toBN(value) : value;
    }
}

export function saveJson(file: string, data: any, indent?: string | number) {
    writeFileSync(file, JSON.stringify(data, jsonBNserializer, indent));
}

export function loadJson(file: string, bnKeys: string[] = []) {
    const buf = readFileSync(file);
    return JSON.parse(buf.toString(), jsonBNDeserializer(bnKeys));
}

// start is inclusive, end is exclusive
export function randomInt(end: number): number;
export function randomInt(start: number, end: number): number;
export function randomInt(startOrEnd: number, endOpt?: number): number {
    const [start, end] = endOpt !== undefined ? [startOrEnd, endOpt] : [0, startOrEnd];
    return Math.floor(start + Math.random() * (end - start));
}

// start is inclusive, end is exclusive
export function randomNum(end: number): number;
export function randomNum(start: number, end: number): number;
export function randomNum(startOrEnd: number, endOpt?: number): number {
    const [start, end] = endOpt !== undefined ? [startOrEnd, endOpt] : [0, startOrEnd];
    return start + Math.random() * (end - start);
}

// random must return random number on interval [0, 1)
export function randomIntDist(start: number, end: number, random: () => number): number {
    return Math.floor(start + random() * (end - start));
}

// retrun random in [0, 1) with probability density falling linearly from 1 to 0
export function linearFallingRandom() {
    return Math.abs(Math.random() + Math.random() - 1);
}

// (unfair) coin flip - returns true with probability p
export function coinFlip(p: number = 0.5) {
    return Math.random() < p;
}

export function randomChoice<T>(choices: readonly T[], avoid?: T): T {
    if (choices.length === 0) throw new Error("Random choice from empty array.")
    if (avoid === undefined) {
        return choices[randomInt(choices.length)];
    } else {
        const ind = randomInt(choices.length - 1);
        if (choices[ind] !== avoid) return choices[ind];
        if (choices.length === 1) throw new Error("No avoidable choices.");
        return choices[choices.length - 1];
    }
}

export function weightedRandomChoice<T>(choices: readonly (readonly [T, number])[]): T {
    if (choices.length === 0) throw new Error("Random choice from empty array.")
    let total = 0;
    for (const [choice, weight] of choices) total += weight;
    const rnd = Math.random() * total;
    let cumulative = 0;
    for (const [choice, weight] of choices) {
        cumulative += weight;
        if (rnd < cumulative) return choice;
    }
    return choices[choices.length - 1][0]; // shouldn't arrive here, but just in case...
}

export function randomShuffle(array: any[]) {
    const length = array.length;
    for (let i = 0; i < length - 1; i++) {
        const j = randomInt(i, length);
        [array[i], array[j]] = [array[j], array[i]];
    }
}

export function randomShuffled<T>(array: T[] | Iterable<T>): T[] {
    const copy = Array.from(array);
    randomShuffle(copy);
    return copy;
}

// current time in seconds (not an integer)
export function currentRealTime() {
    return new Date().getTime() / 1000;
}
