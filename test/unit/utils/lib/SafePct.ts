import { expectRevert } from "@openzeppelin/test-helpers";
import { expect } from "chai";
import { toBN } from "../../../../lib/utils/helpers";
import { SafePctMockInstance } from "../../../../typechain-truffle/SafePctMock";
import { getTestFile } from "../../../utils/test-helpers";

const SafePct = artifacts.require("SafePctMock");

contract(`SafePct.sol; ${getTestFile(__filename)};  SafePct unit tests`, async accounts => {
    let safePct: SafePctMockInstance;
    before(async() => {
        safePct = await SafePct.new();
    });

    it("should calculate correctly", async () => {
        let result = await safePct.mulDiv(2, 3, 4);
        expect(result.toNumber()).to.equals(1);
    });

    it("should calculate correctly - first factor equals 0", async () => {
        let result = await safePct.mulDiv(0, 3, 4);
        expect(result.toNumber()).to.equals(0);
    });

    it("should calculate correctly - second factor equals 0", async () => {
        let result = await safePct.mulDiv(2, 0, 4);
        expect(result.toNumber()).to.equals(0);
    });

    it("should revert - division by 0", async () => {
        let tx = safePct.mulDiv(2, 3, 0);
        await expectRevert(tx, "Division by zero");
    });

    it("should calculate correctly - no overflow", async () => {
        let result = await safePct.mulDiv(toBN(2).pow(toBN(225)), toBN(2).pow(toBN(225)), toBN(2).pow(toBN(200)));
        expect(result.eq(toBN(2).pow(toBN(250)))).to.be.true;
    });
});
