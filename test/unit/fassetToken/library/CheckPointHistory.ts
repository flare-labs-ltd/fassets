import { expectRevert } from "@openzeppelin/test-helpers";
import { CheckPointHistoryMockContract, CheckPointHistoryMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";

const CheckPointHistoryMock = artifacts.require("CheckPointHistoryMock") as CheckPointHistoryMockContract;

contract(`CheckPointHistory.sol; ${getTestFile(__filename)}`, async accounts => {
    // a fresh contract for each test
    let checkPointHistoryMock: CheckPointHistoryMockInstance;

    // Do clean unit tests by spinning up a fresh contract for each test
    beforeEach(async () => {
        checkPointHistoryMock = await CheckPointHistoryMock.new();
    });

    it("Should store value now", async () => {
        // Assemble
        // Act
        await checkPointHistoryMock.writeValue(10);
        // Assert
        let value = await checkPointHistoryMock.valueAtNow();
        assert.equal(value as any, 10);
    });

    it("Should store values at checkpoints", async () => {
        const b = [];
        // Assemble
        b[0] = await web3.eth.getBlockNumber();
        await checkPointHistoryMock.writeValue(50);
        b[1] = await web3.eth.getBlockNumber();
        await checkPointHistoryMock.writeValue(10);
        b[2] = await web3.eth.getBlockNumber();
        await checkPointHistoryMock.writeValue(5);
        b[3] = await web3.eth.getBlockNumber();
        // Act
        let balanceAtBlock0 = await checkPointHistoryMock.valueAt(b[0]);
        let balanceAtBlock1 = await checkPointHistoryMock.valueAt(b[1]);
        let balanceAtBlock2 = await checkPointHistoryMock.valueAt(b[2]);
        let balanceAtBlock3 = await checkPointHistoryMock.valueAt(b[3]);
        // Assert
        assert.equal(balanceAtBlock0 as any, 0);
        assert.equal(balanceAtBlock1 as any, 50);
        assert.equal(balanceAtBlock2 as any, 10);
        assert.equal(balanceAtBlock3 as any, 5);
    });

    it("Should perform O(log(n)) search on checkpoints", async () => {
        // Assemble
        const b = [];
        for (let i = 0; i < 200; i++) {
            b[i] = await web3.eth.getBlockNumber();
            await checkPointHistoryMock.writeValue(i);
        }
        // Act
        const valueAt = checkPointHistoryMock.contract.methods.valueAt(b[100]).encodeABI();
        const gas = await web3.eth.estimateGas({ to: checkPointHistoryMock.address, data: valueAt });
        // Assert
        // This is actually 300000+ if checkpoints specifier is memory vs storage
        assert(gas < 75000);
    });

    it("Should delete old checkpoints", async () => {
        // Assemble
        const b = [];
        for (let i = 0; i < 10; i++) {
            await checkPointHistoryMock.writeValue(i);
            b.push(await web3.eth.getBlockNumber());
        }
        // Act
        const cleanupBlock = b[5];
        for (let i = 0; i < 4; i++) {
            await checkPointHistoryMock.cleanupOldCheckpoints(2, cleanupBlock);
        }
        // Assert
        for (let i = 0; i < 5; i++) {
            await expectRevert(checkPointHistoryMock.valueAt(b[i]), "CheckPointHistory: reading from cleaned-up block");
        }
        for (let i = 5; i < 10; i++) {
            const value = await checkPointHistoryMock.valueAt(b[i]);
            assert.equal(value.toNumber(), i);
        }
    });

    it("Delete old checkpoints shouldn't fail with empty history", async () => {
        // Assemble
        const cleanupBlock = await web3.eth.getBlockNumber();
        // Act
        await checkPointHistoryMock.cleanupOldCheckpoints(2, cleanupBlock);
        // Assert
        const value = await checkPointHistoryMock.valueAt(cleanupBlock);
        assert.equal(value.toNumber(), 0);
    });

});
