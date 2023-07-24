import baseX from 'base-x'
import { expect } from "chai";
import { Base58MockInstance } from "../../../typechain-truffle";

const BASE58_CHARS = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz'
const codec = baseX(BASE58_CHARS)

const Base58 = artifacts.require("Base58Mock");

function randomBase58Chars(length: number) {
    const chars = []
    for (let _ = 0; _ < length; _++) {
        chars.push(BASE58_CHARS.charAt(Math.floor(Math.random() * BASE58_CHARS.length)))
    }
    return chars.join('')
}

describe("Tests for base58 library", () => {
    let base58: Base58MockInstance;

    beforeEach(async () => {
        base58 = await Base58.new();
    });

    it("should base58 decode if ACC_BYTES=64 divides byte length of input", async () => {
        const input = randomBase58Chars(64);
        const inputBufferHex = "0x" + Buffer.from(input, 'utf8').toString('hex');
        const charsBufferHex = "0x" + Buffer.from(BASE58_CHARS, 'utf8').toString('hex');
        const decoded = await base58.decode(inputBufferHex, charsBufferHex);
        assert(decoded[1]);
        expect(decoded[0]).to.equal("0x" + codec.decode(input).toString('hex'));
    });

    it("should reach the end return statement", async () => {
        const input = "rrrrrrrrrrrrrrrrrrrr";
        const inputBufferHex = "0x" + Buffer.from(input, 'utf8').toString('hex');
        const charsBufferHex = "0x" + Buffer.from(BASE58_CHARS, 'utf8').toString('hex');
        const decoded = await base58.decode(inputBufferHex, charsBufferHex);
        assert(decoded[1]);
        expect(decoded[0]).to.equal("0x" + codec.decode(input).toString('hex'));
    });
});