import { expectEvent } from "@openzeppelin/test-helpers";
import { FtsoManagerMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/helpers";

const FtsoManagerMock = artifacts.require('FtsoManagerMock');

contract(`FtsoManagerMock.sol; ${getTestFile(__filename)}; Ftso manager mock basic tests`, async accounts => {
    let ftsoManager: FtsoManagerMockInstance;

    describe("create and set", () => {
        it("should create", async () => {
            ftsoManager = await FtsoManagerMock.new();
        });
        it("should emit event at price epoch finalization", async () => {
            ftsoManager = await FtsoManagerMock.new();
            expectEvent(await ftsoManager.mockFinalizePriceEpoch(), "PriceEpochFinalized");
        });
    });
});