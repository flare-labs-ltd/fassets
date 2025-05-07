import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import {
  AddressUpdaterInstance,
  CoreVaultManagerInstance,
  CoreVaultManagerProxyInstance,
  GovernanceSettingsInstance,
  MockContractInstance,
} from "../../../../typechain-truffle";
import { GENESIS_GOVERNANCE_ADDRESS } from "../../../utils/constants";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { Payment } from "@flarenetwork/state-connector-protocol/dist/generated/types/typescript/Payment";
import { abiEncodeCall, erc165InterfaceId, ZERO_BYTES32 } from "../../../../lib/utils/helpers";
import { assertWeb3DeepEqual, assertWeb3Equal } from "../../../utils/web3assertions";
import { ZERO_ADDRESS } from "../../../../deployment/lib/deploy-utils";
import { ZERO_BYTES_32 } from "@flarenetwork/state-connector-protocol";

const CoreVaultManager = artifacts.require("CoreVaultManager");
const CoreVaultManagerProxy = artifacts.require("CoreVaultManagerProxy");
const GovernanceSettings = artifacts.require("GovernanceSettings");
const AddressUpdater = artifacts.require("AddressUpdater");
const MockContract = artifacts.require("MockContract");

contract(`CoreVaultManager.sol; ${getTestFile(__filename)}; CoreVaultManager unit tests`, async (accounts) => {
    let coreVaultManager: CoreVaultManagerInstance;
    let coreVaultManagerProxy: CoreVaultManagerProxyInstance;
    let coreVaultManagerImplementation: CoreVaultManagerInstance;
    let addressUpdater: AddressUpdaterInstance;
    let fdcVerification: MockContractInstance;
    let governanceSettings: GovernanceSettingsInstance;
    const governance = accounts[1000];
    const assetManager = accounts[101];
    const chainId = web3.utils.keccak256("123");
    const standardPaymentReference = web3.utils.keccak256("standardPaymentReference");
    const custodianAddress = "custodianAddress";
    const coreVaultAddress = "coreVaultAddress";
    const DAY = 24 * 3600;

    async function initialize() {
      // create governance settings
      governanceSettings = await GovernanceSettings.new();
      await governanceSettings.initialise(governance, 60, [governance], {
        from: GENESIS_GOVERNANCE_ADDRESS,
      });
      // create address updater
      addressUpdater = await AddressUpdater.new(governance); // don't switch to production
      // create core vault manager
      coreVaultManagerImplementation = await CoreVaultManager.new();
      coreVaultManagerProxy = await CoreVaultManagerProxy.new(
        coreVaultManagerImplementation.address,
        governanceSettings.address,
        governance,
        addressUpdater.address,
        assetManager,
        chainId,
        custodianAddress,
        coreVaultAddress,
        0
      );
      coreVaultManager = await CoreVaultManager.at(coreVaultManagerProxy.address);
      fdcVerification = await MockContract.new();
      await fdcVerification.givenAnyReturnBool(true);
      await addressUpdater.update(
        ["AddressUpdater", "FdcVerification"],
        [addressUpdater.address, fdcVerification.address],
        [coreVaultManager.address],
        { from: governance }
      );
      // await coreVaultManager.switchToProductionMode({ from: governance });
      return { coreVaultManager };
    }

    beforeEach(async () => {
      ({ coreVaultManager } = await loadFixtureCopyVars(initialize));
    });

    it("should not initialize contract if wrong parameters", async () => {
      // asset manager cannot be zero
      let tx = CoreVaultManagerProxy.new(
        coreVaultManagerImplementation.address,
        governanceSettings.address,
        governance,
        addressUpdater.address,
        ZERO_ADDRESS,
        web3.utils.keccak256("123"),
        custodianAddress,
        coreVaultAddress,
        0
      );
      await expectRevert(tx, "invalid address");

      // chain id cannot be zero
      tx = CoreVaultManagerProxy.new(
        coreVaultManagerImplementation.address,
        governanceSettings.address,
        governance,
        addressUpdater.address,
        assetManager,
        ZERO_BYTES32,
        custodianAddress,
        coreVaultAddress,
        0
      );
      await expectRevert(tx, "invalid chain");

      // custodian address cannot be empty
      tx = CoreVaultManagerProxy.new(
        coreVaultManagerImplementation.address,
        governanceSettings.address,
        governance,
        addressUpdater.address,
        assetManager,
        web3.utils.keccak256("123"),
        "",
        coreVaultAddress,
        0
      );
      await expectRevert(tx, "invalid address");

      // core vault address cannot be empty
      tx = CoreVaultManagerProxy.new(
        coreVaultManagerImplementation.address,
        governanceSettings.address,
        governance,
        addressUpdater.address,
        assetManager,
        web3.utils.keccak256("123"),
        custodianAddress,
        "",
        0
      );
      await expectRevert(tx, "invalid address");
    });

    it("should add destination addresses", async () => {
      const tx = await coreVaultManager.addAllowedDestinationAddresses(["addr1", "addr2"], {
        from: governance,
      });
      expectEvent(tx, "AllowedDestinationAddressAdded", {
        destinationAddress: "addr1",
      });
      const allowedDestinationAddresses = await coreVaultManager.getAllowedDestinationAddresses();
      expectEvent(tx, "AllowedDestinationAddressAdded", {
        destinationAddress: "addr2",
      });
      expect(allowedDestinationAddresses.length).to.equal(2);
      expect(allowedDestinationAddresses[0]).to.equal("addr1");
      expect(allowedDestinationAddresses[1]).to.equal("addr2");

      assertWeb3Equal(await coreVaultManager.isDestinationAddressAllowed("addr1"), true);
      assertWeb3Equal(await coreVaultManager.isDestinationAddressAllowed("addr2"), true);
      assertWeb3Equal(await coreVaultManager.isDestinationAddressAllowed("addr3"), false);

      // if address already exists, it should not be added again
      await coreVaultManager.addAllowedDestinationAddresses(["addr3", "addr1"], {
        from: governance,
      });
      const allowedDestinationAddresses2 = await coreVaultManager.getAllowedDestinationAddresses();
      expect(allowedDestinationAddresses2.length).to.equal(3);
      expect(allowedDestinationAddresses2[0]).to.equal("addr1");
      expect(allowedDestinationAddresses2[1]).to.equal("addr2");
      expect(allowedDestinationAddresses2[2]).to.equal("addr3");
    });

    it("should revert adding allowed destination address if not from governance", async () => {
      const tx = coreVaultManager.addAllowedDestinationAddresses([accounts[1]], {
        from: accounts[2],
      });
      await expectRevert(tx, "only governance");
    });

    it("should revert adding empty destination address", async () => {
      const tx = coreVaultManager.addAllowedDestinationAddresses([""], {
        from: governance,
      });
      await expectRevert(tx, "invalid address");
    });

    it("should remove allowed destination addresses", async () => {
      await coreVaultManager.addAllowedDestinationAddresses(["addr1", "addr2"], {
        from: governance,
      });

      const tx = await coreVaultManager.removeAllowedDestinationAddresses(["addr1", "addr2", "addr3"], {
        from: governance,
      });
      expectEvent(tx, "AllowedDestinationAddressRemoved", {
        destinationAddress: "addr1",
      });
      expectEvent(tx, "AllowedDestinationAddressRemoved", {
        destinationAddress: "addr2",
      });

      const allowedDestinationAddresses = await coreVaultManager.getAllowedDestinationAddresses();
      expect(allowedDestinationAddresses.length).to.equal(0);

      // if address is not on the list of allowed destination addresses, it shouldn't be removed
      const tx1 = await coreVaultManager.removeAllowedDestinationAddresses(["addr1"], {
        from: governance,
      });
      expectEvent.notEmitted(tx1, "AllowedDestinationAddressRemoved");
    });

    it("should revert removing allowed destination address if not from governance", async () => {
      const tx = coreVaultManager.removeAllowedDestinationAddresses([accounts[1]], {
        from: accounts[2],
      });
      await expectRevert(tx, "only governance");
    });

    it("should add triggering accounts", async () => {
      const tx = await coreVaultManager.addTriggeringAccounts([accounts[1], accounts[2]], {
        from: governance,
      });
      expectEvent(tx, "TriggeringAccountAdded", {
        triggeringAccount: accounts[1],
      });
      expectEvent(tx, "TriggeringAccountAdded", {
        triggeringAccount: accounts[2],
      });

      const triggeringAccounts = await coreVaultManager.getTriggeringAccounts();
      expect(triggeringAccounts.length).to.equal(2);
      expect(triggeringAccounts[0]).to.equal(accounts[1]);
      expect(triggeringAccounts[1]).to.equal(accounts[2]);

      // if triggering account already exists, it should not be added again
      const tx1 = await coreVaultManager.addTriggeringAccounts([accounts[1]], {
        from: governance,
      });
      expectEvent.notEmitted(tx1, "TriggeringAccountAdded");
    });

    it("should revert adding triggering account if not from governance", async () => {
      const tx = coreVaultManager.addTriggeringAccounts([accounts[1]], {
        from: accounts[2],
      });
      await expectRevert(tx, "only governance");
    });

    it("should remove triggering accounts", async () => {
      // add triggering accounts
      await coreVaultManager.addTriggeringAccounts([accounts[1], accounts[2], accounts[3]], {
        from: governance,
      });

      const tx = await coreVaultManager.removeTriggeringAccounts([accounts[1], accounts[2]], {
        from: governance,
      });
      expectEvent(tx, "TriggeringAccountRemoved", {
        triggeringAccount: accounts[1],
      });
      expectEvent(tx, "TriggeringAccountRemoved", {
        triggeringAccount: accounts[2],
      });
      expect((await coreVaultManager.getTriggeringAccounts()).length).to.equal(1);

      // if triggering account is not in the list, it shouldn't be removed
      const tx1 = await coreVaultManager.removeTriggeringAccounts([accounts[1]], {
        from: governance,
      });
      expectEvent.notEmitted(tx1, "TriggeringAccountRemoved");
    });

    it("should revert removing triggering account if not from governance", async () => {
      const tx = coreVaultManager.removeTriggeringAccounts([accounts[1]], {
        from: accounts[2],
      });
      await expectRevert(tx, "only governance");
    });

    it("should update custodian address", async () => {
      const tx = await coreVaultManager.updateCustodianAddress("newCustodianAddress", {
        from: governance,
      });
      expectEvent(tx, "CustodianAddressUpdated", {
        custodianAddress: "newCustodianAddress",
      });
      expect(await coreVaultManager.custodianAddress()).to.equal("newCustodianAddress");
    });

    it("should not update custodian address if not from governance", async () => {
      const tx = coreVaultManager.updateCustodianAddress("custodianAddress", {
        from: accounts[1],
      });
      await expectRevert(tx, "only governance");
    });

    it("should not update custodian address if new address is zero", async () => {
      const tx = coreVaultManager.updateCustodianAddress("", {
        from: governance,
      });
      await expectRevert(tx, "invalid address");
    });

    it("should update settings", async () => {
      const tx = await coreVaultManager.updateSettings(12345, 800, 900, 10, {
        from: governance,
      });
      expectEvent(tx, "SettingsUpdated", {
        escrowEndTimeSeconds: "12345",
        escrowAmount: "800",
        minimalAmount: "900",
        fee: "10",
      });
      const settings = await coreVaultManager.getSettings();
      assertWeb3Equal(settings[0], "12345"); // escrowEndTimeSeconds
      assertWeb3Equal(settings[1], "800"); // escrowAmount
      assertWeb3Equal(settings[2], "900"); // minimalAmount
      assertWeb3Equal(settings[3], "10"); // fee
    });

    it("should not update settings if not from governance", async () => {
      const tx = coreVaultManager.updateSettings(12345, 800, 900, 10, {
        from: accounts[1],
      });
      await expectRevert(tx, "only governance");
    });

    it("should not update settings if escrow end time is more than a day", async () => {
      const tx = coreVaultManager.updateSettings(24 * 3600, 800, 900, 10, {
        from: governance,
      });
      await expectRevert(tx, "invalid end time");
    });

    it("should not update settings if fee is zero", async () => {
      const tx = coreVaultManager.updateSettings(12345, 800, 900, 0, {
        from: governance,
      });
      await expectRevert(tx, "fee zero");
    });

    it("should add preimage hashes", async () => {
      const hash1 = web3.utils.keccak256("hash1");
      const hash2 = web3.utils.keccak256("hash2");
      const tx = await coreVaultManager.addPreimageHashes([hash1, hash2], {
        from: governance,
      });
      expectEvent(tx, "PreimageHashAdded", { preimageHash: hash1 });
      expectEvent(tx, "PreimageHashAdded", { preimageHash: hash2 });

      assertWeb3Equal(await coreVaultManager.getPreimageHashesCount(), 2);
      assertWeb3Equal(await coreVaultManager.getPreimageHash(0), hash1);
      assertWeb3Equal(await coreVaultManager.getPreimageHash(1), hash2);
      // only two hashes were added
      await expectRevert.unspecified(coreVaultManager.getPreimageHash(2));
    });

    it("should not add preimage hashes if not from governance", async () => {
      const tx = coreVaultManager.addPreimageHashes([web3.utils.keccak256("hash1")], {
        from: accounts[1],
      });
      await expectRevert(tx, "only governance");
    });

    it("should revert adding preimage hashes if zero hash", async () => {
      const tx = coreVaultManager.addPreimageHashes([ZERO_BYTES32], {
        from: governance,
      });
      await expectRevert(tx, "invalid preimage hash");
    });

    it("should revert adding preimage hashes if hash already exists", async () => {
      const hash = web3.utils.keccak256("hash1");
      const tx = coreVaultManager.addPreimageHashes([hash, hash], {
        from: governance,
      });
      await expectRevert(tx, "invalid preimage hash");
    });

    it("should remove unused preimage hashes", async () => {
      // add preimage hashes
      await coreVaultManager.addPreimageHashes(
        [
          web3.utils.keccak256("hash1"),
          web3.utils.keccak256("hash2"),
          web3.utils.keccak256("hash3"),
          web3.utils.keccak256("hash4"),
        ],
        { from: governance }
      );

      let unusedHashes = await coreVaultManager.getUnusedPreimageHashes();
      assertWeb3Equal(unusedHashes.length, 4);
      assertWeb3DeepEqual(unusedHashes, [
        web3.utils.keccak256("hash1"),
        web3.utils.keccak256("hash2"),
        web3.utils.keccak256("hash3"),
        web3.utils.keccak256("hash4"),
      ]);

      // remove 3 unused preimage hashes
      const tx = await coreVaultManager.removeUnusedPreimageHashes(3, {
        from: governance,
      });
      expectEvent(tx, "UnusedPreimageHashRemoved", {
        preimageHash: web3.utils.keccak256("hash4"),
      });
      expectEvent(tx, "UnusedPreimageHashRemoved", {
        preimageHash: web3.utils.keccak256("hash3"),
      });
      expectEvent(tx, "UnusedPreimageHashRemoved", {
        preimageHash: web3.utils.keccak256("hash2"),
      });
      assertWeb3Equal(await coreVaultManager.getPreimageHashesCount(), 1);
      assertWeb3DeepEqual(await coreVaultManager.getUnusedPreimageHashes(), [web3.utils.keccak256("hash1")]);
    });

    it("should not remove unused preimage hashes if not from governance", async () => {
      const tx = coreVaultManager.removeUnusedPreimageHashes(1);
      await expectRevert(tx, "only governance");
    });

    it("should add emergency pause senders", async () => {
      await coreVaultManager.switchToProductionMode({ from: governance });
      const tx = await coreVaultManager.addEmergencyPauseSenders([accounts[1], accounts[2]], {
        from: governance,
      });
      expectEvent(tx, "EmergencyPauseSenderAdded", { sender: accounts[1] });
      expectEvent(tx, "EmergencyPauseSenderAdded", { sender: accounts[2] });

      assertWeb3DeepEqual(await coreVaultManager.getEmergencyPauseSenders(), [accounts[1], accounts[2]]);

      // if sender already exists, it should not be added again
      const tx1 = await coreVaultManager.addEmergencyPauseSenders([accounts[1]], {
        from: governance,
      });
      expectEvent.notEmitted(tx1, "EmergencyPauseSenderAdded");
    });

    it("should revert adding emergency pause senders if not from governance", async () => {
      const tx = coreVaultManager.addEmergencyPauseSenders([accounts[1]], {
        from: accounts[2],
      });
      await expectRevert(tx, "only governance");
    });

    it("should remove emergency pause senders", async () => {
      await coreVaultManager.switchToProductionMode({ from: governance });
      await coreVaultManager.addEmergencyPauseSenders([accounts[1], accounts[2], accounts[3]], {
        from: governance,
      });

      // remove two senders
      const tx = await coreVaultManager.removeEmergencyPauseSenders([accounts[1], accounts[3]], {
        from: governance,
      });
      expectEvent(tx, "EmergencyPauseSenderRemoved", { sender: accounts[1] });
      expectEvent(tx, "EmergencyPauseSenderRemoved", { sender: accounts[3] });
      assertWeb3DeepEqual(await coreVaultManager.getEmergencyPauseSenders(), [accounts[2]]);

      // if sender is not in the list, it shouldn't be removed
      const tx1 = await coreVaultManager.removeEmergencyPauseSenders([accounts[1]], {
        from: governance,
      });
      expectEvent.notEmitted(tx1, "EmergencyPauseSenderRemoved");
    });

    it("should revert removing emergency pause sender if not from governance", async () => {
      const tx = coreVaultManager.removeEmergencyPauseSenders([accounts[1]], {
        from: accounts[2],
      });
      await expectRevert(tx, "only governance");
    });

    it("should pause the contract", async () => {
      const tx = await coreVaultManager.pause({ from: governance });
      expectEvent(tx, "Paused");
      assertWeb3Equal(await coreVaultManager.paused(), true);
    });

    it("should not pause the contract if not called by emergency pause senders", async () => {
      const tx = coreVaultManager.pause({ from: accounts[1] });
      await expectRevert(tx, "not authorized");

      // add accounts[1] as emergency pause sender
      await coreVaultManager.addEmergencyPauseSenders([accounts[1]], {
        from: governance,
      });
      const tx1 = await coreVaultManager.pause({ from: accounts[1] });
      expectEvent(tx1, "Paused");
      assertWeb3Equal(await coreVaultManager.paused(), true);
    });

    it("should unpause the contract", async () => {
      await coreVaultManager.switchToProductionMode({ from: governance });
      await coreVaultManager.pause({ from: governance });
      const tx = await coreVaultManager.unpause({ from: governance });
      expectEvent(tx, "Unpaused");
      assertWeb3Equal(await coreVaultManager.paused(), false);
    });

    it("should not unpause the contract if not from governance", async () => {
      const tx = coreVaultManager.unpause({ from: accounts[1] });
      await expectRevert(tx, "only governance");
    });

    it("should revert adding allowed destination address if not from governance", async () => {
      const tx = coreVaultManager.addAllowedDestinationAddresses([accounts[1]], {
        from: accounts[2],
      });
      await expectRevert(tx, "only governance");
    });

    it("should revert adding empty destination address", async () => {
      const tx = coreVaultManager.addAllowedDestinationAddresses([""], {
        from: governance,
      });
      await expectRevert(tx, "invalid address");
    });

    it("should revert adding triggering account if not from governance", async () => {
      const tx = coreVaultManager.addTriggeringAccounts([accounts[1]], {
        from: accounts[2],
      });
      await expectRevert(tx, "only governance");
    });

    it("should triggering custom instructions", async () => {
      const instructionsHash = web3.utils.keccak256("custom instructions");
      const tx = await coreVaultManager.triggerCustomInstructions(instructionsHash, {
        from: governance,
      });
      expectEvent(tx, "CustomInstructions", {
        sequence: "0",
        account: coreVaultAddress,
        instructionsHash: instructionsHash
      });
      const tx2 = await coreVaultManager.triggerCustomInstructions(instructionsHash, {
        from: governance,
      });
      expectEvent(tx2, "CustomInstructions", {
        sequence: "1",
        account: coreVaultAddress,
        instructionsHash: instructionsHash
      });
    });

    it("should revert triggering custom instructions if not from governance", async () => {
      const instructionsHash = web3.utils.keccak256("custom instructions");
      const tx = coreVaultManager.triggerCustomInstructions(instructionsHash, {
        from: accounts[2],
      });
      await expectRevert(tx, "only governance");
    });

    describe("confirm payment", () => {
      it("should confirm payment", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 100;
        const proof = createPaymentProof(transactionId, amount);
        const tx = await coreVaultManager.confirmPayment(proof);
        expectEvent(tx, "PaymentConfirmed", {
          transactionId,
          paymentReference: standardPaymentReference,
          amount: amount.toString(),
        });
        assertWeb3Equal(await coreVaultManager.availableFunds(), amount);
        assertWeb3Equal(await coreVaultManager.confirmedPayments(transactionId), true);
      });

      it("should not confirm payment twice", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 100;
        const proof = createPaymentProof(transactionId, amount);
        const tx = await coreVaultManager.confirmPayment(proof);
        expectEvent(tx, "PaymentConfirmed", {
          transactionId,
          paymentReference: standardPaymentReference,
          amount: amount.toString(),
        });
        const tx2 = await coreVaultManager.confirmPayment(proof);
        expectEvent.notEmitted(tx2, "PaymentConfirmed");
        assertWeb3Equal(await coreVaultManager.availableFunds(), amount);
      });

      it("should revert confirming payment with failed status", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 100;
        const proof = createPaymentProof(transactionId, amount, "1");
        await expectRevert(
          coreVaultManager.confirmPayment(proof),
          "payment failed"
        );
        assertWeb3Equal(await coreVaultManager.availableFunds(), 0);
      });

      it("should revert confirming payment with invalid chain", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 100;
        const proof = createPaymentProof(
          transactionId,
          amount,
          "0",
          web3.utils.keccak256("124")
        );
        await expectRevert(
          coreVaultManager.confirmPayment(proof),
          "invalid chain"
        );
        assertWeb3Equal(await coreVaultManager.availableFunds(), 0);
      });

      it("should revert confirming payment if payment is not proved", async () => {
        await fdcVerification.givenAnyReturnBool(false);
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 100;
        const proof = createPaymentProof(transactionId, amount);
        await expectRevert(
          coreVaultManager.confirmPayment(proof),
          "payment not proved"
        );
        assertWeb3Equal(await coreVaultManager.availableFunds(), 0);
      });

      it("should revert confirming payment sent to different address", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 100;
        const proof = createPaymentProof(
          transactionId,
          amount,
          "0",
          chainId,
          web3.utils.keccak256("notCoreVaultAddress")
        );
        await expectRevert(
          coreVaultManager.confirmPayment(proof),
          "not core vault"
        );
        assertWeb3Equal(await coreVaultManager.availableFunds(), 0);
      });

      it("should revert confirming payment with zero or negative amount", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const proof = createPaymentProof(transactionId, 0);
        await expectRevert(
          coreVaultManager.confirmPayment(proof),
          "invalid amount"
        );
        const proof2 = createPaymentProof(transactionId, -100);
        await expectRevert(
          coreVaultManager.confirmPayment(proof2),
          "invalid amount"
        );
        assertWeb3Equal(await coreVaultManager.availableFunds(), 0);
      });
    });

    describe("request and cancel transfers", async () => {
      it("should request transfer from core vault (cancelable)", async () => {
        const destinationAddress = "destinationAddress";
        const paymentReference = web3.utils.keccak256("paymentReference");
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", destinationAddress, "addr2"], {
          from: governance,
        });
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress,
          paymentReference,
          100,
          true,
          {
            from: assetManager,
          }
        );
        expectEvent(tx, "TransferRequested", {
          destinationAddress,
          paymentReference,
          amount: "100",
          cancelable: true,
        });

        assertWeb3Equal(await coreVaultManager.availableFunds(), 1000);
        assertWeb3Equal(await coreVaultManager.totalRequestAmountWithFee(), 100);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(1);
        expect(cancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        assertWeb3Equal(cancelableTransferRequests[0].amount, 100);
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(0);
      });

      it("should request multiple transfers from core vault - different destination addresses (cancelable)", async () => {
        const destinationAddress = "destinationAddress";
        const destinationAddress2 = "destinationAddress2";
        const paymentReference = web3.utils.keccak256("paymentReference");
        const paymentReference2 = web3.utils.keccak256("paymentReference2");
        await coreVaultManager.addAllowedDestinationAddresses(
          ["addr1", destinationAddress, destinationAddress2],
          { from: governance }
        );
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress,
          paymentReference,
          100,
          true,
          {
            from: assetManager,
          }
        );
        expectEvent(tx, "TransferRequested", {
          destinationAddress,
          paymentReference,
          amount: "100",
          cancelable: true,
        });
        const tx2 = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress2,
          paymentReference2,
          300,
          true,
          {
            from: assetManager,
          }
        );
        expectEvent(tx2, "TransferRequested", {
          destinationAddress: destinationAddress2,
          paymentReference: paymentReference2,
          amount: "300",
          cancelable: true,
        });

        assertWeb3Equal(await coreVaultManager.availableFunds(), 1000);
        assertWeb3Equal(await coreVaultManager.totalRequestAmountWithFee(), 400);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(2);
        expect(cancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        assertWeb3Equal(cancelableTransferRequests[0].amount, 100);
        expect(cancelableTransferRequests[1].destinationAddress).to.equal(destinationAddress2);
        assertWeb3Equal(cancelableTransferRequests[1].amount, 300);
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(0);
      });

      it("should revert requesting multiple transfers from core vault - same destination address (cancelable)", async () => {
        const destinationAddress = "destinationAddress";
        const paymentReference = web3.utils.keccak256("paymentReference");
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", destinationAddress], {
          from: governance,
        });
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress,
          paymentReference,
          100,
          true,
          {
            from: assetManager,
          }
        );
        expectEvent(tx, "TransferRequested", {
          destinationAddress,
          paymentReference,
          amount: "100",
          cancelable: true,
        });
        await expectRevert(
          coreVaultManager.requestTransferFromCoreVault(
            destinationAddress,
            paymentReference,
            300,
            true,
            {
              from: assetManager,
            }
          ),
          "already exists"
        );

        assertWeb3Equal(await coreVaultManager.availableFunds(), 1000);
        assertWeb3Equal(await coreVaultManager.totalRequestAmountWithFee(), 100);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(1);
        expect(cancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        assertWeb3Equal(cancelableTransferRequests[0].amount, 100);
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(0);
      });

      it("should request transfer from core vault (non-cancelable)", async () => {
        const destinationAddress = "destinationAddress";
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", destinationAddress, "addr2"], {
          from: governance,
        });
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress,
          ZERO_BYTES32,
          100,
          false,
          {
            from: assetManager,
          }
        );
        expectEvent(tx, "TransferRequested", {
          destinationAddress,
          paymentReference: ZERO_BYTES32,
          amount: "100",
          cancelable: false,
        });

        assertWeb3Equal(await coreVaultManager.availableFunds(), 1000);
        assertWeb3Equal(await coreVaultManager.totalRequestAmountWithFee(), 100);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(0);
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(1);
        expect(nonCancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        assertWeb3Equal(nonCancelableTransferRequests[0].amount, 100);
      });

      it("should request multiple transfers from core vault - different destination addresses (non-cancelable)", async () => {
        const destinationAddress = "destinationAddress";
        const destinationAddress2 = "destinationAddress2";
        await coreVaultManager.addAllowedDestinationAddresses(
          ["addr1", destinationAddress, destinationAddress2],
          { from: governance }
        );
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress,
          ZERO_BYTES32,
          100,
          false,
          {
            from: assetManager,
          }
        );
        expectEvent(tx, "TransferRequested", {
          destinationAddress,
          paymentReference: ZERO_BYTES32,
          amount: "100",
          cancelable: false,
        });
        const tx2 = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress2,
          ZERO_BYTES32,
          300,
          false,
          {
            from: assetManager,
          }
        );
        expectEvent(tx2, "TransferRequested", {
          destinationAddress: destinationAddress2,
          paymentReference: ZERO_BYTES32,
          amount: "300",
          cancelable: false,
        });

        assertWeb3Equal(await coreVaultManager.availableFunds(), 1000);
        assertWeb3Equal(await coreVaultManager.totalRequestAmountWithFee(), 400);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(0);
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(2);
        expect(nonCancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        assertWeb3Equal(nonCancelableTransferRequests[0].amount, 100);
        expect(nonCancelableTransferRequests[1].destinationAddress).to.equal(destinationAddress2);
        assertWeb3Equal(nonCancelableTransferRequests[1].amount, 300);
      });

      it("should request multiple transfers from core vault - same destination addresses (non-cancelable)", async () => {
        const destinationAddress = "destinationAddress";
        const destinationAddress2 = "destinationAddress2";
        await coreVaultManager.addAllowedDestinationAddresses(
          ["addr1", destinationAddress, destinationAddress2],
          { from: governance }
        );
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress,
          ZERO_BYTES32,
          100,
          false,
          {
            from: assetManager,
          }
        );
        expectEvent(tx, "TransferRequested", {
          destinationAddress,
          paymentReference: ZERO_BYTES32,
          amount: "100",
          cancelable: false,
        });
        const tx2 = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress2,
          ZERO_BYTES32,
          300,
          false,
          {
            from: assetManager,
          }
        );
        expectEvent(tx2, "TransferRequested", {
          destinationAddress: destinationAddress2,
          paymentReference: ZERO_BYTES32,
          amount: "300",
          cancelable: false,
        });
        const tx3 = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress,
          ZERO_BYTES32,
          100,
          false,
          {
            from: assetManager,
          }
        );
        expectEvent(tx3, "TransferRequested", {
          destinationAddress: destinationAddress,
          paymentReference: ZERO_BYTES32,
          amount: "100",
          cancelable: false,
        });

        assertWeb3Equal(await coreVaultManager.availableFunds(), 1000);
        assertWeb3Equal(await coreVaultManager.totalRequestAmountWithFee(), 500);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(0);
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(2);
        expect(nonCancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        assertWeb3Equal(nonCancelableTransferRequests[0].amount, 200);
        expect(nonCancelableTransferRequests[1].destinationAddress).to.equal(destinationAddress2);
        assertWeb3Equal(nonCancelableTransferRequests[1].amount, 300);
      });

      it("should revert requesting transfer if not from asset manager", async () => {
        assert.notEqual(assetManager, accounts[1]);
        await expectRevert(
          coreVaultManager.requestTransferFromCoreVault("addr1", ZERO_BYTES32, 10, false, {
            from: accounts[1],
          }),
          "only asset manager"
        );
      });

      it("should revert requesting transfer if paused", async () => {
        await coreVaultManager.pause({ from: governance });
        await expectRevert(
          coreVaultManager.requestTransferFromCoreVault("addr1", ZERO_BYTES32, 10, false, {
            from: assetManager,
          }),
          "paused"
        );
      });

      it("should revert requesting transfer if amount is zero", async () => {
        await expectRevert(
          coreVaultManager.requestTransferFromCoreVault("addr1", ZERO_BYTES32, 0, false, {
            from: assetManager,
          }),
          "amount zero"
        );
      });

      it("should revert requesting transfer if destination address is not allowed", async () => {
        await expectRevert(
          coreVaultManager.requestTransferFromCoreVault("addr1", ZERO_BYTES32, 10, false, {
            from: assetManager,
          }),
          "destination not allowed"
        );
      });

      it("should revert requesting transfer if there are insufficient funds", async () => {
        const destinationAddress = "destinationAddress";
        const destinationAddress2 = "destinationAddress2";
        const paymentReference = web3.utils.keccak256("paymentReference");
        await coreVaultManager.addAllowedDestinationAddresses(
          ["addr1", destinationAddress, destinationAddress2],
          { from: governance }
        );
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        await coreVaultManager.requestTransferFromCoreVault(destinationAddress, paymentReference, 100, true, {
          from: assetManager,
        });
        await coreVaultManager.requestTransferFromCoreVault(destinationAddress2, ZERO_BYTES32, 300, false, {
          from: assetManager,
        });

        await coreVaultManager.addAllowedDestinationAddresses(["addr1"], {
          from: governance,
        });
        await expectRevert(
          coreVaultManager.requestTransferFromCoreVault("addr1", ZERO_BYTES32, 700, false, {
            from: assetManager,
          }),
          "insufficient funds"
        );
      });

      it("should cancel request transfer from core vault and keep the order", async () => {
        const destinationAddress = "destinationAddress";
        const destinationAddress2 = "destinationAddress2";
        const destinationAddress3 = "destinationAddress3";
        const destinationAddress4 = "destinationAddress4";
        const paymentReference = web3.utils.keccak256("paymentReference");
        const paymentReference2 = web3.utils.keccak256("paymentReference2");
        const paymentReference3 = web3.utils.keccak256("paymentReference3");
        await coreVaultManager.addAllowedDestinationAddresses(
          ["addr1", destinationAddress, destinationAddress2, destinationAddress3, destinationAddress4],
          { from: governance }
        );
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress,
          paymentReference,
          100,
          true,
          {
            from: assetManager,
          }
        );
        expectEvent(tx, "TransferRequested", {
          destinationAddress,
          paymentReference,
          amount: "100",
          cancelable: true,
        });
        const tx2 = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress2,
          paymentReference2,
          300,
          true,
          {
            from: assetManager,
          }
        );
        expectEvent(tx2, "TransferRequested", {
          destinationAddress: destinationAddress2,
          paymentReference: paymentReference2,
          amount: "300",
          cancelable: true,
        });
        const tx3 = await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress3,
          paymentReference3,
          600,
          true,
          {
            from: assetManager,
          }
        );
        expectEvent(tx3, "TransferRequested", {
          destinationAddress: destinationAddress3,
          paymentReference: paymentReference3,
          amount: "600",
          cancelable: true,
        });

        const tx4 = await coreVaultManager.cancelTransferRequestFromCoreVault(destinationAddress2, {
          from: assetManager,
        });
        expectEvent(tx4, "TransferRequestCanceled", {
          destinationAddress: destinationAddress2,
          paymentReference: paymentReference2,
          amount: "300",
        });

        assertWeb3Equal(await coreVaultManager.availableFunds(), 1000);
        assertWeb3Equal(await coreVaultManager.totalRequestAmountWithFee(), 700);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(2);
        expect(cancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        assertWeb3Equal(cancelableTransferRequests[0].amount, 100);
        expect(cancelableTransferRequests[1].destinationAddress).to.equal(destinationAddress3);
        assertWeb3Equal(cancelableTransferRequests[1].amount, 600);
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(0);
      });

      it("should revert canceling request transfer if not from asset manager", async () => {
        assert.notEqual(assetManager, accounts[1]);
        await expectRevert(
          coreVaultManager.cancelTransferRequestFromCoreVault("addr1", {
            from: accounts[1],
          }),
          "only asset manager"
        );
      });

      it("should revert canceling request transfer if request not found", async () => {
        await expectRevert(
          coreVaultManager.cancelTransferRequestFromCoreVault("addr1", {
            from: assetManager,
          }),
          "not found"
        );
      });

      it("should not trigger instructions if payment fee is not set (is zero)", async () => {
        await coreVaultManager.addTriggeringAccounts([accounts[1]], {
          from: governance,
        });
        await expectRevert(coreVaultManager.triggerInstructions({ from: accounts[1] }), "fee zero");
      });
    });

    describe("trigger instructions", async () => {
      const preimageHash1 = web3.utils.keccak256("hash1");
      const preimageHash2 = web3.utils.keccak256("hash2");
      const escrowTimeSeconds = 3600;
      const destinationAddress1 = "destinationAddress";
      const destinationAddress2 = "destinationAddress2";
      const fee = "15";
      const destinationAddress3 = "destinationAddress3";

      async function createEscrows() {
        // fund contract
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 780);
        await coreVaultManager.confirmPayment(proof);

        const currentTimestamp = await time.latest();
        const escrowEndTimestamp1 = currentTimestamp.addn(DAY);
        let cancelAfterTs1 = escrowEndTimestamp1.subn(escrowEndTimestamp1.modn(DAY)).addn(escrowTimeSeconds);
        const cancelAfterTs2 = cancelAfterTs1.addn(DAY);

        // create two escrows
        await coreVaultManager.triggerInstructions({ from: accounts[1] });
        const escrow1 = {
          preimageHash: preimageHash1,
          amount: "200",
          cancelAfterTs: cancelAfterTs1,
          finished: false,
        }
        const escrow2 = {
          preimageHash: preimageHash2,
          amount: "200",
          cancelAfterTs: cancelAfterTs2,
          finished: false,
        }
        return [escrow1, escrow2];
      }

      beforeEach(async () => {
        // add triggering accounts
        await coreVaultManager.addTriggeringAccounts([accounts[1]], {
          from: governance,
        });

        // settings
        await coreVaultManager.updateSettings(escrowTimeSeconds, 200, 300, 15, { from: governance });

        // add preimage hashes
        await coreVaultManager.addPreimageHashes([preimageHash1, preimageHash2], {
          from: governance,
        });

        // add allowed destination addresses
        await coreVaultManager.addAllowedDestinationAddresses(
          [destinationAddress1, destinationAddress2, destinationAddress3], { from: governance }
        );

        // current timestamp
        const currentTimestamp = await time.latest();
        const startOfNextDay = currentTimestamp.addn(DAY - currentTimestamp.modn(DAY));
        await time.increaseTo(startOfNextDay);
      });

      it("should trigger instructions", async () => {
        // confirm payment (fund core vault)
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 1080;
        const proof = createPaymentProof(transactionId, amount);
        await coreVaultManager.confirmPayment(proof);

        // request cancelable transfer
        const amount1 = "100";
        const paymentReference1 = web3.utils.keccak256("ref1");
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress1,
          paymentReference1,
          amount1,
          true,
          {
            from: assetManager,
          }
        );
        // request non-cancelable transfer
        const amount2 = "200";
        const paymentReference2 = ZERO_BYTES_32;
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress2,
          paymentReference2,
          amount2,
          false,
          {
            from: assetManager,
          }
        );

        const numberOfInstructions = await coreVaultManager.triggerInstructions.call({
          from: accounts[1],
        });
        assertWeb3Equal(numberOfInstructions, 4);

        // trigger instructions
        const tx = await coreVaultManager.triggerInstructions({
          from: accounts[1],
        });
        expectEvent(tx, "PaymentInstructions", {
          sequence: "0",
          account: coreVaultAddress,
          destination: destinationAddress1,
          amount: amount1,
          fee: fee,
          paymentReference: paymentReference1,
        });
        expectEvent(tx, "PaymentInstructions", {
          sequence: "1",
          account: coreVaultAddress,
          destination: destinationAddress2,
          amount: amount2,
          fee: fee,
          paymentReference: paymentReference2,
        });
        const currentTimestamp = await time.latest();
        const escrowEndTimestamp1 = currentTimestamp.addn(DAY);
        let cancelAfterTs1 = escrowEndTimestamp1.subn(escrowEndTimestamp1.modn(DAY)).addn(escrowTimeSeconds);
        expectEvent(tx, "EscrowInstructions", {
          sequence: "2",
          preimageHash: preimageHash1,
          account: coreVaultAddress,
          destination: custodianAddress,
          amount: "200",
          cancelAfterTs: cancelAfterTs1
        });
        const escrowEndTimestamp2 = cancelAfterTs1;
        const cancelAfterTs2 = escrowEndTimestamp2.addn(DAY);
        expectEvent(tx, "EscrowInstructions", {
          sequence: "3",
          preimageHash: preimageHash2,
          account: coreVaultAddress,
          destination: custodianAddress,
          amount: "200",
          cancelAfterTs: cancelAfterTs2
        });
        assertWeb3Equal(await coreVaultManager.availableFunds(),
          1080 - 100 - 200 - 200 - 200 - 2 * 15 - 2 * 15); // 320
        assertWeb3Equal(await coreVaultManager.nextSequenceNumber(), 4);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 200 + 200);

        const numberOfInstructions1 = await coreVaultManager.triggerInstructions.call({
          from: accounts[1],
        });
        assertWeb3Equal(numberOfInstructions1, 0);

        // trigger instructions again. Nothing should happen as there are no new requests and escrows still didn't expire
        const tx1 = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.nextSequenceNumber(), 4);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 400);
        assertWeb3Equal(await coreVaultManager.availableFunds(), 320);
        expectEvent.notEmitted(tx1, "PaymentInstructions");
        expectEvent.notEmitted(tx1, "EscrowInstructions");
      });

      it("should trigger instructions and process escrows", async () => {
        // confirm payment (fund core vault)
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 1080;
        const proof = createPaymentProof(transactionId, amount);
        await coreVaultManager.confirmPayment(proof);

        // request cancelable transfer
        const amount1 = "100";
        const paymentReference1 = web3.utils.keccak256("ref1");
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress1,
          paymentReference1,
          amount1,
          true,
          {
            from: assetManager,
          }
        );
        // request non-cancelable transfer
        const amount2 = "200";
        const paymentReference2 = ZERO_BYTES_32;
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress2,
          paymentReference2,
          amount2,
          false,
          {
            from: assetManager,
          }
        );

        // trigger instructions
        const tx = await coreVaultManager.triggerInstructions({
          from: accounts[1],
        });

        // first escrow expires
        const currentTimestamp = await time.latest();
        const escrowEndTimestamp1 = currentTimestamp.addn(DAY);
        let cancelAfterTs1 = escrowEndTimestamp1.subn(escrowEndTimestamp1.modn(DAY)).addn(escrowTimeSeconds);
        await time.increaseTo(cancelAfterTs1.addn(1));

        // trigger instructions again
        await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.nextSequenceNumber(), 4);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 400 - 200);
        assertWeb3Equal(await coreVaultManager.availableFunds(), 320 + 200);

        // set second escrow as finished
        const setEscrowFinishedTx = await coreVaultManager.setEscrowsFinished([preimageHash2], { from: governance });
        expectEvent(setEscrowFinishedTx, "EscrowFinished", {
          preimageHash: preimageHash2,
          amount: "200"
        });
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 0);
        assertWeb3Equal(await coreVaultManager.availableFunds(), 320 + 200);

        // move to the expiry of the second escrow
        // since the escrow is finished, funds balances should not be released
        await time.increase(DAY);
        await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 0);
        assertWeb3Equal(await coreVaultManager.availableFunds(), 320 + 200);
      });

      it("should trigger instructions (50 payment and 50 escrow instructions)", async () => {
        // confirm payment (fund core vault)
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 16900;
        const proof = createPaymentProof(transactionId, amount);
        await coreVaultManager.confirmPayment(proof);
        await coreVaultManager.removeUnusedPreimageHashes(2, { from: governance });

        // request 50 cancelable transfers
        const paymentReference = web3.utils.keccak256("ref");
        for (let i = 0; i < 50; i++) {
          const destinationAddress = web3.utils.keccak256("destinationAddress" + i);
          await coreVaultManager.addAllowedDestinationAddresses([destinationAddress], {
            from: governance,
          });
          const amount = "100";
          await coreVaultManager.requestTransferFromCoreVault(
            destinationAddress,
            paymentReference,
            amount,
            true,
            {
              from: assetManager,
            }
          );
          const preimageHash = web3.utils.keccak256("hash" + i);
          await coreVaultManager.addPreimageHashes([preimageHash], {
            from: governance,
          });
        }

        // trigger instructions
        const tx = await coreVaultManager.triggerInstructions({
          from: accounts[1],
        });
        console.log("triggering 50 payment + 50 escrow instructions - gas used: ", tx.receipt.gasUsed);

        const currentTimestamp = await time.latest();
        const escrowEndTimestamp = currentTimestamp.addn(DAY);
        let cancelAfterTs = escrowEndTimestamp.subn(escrowEndTimestamp.modn(DAY)).addn(escrowTimeSeconds);
        for (let i = 0; i < 50; i++) {
          const destinationAddress = web3.utils.keccak256("destinationAddress" + i);
          const amount = "100";
          expectEvent(tx, "PaymentInstructions", {
            sequence: i.toString(),
            account: coreVaultAddress,
            destination: destinationAddress,
            amount: amount,
            fee: fee,
            paymentReference: paymentReference,
          });
          const preimageHash = web3.utils.keccak256("hash" + i);
          expectEvent(tx, "EscrowInstructions", {
            sequence: (i + 50).toString(),
            preimageHash: preimageHash,
            account: coreVaultAddress,
            destination: custodianAddress,
            amount: "200",
            cancelAfterTs: cancelAfterTs.addn(i * DAY)
          });
        }
        assertWeb3Equal(await coreVaultManager.availableFunds(),
          16900 - 50 * 100 - 50 * 200 - 100 * 15); // 400
        assertWeb3Equal(await coreVaultManager.nextSequenceNumber(), 100);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 200 * 50);

        // trigger instructions again. Nothing should happen as there are no new requests and escrows still didn't expire
        const tx1 = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.nextSequenceNumber(), 100);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 10000);
        assertWeb3Equal(await coreVaultManager.availableFunds(), 400);
        expectEvent.notEmitted(tx1, "PaymentInstructions");
        expectEvent.notEmitted(tx1, "EscrowInstructions");
      });

      it("should not issue payment instructions if there are no funds", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const proof = createPaymentProof(transactionId, 1080 + 225 * 2 + 300);
        await coreVaultManager.confirmPayment(proof);

        // request cancelable transfers
        const amount1 = "1085";
        const paymentReference1 = web3.utils.keccak256("ref1");
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress1,
          paymentReference1,
          amount1,
          true,
          {
            from: assetManager,
          }
        );

        // trigger instructions
        const tx = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        expectEvent(tx, "PaymentInstructions", {
          sequence: "0",
          account: coreVaultAddress,
          destination: destinationAddress1,
          amount: amount1,
          fee: fee,
          paymentReference: paymentReference1,
        });
        expectEvent(tx, "EscrowInstructions", {
          sequence: "1",
          preimageHash: preimageHash1,
          account: coreVaultAddress,
          destination: custodianAddress,
          amount: "200",
          fee: fee,
        });
        expectEvent(tx, "EscrowInstructions", {
          sequence: "2",
          preimageHash: preimageHash2,
          account: coreVaultAddress,
          destination: custodianAddress,
          amount: "200",
          fee: fee,
        });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 300);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 2 * 200);

        // request transfers
        const amount2 = "286";
        const paymentReference2 = web3.utils.keccak256("ref2");
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress2,
          paymentReference2,
          amount2,
          true,
          {
            from: assetManager,
          }
        );
        const amount3 = "286";
        const paymentReference3 = ZERO_BYTES_32;
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress3,
          paymentReference3,
          amount3,
          false,
          {
            from: assetManager,
          }
        );
        // trigger instructions
        // should not issue payment instructions as there are no enough funds to cover the requested amounts
        const tx2 = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        expectEvent.notEmitted(tx2, "PaymentInstructions");
        assertWeb3Equal(await coreVaultManager.availableFunds(), 300);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 2 * 200);

        // confirm payment. One payment should be issued
        const transactionId1 = web3.utils.keccak256("transactionId1");
        const proof1 = createPaymentProof(transactionId1, 1);
        await coreVaultManager.confirmPayment(proof1);
        assertWeb3Equal(await coreVaultManager.availableFunds(), 301);
        const tx3 = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        expectEvent(tx3, "PaymentInstructions", {
          sequence: "3",
          account: coreVaultAddress,
          destination: destinationAddress2,
          amount: amount2,
          fee: fee,
          paymentReference: paymentReference2
        });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 0);

        // first escrow expires
        // 200 should be released which is not enough to cover the requested amount
        const currentTimestamp = await time.latest();
        const escrowEndTimestamp1 = currentTimestamp.addn(DAY);
        let cancelAfterTs1 = escrowEndTimestamp1.subn(escrowEndTimestamp1.modn(DAY)).addn(escrowTimeSeconds);
        await time.increaseTo(cancelAfterTs1.addn(1));

        // trigger instructions
        const tx4 = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 200);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 200);
        expectEvent.notEmitted(tx4, "PaymentInstructions");

        // second escrow expires; 200 should be released and payment should be issued
        await time.increase(DAY);
        const tx5 = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        expectEvent(tx5, "PaymentInstructions", {
          sequence: "4",
          account: coreVaultAddress,
          destination: destinationAddress3,
          amount: amount3,
          fee: fee,
          paymentReference: paymentReference3
        });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 2 * 200 - 286 - 15);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 0);
      });

      it("should set already processed escrow as finished", async () => {
        // fund contract
        const transactionId = web3.utils.keccak256("transactionId");
        const proof = createPaymentProof(transactionId, 500);
        await coreVaultManager.confirmPayment(proof);

        // trigger instructions - not enough funds to create escrow
        await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 500);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 0);

        // add funds for fee
        const transactionId1 = web3.utils.keccak256("transactionId1");
        const proof1 = createPaymentProof(transactionId1, 15);
        await coreVaultManager.confirmPayment(proof1);
        // trigger instructions - create escrow
        await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 300);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 200);

        // move to the expiry of the escrow
        await time.increase(2 * DAY);
        await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 500);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 0);

        // request transfer
        const amount = "200";
        const paymentReference = web3.utils.keccak256("ref1");
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress1,
          paymentReference,
          amount,
          true,
          {
            from: assetManager,
          }
        );
        // trigger instructions
        await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 500 - 200 - 15);

        // set escrow as finished; available funds will decrease
        await coreVaultManager.setEscrowsFinished([preimageHash1], { from: governance });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 285 - 200);
      });

      it("should skip creating new escrows if there are remaining cancelable requests", async () => {
        // fund contract
        const transactionId = web3.utils.keccak256("transactionId");
        const proof = createPaymentProof(transactionId, 780);
        await coreVaultManager.confirmPayment(proof);

        // create escrow
        await coreVaultManager.triggerInstructions({ from: accounts[1] });

        assertWeb3Equal(await coreVaultManager.availableFunds(), 780 - 200 * 2 - 15 * 2);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 400);

        // create cancelable request
        const amount1 = "385";
        const paymentReference1 = web3.utils.keccak256("ref1");
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress1,
          paymentReference1,
          amount1,
          true,
          {
            from: assetManager,
          }
        );
        // trigger instructions
        const tx = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 350);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 400);
        expectEvent.notEmitted(tx, "EscrowInstructions");
      });

      it("should skip creating escrows if escrow amount is zero (escrow disabled)", async () => {
        // set escrow amount to zero
        await coreVaultManager.updateSettings(escrowTimeSeconds, 0, 300, 15, { from: governance });

        // fund contract
        const transactionId = web3.utils.keccak256("transactionId");
        const proof = createPaymentProof(transactionId, 800);
        await coreVaultManager.confirmPayment(proof);

        // trigger instructions; no escrows should be created
        await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 800);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 0);
      });

      it("should revert triggering instructions if not from triggering account", async () => {
        await expectRevert(coreVaultManager.triggerInstructions({ from: accounts[2] }), "not authorized");
      });

      it("should revert triggering instructions if paused", async () => {
        await coreVaultManager.pause({ from: governance });
        await expectRevert(coreVaultManager.triggerInstructions({ from: accounts[1] }), "paused");
      });

      it("should not set escrow as finished if not from governance", async () => {
        await expectRevert(coreVaultManager.setEscrowsFinished([preimageHash1], { from: accounts[1] }), "only governance");
      });

      it("should revert setting escrow as finished if escrow not found", async () => {
        await expectRevert(coreVaultManager.setEscrowsFinished([web3.utils.keccak256("wrong hash")], { from: governance }), "not found");
      });

      it("should revert setting escrow if already finished", async () => {
        await createEscrows();
        await coreVaultManager.setEscrowsFinished([preimageHash1], { from: governance });
        await expectRevert(coreVaultManager.setEscrowsFinished([preimageHash1], { from: governance }), "already finished");
      });

      it("should get escrows", async () => {
        assertWeb3Equal(await coreVaultManager.getEscrowsCount(), 0);

        let escrows = await createEscrows();
        assertWeb3DeepEqual(await coreVaultManager.getUnprocessedEscrows(), escrows.map(e => Object.values(e)));

        // move to the expiry of the first escrow
        await time.increaseTo(escrows[0].cancelAfterTs.addn(1));
        await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3DeepEqual(await coreVaultManager.getUnprocessedEscrows(), [Object.values(escrows[1])]);

        assertWeb3Equal(await coreVaultManager.getEscrowsCount(), 2);
        const currentTimestamp = await time.latest();
        const escrowEndTimestamp1 = currentTimestamp.addn(DAY);
        let cancelAfterTs1 = escrowEndTimestamp1.subn(escrowEndTimestamp1.modn(DAY)).addn(escrowTimeSeconds);

        // set escrow as finished
        await coreVaultManager.setEscrowsFinished([preimageHash2], { from: governance });
        assertWeb3DeepEqual(await coreVaultManager.getEscrowByIndex(0), Object.values(escrows[0]));
        escrows[1].finished = true;
        assertWeb3DeepEqual(await coreVaultManager.getEscrowByIndex(1), Object.values(escrows[1]));
        assertWeb3DeepEqual(await coreVaultManager.getEscrowByPreimageHash(preimageHash1), Object.values(escrows[0]));
      });

      it("should process finished escrow", async () => {
        await createEscrows();
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 2 * 200);
        assertWeb3Equal(await coreVaultManager.availableFunds(), 800 - 2 * (200 + 25));

        // finish escrows
        await coreVaultManager.setEscrowsFinished([preimageHash1, preimageHash2], { from: governance });

        // process one escrow
        const tx = await coreVaultManager.processEscrows(1);
        expectEvent(tx, "NotAllEscrowsProcessed");

        // all escrows are now processed
        const tx1 = await coreVaultManager.processEscrows(1);
        expectEvent.notEmitted(tx1, "NotAllEscrowsProcessed");
      });

      it("should process expired escrow", async () => {
        await createEscrows();
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 2 * 200);
        assertWeb3Equal(await coreVaultManager.availableFunds(), 800 - 2 * (200 + 25));

        // go to second escrow expiry
        await time.increase(3 * DAY + 1);

        // process one escrow
        const tx = await coreVaultManager.processEscrows(1);
        expectEvent(tx, "NotAllEscrowsProcessed");

        // all escrows are now processed
        const tx1 = await coreVaultManager.processEscrows(1);
        expectEvent.notEmitted(tx1, "NotAllEscrowsProcessed");
      });

      it("should issue payment instruction for request with lower amount and keep the order", async () => {
        // fund contract
        const transactionId = web3.utils.keccak256("transactionId");
        const proof = createPaymentProof(transactionId, 780);
        await coreVaultManager.confirmPayment(proof);

        // create escrows
        await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 780 - 2 * 200 - 2 * 15); // 350
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 2 * 200);

        // request three cancelable transfer requests
        const amount1 = "336";
        const paymentReference1 = web3.utils.keccak256("ref1");
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress1,
          paymentReference1,
          amount1,
          true,
          {
            from: assetManager,
          }
        );
        const amount2 = "335";
        const paymentReference2 = web3.utils.keccak256("ref2");
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress2,
          paymentReference2,
          amount2,
          true,
          {
            from: assetManager,
          }
        );
        const amount3 = "20";
        const paymentReference3 = web3.utils.keccak256("ref3");
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress3,
          paymentReference3,
          amount3,
          true,
          {
            from: assetManager,
          }
        );
        let cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        assertWeb3Equal(cancelableTransferRequests.length, 3);
        assertWeb3DeepEqual(cancelableTransferRequests[0].destinationAddress, destinationAddress1);
        assertWeb3DeepEqual(cancelableTransferRequests[1].destinationAddress, destinationAddress2);
        assertWeb3DeepEqual(cancelableTransferRequests[2].destinationAddress, destinationAddress3);

        // trigger instructions
        const tx = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        expectEvent(tx, "PaymentInstructions", {
          sequence: "2",
          account: coreVaultAddress,
          destination: destinationAddress2,
          amount: amount2,
          fee: fee,
          paymentReference: paymentReference2
        });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 0);
        cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        assertWeb3Equal(cancelableTransferRequests.length, 2);
        assertWeb3DeepEqual(cancelableTransferRequests[0].destinationAddress, destinationAddress1);
        assertWeb3DeepEqual(cancelableTransferRequests[1].destinationAddress, destinationAddress3);
      });

      it("should issue payment instruction for request with lower amount and keep the order - non cancelable", async () => {
        // fund contract
        const transactionId = web3.utils.keccak256("transactionId");
        const proof = createPaymentProof(transactionId, 780);
        await coreVaultManager.confirmPayment(proof);

        // create escrows
        await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 780 - 2 * 200 - 2 * 15); // 350
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 2 * 200);

        // request three non-cancelable transfer requests
        const amount1 = "336";
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress1,
          ZERO_BYTES_32,
          amount1,
          false,
          {
            from: assetManager,
          }
        );
        const amount2 = "335";
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress2,
          ZERO_BYTES_32,
          amount2,
          false,
          {
            from: assetManager,
          }
        );
        const amount3 = "20";
        await coreVaultManager.requestTransferFromCoreVault(
          destinationAddress3,
          ZERO_BYTES_32,
          amount3,
          false,
          {
            from: assetManager,
          }
        );
        let nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        assertWeb3Equal(nonCancelableTransferRequests.length, 3);
        assertWeb3DeepEqual(nonCancelableTransferRequests[0].destinationAddress, destinationAddress1);
        assertWeb3DeepEqual(nonCancelableTransferRequests[1].destinationAddress, destinationAddress2);
        assertWeb3DeepEqual(nonCancelableTransferRequests[2].destinationAddress, destinationAddress3);

        // trigger instructions
        const tx = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        expectEvent(tx, "PaymentInstructions", {
          sequence: "2",
          account: coreVaultAddress,
          destination: destinationAddress2,
          amount: amount2,
          fee: fee,
          paymentReference: ZERO_BYTES_32
        });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 0);
        nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        assertWeb3Equal(nonCancelableTransferRequests.length, 2);
        assertWeb3DeepEqual(nonCancelableTransferRequests[0].destinationAddress, destinationAddress1);
        assertWeb3DeepEqual(nonCancelableTransferRequests[1].destinationAddress, destinationAddress3);
      });

      it("should create escrow in every trigger instructions call", async () => {
        const preimageHash3 = web3.utils.keccak256("hash3");
        const preimageHash4 = web3.utils.keccak256("hash4");
        await coreVaultManager.addPreimageHashes([preimageHash3, preimageHash4], {
          from: governance,
        });
        // fund contract
        const transactionId = web3.utils.keccak256("transactionId");
        const proof = createPaymentProof(transactionId, 780);
        await coreVaultManager.confirmPayment(proof);

        // create escrows
        const tx = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 780 - 2 * 200 - 2 * 15); // 350
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 2 * 200);
        const currentTimestamp = await time.latest();
        const escrowEndTimestamp1 = currentTimestamp.addn(DAY);
        let cancelAfterTs1 = escrowEndTimestamp1.subn(escrowEndTimestamp1.modn(DAY)).addn(escrowTimeSeconds);
        const cancelAfterTs2 = cancelAfterTs1.addn(DAY);
        expectEvent(tx, "EscrowInstructions", {
          sequence: "0",
          preimageHash: preimageHash1,
          account: coreVaultAddress,
          destination: custodianAddress,
          amount: "200",
          fee: fee,
          cancelAfterTs: cancelAfterTs1
        });
        expectEvent(tx, "EscrowInstructions", {
          sequence: "1",
          preimageHash: preimageHash2,
          account: coreVaultAddress,
          destination: custodianAddress,
          amount: "200",
          fee: fee,
          cancelAfterTs: cancelAfterTs2
        });

        // send additional funds to contract
        const transactionId1 = web3.utils.keccak256("transactionId1");
        const proof1 = createPaymentProof(transactionId1, 75);
        await coreVaultManager.confirmPayment(proof1);
        // move to the expiry of the first escrow
        await time.increaseTo(cancelAfterTs1.addn(1));
        // create escrows
        const tx1 = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        const currentTimestamp1 = await time.latest();
        let lastUnfinishedExpiry = cancelAfterTs2;
        const escrowEndTimestamp3 = lastUnfinishedExpiry.addn(DAY);
        let cancelAfterTs3 = escrowEndTimestamp3.subn(escrowEndTimestamp3.modn(DAY)).addn(escrowTimeSeconds);
        expectEvent(tx1, "EscrowInstructions", {
          sequence: "2",
          preimageHash: preimageHash3,
          account: coreVaultAddress,
          destination: custodianAddress,
          amount: "200",
          fee: fee,
          cancelAfterTs: cancelAfterTs3
        });
        assertWeb3Equal(await coreVaultManager.availableFunds(), 350 + 200 - 200 - 15 + 75);
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 2 * 200);

        // move to the expiry of the second escrow
        await time.increaseTo(cancelAfterTs2.addn(1));
        // set escrow as finished
        await coreVaultManager.setEscrowsFinished([preimageHash2], { from: governance });
        // send additional funds to contract
        const proof2 = createPaymentProof(web3.utils.keccak256("transactionId2"), 125);
        await coreVaultManager.confirmPayment(proof2);
        // create escrows
        const tx2 = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        lastUnfinishedExpiry = cancelAfterTs3;
        const escrowEndTimestamp4 = lastUnfinishedExpiry.addn(DAY);
        let cancelAfterTs4 = escrowEndTimestamp4.subn(escrowEndTimestamp4.modn(DAY)).addn(escrowTimeSeconds);
        expectEvent(tx2, "EscrowInstructions", {
          sequence: "3",
          preimageHash: preimageHash4,
          account: coreVaultAddress,
          destination: custodianAddress,
          amount: "200",
          fee: fee,
          cancelAfterTs: cancelAfterTs4
        });
      });

      it("should create escrow with end time moved one day ahead", async () => {
        // skip time to one minute before start of the day
        const currentTimestamp = await time.latest();
        const startOfDay = currentTimestamp.addn(DAY - currentTimestamp.modn(DAY));
        await time.increaseTo(startOfDay.subn(60));

        // fund contract
        const transactionId = web3.utils.keccak256("transactionId");
        const proof = createPaymentProof(transactionId, 780);
        await coreVaultManager.confirmPayment(proof);

        // create escrows
        const currentTs = await time.latest();
        const tx = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        const endTime = currentTs.addn(DAY);
        let cancelAfterTs = endTime.subn(endTime.modn(DAY)).addn(escrowTimeSeconds);
        cancelAfterTs = cancelAfterTs.addn(DAY); // less than 12 hours from now, move to the next day
        assertWeb3Equal(await coreVaultManager.availableFunds(), 780 - 2 * 200 - 2 * 15); // 350
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 2 * 200);
        expectEvent(tx, "EscrowInstructions", {
          sequence: "0",
          preimageHash: preimageHash1,
          account: coreVaultAddress,
          destination: custodianAddress,
          amount: "200",
          cancelAfterTs: cancelAfterTs
        });
      });

      it("should not take end timestamp of finished escrow", async () => {
        const preimageHash3 = web3.utils.keccak256("hash3");
        const preimageHash4 = web3.utils.keccak256("hash4");
        await coreVaultManager.addPreimageHashes([preimageHash3, preimageHash4], {
          from: governance,
        });
        const escrows = await createEscrows();
        const expiry2 = escrows[1].cancelAfterTs;
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 2 * 200);
        assertWeb3Equal(await coreVaultManager.availableFunds(), 780 - 2 * 200 - 2 * 15); // 350
        // finish second escrow
        await coreVaultManager.setEscrowsFinished([preimageHash2], { from: governance });
        assertWeb3Equal(await coreVaultManager.escrowedFunds(), 200);
        assertWeb3Equal(await coreVaultManager.availableFunds(), 780 - 2 * 200 - 2 * 15);
        // send additional funds to contract
        const proof1 = createPaymentProof(web3.utils.keccak256("transactionId1"), 165);
        await coreVaultManager.confirmPayment(proof1);

        // create one new escrow; expiry time should be the same as second escrow (now finished)
        const tx = await coreVaultManager.triggerInstructions({ from: accounts[1] });
        expectEvent(tx, "EscrowInstructions", {
          sequence: "2",
          preimageHash: preimageHash3,
          account: coreVaultAddress,
          destination: custodianAddress,
          amount: "200",
          cancelAfterTs: expiry2
        });
    });
  });

    describe("proxy upgrade", async () => {
      it("should upgrade via upgradeTo", async () => {
        // pause the contract
        await coreVaultManager.pause({ from: governance });
        const proxyAddress = coreVaultManager.address;
        const coreVaultManagerProxy = await CoreVaultManager.at(proxyAddress);
        assertWeb3Equal(await coreVaultManager.paused(), true);
        // upgrade
        const newImpl = await CoreVaultManager.new();
        await coreVaultManagerProxy.upgradeTo(newImpl.address, {
          from: governance,
        });
        // check
        assertWeb3Equal(coreVaultManager.address, proxyAddress);
        assertWeb3Equal(await coreVaultManager.paused(), true);
      });

      it("should upgrade via upgradeToAndCall", async () => {
        // pause the contract
        const proxyAddress = coreVaultManager.address;
        const coreVaultManagerProxy = await CoreVaultManager.at(proxyAddress);
        assertWeb3Equal(await coreVaultManager.paused(), false);
        // upgrade
        const newImpl = await CoreVaultManager.new();
        const callData = abiEncodeCall(coreVaultManager, (c) => c.pause());
        await coreVaultManagerProxy.upgradeTo(newImpl.address, {
          from: governance,
        });
        await coreVaultManagerProxy.upgradeToAndCall(newImpl.address, callData, {
          from: governance,
        });
        // check
        assertWeb3Equal(coreVaultManager.address, proxyAddress);
        assertWeb3Equal(await coreVaultManager.paused(), true);
      });

      it("calling initialize in upgradeToAndCall should revert in GovernedBase", async () => {
        const proxyAddress = coreVaultManager.address;
        const coreVaultManagerProxy = await CoreVaultManager.at(proxyAddress);
        // upgrade
        const newImpl = await CoreVaultManager.new();
        const callData = abiEncodeCall(coreVaultManager, (c) =>
          c.initialize(
            governanceSettings.address,
            governance,
            addressUpdater.address,
            assetManager,
            chainId,
            custodianAddress,
            coreVaultAddress,
            3
          )
        );

        await expectRevert(
          coreVaultManagerProxy.upgradeToAndCall(newImpl.address, callData, {
            from: governance,
          }),
          "initialised != false"
        );
      });

      it("should revert if not upgrading from governance", async () => {
        const proxyAddress = coreVaultManager.address;
        const coreVaultManagerProxy = await CoreVaultManager.at(proxyAddress);
        // upgrade
        const newImpl = await CoreVaultManager.new();
        await expectRevert(coreVaultManagerProxy.upgradeTo(newImpl.address), "only governance");
        const callData = abiEncodeCall(coreVaultManager, (c) => c.pause());
        await expectRevert(
          coreVaultManagerProxy.upgradeToAndCall(newImpl.address, callData),
          "only governance"
        );
      });
    });

    describe("ERC-165 interface identification", () => {
      it("should properly respond to supportsInterface", async () => {
        const IERC165 = artifacts.require(
          "@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as "IERC165"
        );
        const IIAddressUpdatable = artifacts.require(
          "flare-smart-contracts/contracts/addressUpdater/interface/IIAddressUpdatable.sol:IIAddressUpdatable" as "IIAddressUpdatable"
        );
        const IICoreVaultManager = artifacts.require("IICoreVaultManager");
        const ICoreVaultManager = artifacts.require("ICoreVaultManager");
        //
        const iERC165 = await IERC165.at(coreVaultManager.address);
        const iiAddressUpdatable = await IIAddressUpdatable.at(coreVaultManager.address);
        const iiCoreVaultManager = await IICoreVaultManager.at(coreVaultManager.address);
        const iCoreVaultManager = await ICoreVaultManager.at(coreVaultManager.address);
        //
        assert.isTrue(await coreVaultManager.supportsInterface(erc165InterfaceId(iERC165.abi)));
        assert.isTrue(await coreVaultManager.supportsInterface(erc165InterfaceId(iiAddressUpdatable.abi)));
        assert.isTrue(
          await coreVaultManager.supportsInterface(
            erc165InterfaceId(iiCoreVaultManager.abi, [iCoreVaultManager.abi])
          )
        );
        assert.isFalse(await coreVaultManager.supportsInterface("0xFFFFFFFF")); // shouldn't support invalid interface
      });
    });

    function createPaymentProof(
      _transactionId: string,
      _amount: number,
      _status = "0",
      _chainId = chainId,
      _receivingAddressHash = web3.utils.keccak256(coreVaultAddress),
      _standardPaymentReference = standardPaymentReference
    ): Payment.Proof {
      const requestBody: Payment.RequestBody = {
        transactionId: _transactionId,
        inUtxo: "0",
        utxo: "0",
      };
      const responseBody: Payment.ResponseBody = {
        blockNumber: "0",
        blockTimestamp: "0",
        sourceAddressHash: ZERO_BYTES32,
        sourceAddressesRoot: ZERO_BYTES32,
        receivingAddressHash: _receivingAddressHash,
        intendedReceivingAddressHash: _receivingAddressHash,
        standardPaymentReference: _standardPaymentReference,
        spentAmount: "0",
        intendedSpentAmount: "0",
        receivedAmount: String(_amount),
        intendedReceivedAmount: String(_amount),
        oneToOne: false, // not needed
        status: _status,
      };

      const response: Payment.Response = {
        attestationType: Payment.TYPE,
        sourceId: _chainId,
        votingRound: "0",
        lowestUsedTimestamp: "0",
        requestBody: requestBody,
        responseBody: responseBody,
      };

      const proof: Payment.Proof = {
        merkleProof: [],
        data: response,
      };

      return proof;
    }

  });
