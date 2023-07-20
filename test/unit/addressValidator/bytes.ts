import * as crypto from 'crypto';
import { BytesMockInstance } from "../../../typechain-truffle";

const BytesMock = artifacts.require("BytesMock");

describe("Tests for bytes library", () => {
    let bytes: BytesMockInstance;

    beforeEach(async () => {
        bytes = await BytesMock.new();
    });

    it("should return false when comparing two different length bytes", async () => {
        const input1 = "0x" + crypto.randomBytes(32).toString('hex');
        const input2 = "0x" + crypto.randomBytes(33).toString('hex');
        assert(!(await bytes.equal(input1, input2)));
    })
});