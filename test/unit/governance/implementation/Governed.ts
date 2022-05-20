import { constants, expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { GovernedMockInstance } from "../../../../typechain-truffle/GovernedMock";
import { getTestFile } from "../../../utils/helpers";

const GovernedMock = artifacts.require("GovernedMock");

contract(`GovernedMock.sol; ${getTestFile(__filename)}; Governed unit tests`, async accounts => {
    let governed: GovernedMockInstance;
    let governance = accounts[10];

    beforeEach(async() => {
        governed = await GovernedMock.new(governance);
    });

    describe("governed functions", async() => {
        it("should only initialize with non-zero governance", async() => {
            const promise = GovernedMock.new(constants.ZERO_ADDRESS);
            await expectRevert(promise, "_governance zero");
        });

        it("should claim a governance proposal", async() => {
            await governed.proposeGovernance(accounts[2], {from: governance});
            let res = await governed.claimGovernance({from: accounts[2]});
            const currentGovernance = await governed.governance();
            assert.equal(currentGovernance, accounts[2]);
            expectEvent(res, "GovernanceUpdated");
        });

        it("should transfer governance", async() => {
          let resTransfer = await governed.transferGovernance(accounts[2], {from: governance});
          let currentGovernance = await governed.governance();
          assert.equal(currentGovernance, accounts[2]);
          expectEvent(resTransfer, "GovernanceUpdated");
        });
  
        it("should reject transfer governance if not from governed address", async() => {
          let resTransfer = governed.transferGovernance(accounts[2], {from: accounts[3]});
          await expectRevert(resTransfer, "only governance");
        });
        
      });
});