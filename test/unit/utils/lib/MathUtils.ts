import { expect } from "chai";
import { MathUtilsMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";

const MathUtils = artifacts.require("MathUtilsMock");

contract(`MathUtils.sol; ${getTestFile(__filename)};  MathUtils unit tests`, async accounts => {
    let mathUtils: MathUtilsMockInstance;
    before(async() => {
        mathUtils = await MathUtils.new();
    });

    it("should calculate correctly - round up", async () => {
        let result = await mathUtils.roundUp(21, 4);
        expect(result.toNumber()).to.equals(24);
    });

    it("should calculate correctly - no rounding", async () => {
        let result = await mathUtils.roundUp(20, 4);
        expect(result.toNumber()).to.equals(20);
    });
});
