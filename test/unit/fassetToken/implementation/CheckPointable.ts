import { expectRevert, time } from '@openzeppelin/test-helpers';
import { toBN } from '../../../../lib/utils/helpers';
import { CheckPointableMockContract, CheckPointableMockInstance } from '../../../../typechain-truffle';
import { getTestFile } from '../../../utils/test-helpers';

const CheckPointable = artifacts.require("CheckPointableMock") as CheckPointableMockContract;

contract(`CheckPointable.sol; ${getTestFile(__filename)}; CheckPointable unit tests`, async accounts => {
    // contains a fresh contract for each test
    let checkPointable: CheckPointableMockInstance;

    // Do clean unit tests by spinning up a fresh contract for each test
    beforeEach(async () => {
        checkPointable = await CheckPointable.new();
    });

    it("Should store historic balance for address", async () => {
        const b = [];
        // Assemble
        await checkPointable.mintForAtNow(accounts[1], 10);
        b[0] = await web3.eth.getBlockNumber();
        await checkPointable.mintForAtNow(accounts[1], 20);
        // Act
        let value = await checkPointable.balanceOfAt(accounts[1], b[0]);
        // Assert
        assert.equal(value as any, 10);
    });

    it("Should store historic supply", async () => {
        const b = [];
        // Assemble
        await checkPointable.mintForAtNow(accounts[1], 10);
        await checkPointable.mintForAtNow(accounts[2], 20);
        b[0] = await web3.eth.getBlockNumber();
        await checkPointable.burnForAtNow(accounts[2], 10);
        // Act
        let value = await checkPointable.totalSupplyAt(b[0]);
        // Assert
        assert.equal(value as any, 30);
    });

    it("Should transmit value now for historic retrieval", async () => {
        const b = [];
        // Assemble
        await checkPointable.mintForAtNow(accounts[1], 10);
        await checkPointable.mintForAtNow(accounts[2], 20);
        // Act
        await checkPointable.transmitAtNow(accounts[2], accounts[1], 10);
        b[0] = await web3.eth.getBlockNumber();
        await checkPointable.burnForAtNow(accounts[2], 10);
        b[1] = await web3.eth.getBlockNumber();
        // Assert
        let account2PastValue = await checkPointable.balanceOfAt(accounts[2], b[0]);
        let account2Value = await checkPointable.balanceOfAt(accounts[2], b[1]);
        assert.equal(account2PastValue as any, 10);
        assert.equal(account2Value as any, 0);
    });

    it("Should set cleanup block", async () => {
        // Assemble
        await time.advanceBlock();
        const blk = await web3.eth.getBlockNumber();
        await time.advanceBlock();
        // Act
        await checkPointable.setCleanupBlockNumber(blk);
        // Assert
        const cleanblk = await checkPointable.getCleanupBlockNumber();
        assert.equal(cleanblk.toNumber(), blk);
    });

    it("Should check cleanup block validity", async () => {
        // Assemble
        await time.advanceBlock();
        const blk = await web3.eth.getBlockNumber();
        await time.advanceBlock();
        // Act
        await checkPointable.setCleanupBlockNumber(blk);
        // Assert
        await expectRevert(checkPointable.setCleanupBlockNumber(blk - 1), "Cleanup block number must never decrease");
        const blk2 = await web3.eth.getBlockNumber();
        await expectRevert(checkPointable.setCleanupBlockNumber(blk2 + 1), "Cleanup block must be in the past");
    });

    it("Should cleanup history", async () => {
        // Assemble
        await checkPointable.mintForAtNow(accounts[1], 100);
        await time.advanceBlock();
        const blk1 = await web3.eth.getBlockNumber();
        await checkPointable.transmitAtNow(accounts[1], accounts[2], toBN(10), { from: accounts[1] });
        const blk2 = await web3.eth.getBlockNumber();
        // Act
        await checkPointable.setCleanupBlockNumber(toBN(blk2));
        await checkPointable.transmitAtNow(accounts[1], accounts[2], toBN(10), { from: accounts[1] });
        const blk3 = await web3.eth.getBlockNumber();
        // Assert
        // should fail at blk1
        await expectRevert(checkPointable.balanceOfAt(accounts[1], blk1),
            "CheckPointable: reading from cleaned-up block");
        // and work at blk2
        const value = await checkPointable.balanceOfAt(accounts[1], blk2);
        assert.equal(value.toNumber(), 90);
        const value2 = await checkPointable.balanceOfAt(accounts[1], blk3);
        assert.equal(value2.toNumber(), 80);
    });

});
