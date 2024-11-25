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

    it("should calculate correctly - sub or zero (positive result)", async () => {
        let result = await mathUtils.subOrZero(20, 4);
        expect(result.toNumber()).to.equals(16);
    });

    it("should calculate correctly - sub or zero (positive result)", async () => {
        let result = await mathUtils.subOrZero(4, 20);
        expect(result.toNumber()).to.equals(0);
    });
});
