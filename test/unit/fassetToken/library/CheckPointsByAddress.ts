import { expectRevert } from "@openzeppelin/test-helpers";
import { CheckPointsByAddressMockContract, CheckPointsByAddressMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";
import { ZERO_ADDRESS } from "../../../../lib/utils/helpers";

const CheckPointsByAddressMock = artifacts.require("CheckPointsByAddressMock") as CheckPointsByAddressMockContract;

contract(`CheckPointsByAddress.sol; ${getTestFile(__filename)}`, async accounts => {
    // a fresh contract for each test
    let checkPointsByAddressMock: CheckPointsByAddressMockInstance;

    // Do clean unit tests by spinning up a fresh contract for each test
    beforeEach(async () => {
        checkPointsByAddressMock = await CheckPointsByAddressMock.new();
    });

    it("Should store value now for address 1", async () => {
        // Assemble
        await checkPointsByAddressMock.writeValue(accounts[1], 10);
        // Act
        let value = await checkPointsByAddressMock.valueOfAtNow(accounts[1]);
        // Assert
        assert.equal(value as any, 10);
    });

    it("Should store historic value for address 1", async () => {
        const b = [];

        // Assemble
        await checkPointsByAddressMock.writeValue(accounts[1], 10);
        b[0] = await web3.eth.getBlockNumber();
        // Act
        await checkPointsByAddressMock.writeValue(accounts[1], 20);
        // Assert
        let value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[0]);
        assert.equal(value as any, 10);
    });

    it("Should store value now for different addresses", async () => {
        // Assemble
        await checkPointsByAddressMock.writeValue(accounts[1], 10);
        await checkPointsByAddressMock.writeValue(accounts[2], 20);
        // Act
        let address1Value = await checkPointsByAddressMock.valueOfAtNow(accounts[1]);
        let address2Value = await checkPointsByAddressMock.valueOfAtNow(accounts[2]);
        // Assert
        assert.equal(address1Value as any, 10);
        assert.equal(address2Value as any, 20);
    });

    it("Should store value history for different addresses", async () => {
        const b = [];

        // Assemble
        b[0] = await web3.eth.getBlockNumber();
        await checkPointsByAddressMock.writeValue(accounts[1], 10);
        b[1] = await web3.eth.getBlockNumber();
        await checkPointsByAddressMock.writeValue(accounts[2], 20);
        b[2] = await web3.eth.getBlockNumber();
        await checkPointsByAddressMock.writeValue(accounts[1], 30);
        b[3] = await web3.eth.getBlockNumber();
        await checkPointsByAddressMock.writeValue(accounts[2], 40);
        b[4] = await web3.eth.getBlockNumber();
        // Act
        let block0Address1Value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[0]);
        let block1Address1Value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[1]);
        let block2Address1Value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[2]);
        let block3Address1Value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[3]);
        let block4Address1Value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[4]);
        let block0Address2Value = await checkPointsByAddressMock.valueOfAt(accounts[2], b[0]);
        let block1Address2Value = await checkPointsByAddressMock.valueOfAt(accounts[2], b[1]);
        let block2Address2Value = await checkPointsByAddressMock.valueOfAt(accounts[2], b[2]);
        let block3Address2Value = await checkPointsByAddressMock.valueOfAt(accounts[2], b[3]);
        let block4Address2Value = await checkPointsByAddressMock.valueOfAt(accounts[2], b[4]);
        // Assert
        assert.equal(block0Address1Value as any, 0);
        assert.equal(block1Address1Value as any, 10);
        assert.equal(block2Address1Value as any, 10);
        assert.equal(block3Address1Value as any, 30);
        assert.equal(block4Address1Value as any, 30);
        assert.equal(block0Address2Value as any, 0);
        assert.equal(block1Address2Value as any, 0);
        assert.equal(block2Address2Value as any, 20);
        assert.equal(block3Address2Value as any, 20);
        assert.equal(block4Address2Value as any, 40);
    });

    it("Should transmit value now between addresses", async () => {
        // Assemble
        await checkPointsByAddressMock.writeValue(accounts[1], 10);
        await checkPointsByAddressMock.writeValue(accounts[2], 20);
        // Act
        await checkPointsByAddressMock.transmit(accounts[2], accounts[1], 20);

        // Assert
        let address1Value = await checkPointsByAddressMock.valueOfAtNow(accounts[1]);
        let address2Value = await checkPointsByAddressMock.valueOfAtNow(accounts[2]);
        assert.equal(address1Value as any, 30);
        assert.equal(address2Value as any, 0);
    });

    it("Should transmit value now between addresses", async () => {
        // Assemble
        await checkPointsByAddressMock.writeValue(accounts[1], 10);
        await checkPointsByAddressMock.writeValue(accounts[2], 20);
        // Act
        await checkPointsByAddressMock.transmit(accounts[2], accounts[1], 20);
        // Assert
        let address1Value = await checkPointsByAddressMock.valueOfAtNow(accounts[1]);
        let address2Value = await checkPointsByAddressMock.valueOfAtNow(accounts[2]);
        assert.equal(address1Value as any, 30);
        assert.equal(address2Value as any, 0);
    });

    it("Should not transmit zero value between addresses", async () => {
        // Assemble
        await checkPointsByAddressMock.writeValue(accounts[1], 10);
        await checkPointsByAddressMock.writeValue(accounts[2], 20);
        // Act
        await checkPointsByAddressMock.transmit(accounts[2], accounts[1], 0);
        // Assert
        let address1Value = await checkPointsByAddressMock.valueOfAtNow(accounts[1]);
        let address2Value = await checkPointsByAddressMock.valueOfAtNow(accounts[2]);
        assert.equal(address1Value as any, 10);
        assert.equal(address2Value as any, 20);
    });

    it("Should not transmit zero value between addresses", async () => {
        // Assemble
        await checkPointsByAddressMock.writeValue(accounts[1], 10);
        await checkPointsByAddressMock.writeValue(accounts[2], 20);
        // Act
        await checkPointsByAddressMock.transmit(accounts[2], accounts[1], 0);
        // Assert
        let address1Value = await checkPointsByAddressMock.valueOfAtNow(accounts[1]);
        let address2Value = await checkPointsByAddressMock.valueOfAtNow(accounts[2]);
        assert.equal(address1Value as any, 10);
        assert.equal(address2Value as any, 20);
    });

    it("Should mint for transmit from zero address", async () => {
        // Assemble
        await checkPointsByAddressMock.writeValue(accounts[1], 20);
        // Act
        await checkPointsByAddressMock.transmit(ZERO_ADDRESS, accounts[1], 10);
        // Assert
        let address1Value = await checkPointsByAddressMock.valueOfAtNow(accounts[1]);
        assert.equal(address1Value.toNumber(), 30);
        let address0Value = await checkPointsByAddressMock.valueOfAtNow(ZERO_ADDRESS);
        assert.equal(address0Value.toNumber(), 0);
    });

    it("Should burn for transmit to zero address", async () => {
        // Assemble
        await checkPointsByAddressMock.writeValue(accounts[1], 20);
        // Act
        await checkPointsByAddressMock.transmit(accounts[1], ZERO_ADDRESS, 5);
        // Assert
        let address1Value = await checkPointsByAddressMock.valueOfAtNow(accounts[1]);
        assert.equal(address1Value.toNumber(), 15);
        let address0Value = await checkPointsByAddressMock.valueOfAtNow(ZERO_ADDRESS);
        assert.equal(address0Value.toNumber(), 0);
    });

    it("Should delete old checkpoints", async () => {
        // Assemble
        const b = [];
        for (let i = 0; i < 10; i++) {
            await checkPointsByAddressMock.writeValue(accounts[1], i);
            b.push(await web3.eth.getBlockNumber());
        }
        // Act
        const cleanupBlock = b[5];
        for (let i = 0; i < 4; i++) {
            await checkPointsByAddressMock.cleanupOldCheckpoints(accounts[1], 2, cleanupBlock);
        }
        // Assert
        for (let i = 0; i < 5; i++) {
            await expectRevert(checkPointsByAddressMock.valueOfAt(accounts[1], b[i]), "CheckPointHistory: reading from cleaned-up block");
        }
        for (let i = 5; i < 10; i++) {
            const value = await checkPointsByAddressMock.valueOfAt(accounts[1], b[i]);
            assert.equal(value.toNumber(), i);
        }
    });

    it("Delete old checkpoints ignored for zero address", async () => {
        // Assemble
        const cleanupBlock = await web3.eth.getBlockNumber();
        // Act
        const res = await checkPointsByAddressMock.cleanupOldCheckpoints(ZERO_ADDRESS, 2, cleanupBlock);
        // Assert
        assert.notEqual(res, null);
    });

});
