import { constants, expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import assert from "assert";
import { GovernedMockInstance } from "../../../../typechain-truffle/GovernedMock";
import { getTestFile } from "../../../utils/test-helpers";

const GovernedMock = artifacts.require("GovernedMock");

contract(`GovernedMock.sol; ${getTestFile(__filename)}; Governed unit tests`, async accounts => {
  let governed: GovernedMockInstance;
  let governance = accounts[10];
  let governance2 = accounts[11];

  beforeEach(async () => {
    governed = await GovernedMock.new(governance);
  });

  describe("governed functions", async () => {
    it("should only initialize with non-zero governance", async () => {
      const promise = GovernedMock.new(constants.ZERO_ADDRESS);
      await expectRevert(promise, "_governance zero");
    });

    it("should only be initializable once", async () => {
      const initPromise = governed.initialise(governance2);
      await expectRevert(initPromise, "initialised != false");
      // original governance should still be set
      const currentGovernance = await governed.governance();
      assert.equal(currentGovernance, governance);
    });

    it("should accept a governance proposal", async () => {
      const tx = await governed.proposeGovernance(governance2, { from: governance });
      const currentGovernance = await governed.governance();
      assert.equal(currentGovernance, governance);
      const proposedGovernance = await governed.proposedGovernance();
      assert.equal(proposedGovernance, governance2);
      expectEvent.notEmitted(tx, "GovernanceUpdated");
    });

    it("should emit governance proposal event", async () => {
      const tx = await governed.proposeGovernance(governance2, { from: governance });
      expectEvent(tx, "GovernanceProposed");
    });

    it("should reject a governance proposal if not proposed from governed address", async () => {
      const proposePromise = governed.proposeGovernance(governance2);
      await expectRevert(proposePromise, "only governance");
    });

    it("should claim a governance proposal", async () => {
      await governed.proposeGovernance(governance2, { from: governance });
      let res = await governed.claimGovernance({ from: governance2 });
      const currentGovernance = await governed.governance();
      assert.equal(currentGovernance, governance2);
      expectEvent(res, "GovernanceUpdated");
    });

    it("should reject a governance claim if not from claimaint", async () => {
      await governed.proposeGovernance(governance2, { from: governance });
      const claimPromise = governed.claimGovernance();
      await expectRevert(claimPromise, "not claimaint");
    });

    it("should clear proposed address after claiming", async () => {
      await governed.proposeGovernance(governance2, { from: governance });
      await governed.claimGovernance({ from: governance2 });
      const proposedAddress = await governed.proposedGovernance();
      assert.equal(proposedAddress, constants.ZERO_ADDRESS);
    });

    it("should transfer governance", async () => {
      let resTransfer = await governed.transferGovernance(governance2, { from: governance });
      let currentGovernance = await governed.governance();
      assert.equal(currentGovernance, governance2);
      expectEvent(resTransfer, "GovernanceUpdated");
    });

    it("should reject transfer governance if not from governed address", async () => {
      let resTransfer = governed.transferGovernance(governance2, { from: accounts[3] });
      await expectRevert(resTransfer, "only governance");
    });

    it("should clear proposed governance if successfully transferred", async () => {
      await governed.proposeGovernance(governance2, { from: governance });
      await governed.transferGovernance(accounts[3], { from: governance });
      const proposedGovernance = await governed.proposedGovernance();
      assert.equal(proposedGovernance, constants.ZERO_ADDRESS);
    });
  });
});
