import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { AddressUpdaterInstance, CoreVaultManagerInstance, CoreVaultManagerProxyInstance, MockContractInstance } from "../../../../typechain-truffle";
import { GENESIS_GOVERNANCE_ADDRESS } from "../../../utils/constants";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { Payment } from "@flarenetwork/state-connector-protocol/dist/generated/types/typescript/Payment";
import { abiEncodeCall, erc165InterfaceId, ZERO_BYTES32 } from "../../../../lib/utils/helpers";
import { assertWeb3DeepEqual, assertWeb3Equal } from "../../../utils/web3assertions";

const CoreVaultManager = artifacts.require('CoreVaultManager');
const CoreVaultManagerProxy = artifacts.require('CoreVaultManagerProxy');
const GovernanceSettings = artifacts.require('GovernanceSettings');
const AddressUpdater = artifacts.require('AddressUpdater');
const MockContract = artifacts.require('MockContract');

contract(
  `CoreVaultManager.sol; ${getTestFile(
    __filename
  )}; CoreVaultManager basic tests`,
  async (accounts) => {
    let coreVaultManager: CoreVaultManagerInstance;
    let coreVaultManagerProxy: CoreVaultManagerProxyInstance;
    let coreVaultManagerImplementation: CoreVaultManagerInstance;
    let addressUpdater: AddressUpdaterInstance;
    let fdcVerification: MockContractInstance;
    const governance = accounts[1000];
    const assetManager = accounts[101];
    const chainId = web3.utils.keccak256("123");
    const custodianAddress = "custodianAddress";
    const coreVaultAddress = "coreVaultAddress";

    async function initialize() {
      // create governance settings
      const governanceSettings = await GovernanceSettings.new();
      await governanceSettings.initialise(governance, 60, [governance], {
        from: GENESIS_GOVERNANCE_ADDRESS,
      });
      // create address updater
      addressUpdater = await AddressUpdater.new(governance);  // don't switch to production
      // create core vault manager
      coreVaultManagerImplementation = await CoreVaultManager.new();
      coreVaultManagerProxy = await CoreVaultManagerProxy.new(
        coreVaultManagerImplementation.address,
        governanceSettings.address,
        governance,
        addressUpdater.address,
        assetManager,
        web3.utils.keccak256("123"),
        custodianAddress,
        coreVaultAddress,
        0
      );
      coreVaultManager = await CoreVaultManager.at(coreVaultManagerProxy.address);
      fdcVerification = await MockContract.new();
      await fdcVerification.givenAnyReturnBool(true);
      await addressUpdater.update(["AddressUpdater", "FdcVerification"], [addressUpdater.address, fdcVerification.address], [coreVaultManager.address], { from: governance });

      // await coreVaultManager.switchToProductionMode({ from: governance });
      return { coreVaultManager };
    }

    beforeEach(async () => {
      ({ coreVaultManager } = await loadFixtureCopyVars(initialize));
    });

    it("should add destination addresses", async () => {
      const tx = await coreVaultManager.addAllowedDestinationAddresses(
        ["addr1", "addr2"],
        { from: governance }
      );
      expectEvent(tx, "AllowedDestinationAddressAdded", {
        destinationAddress: "addr1",
      });
      const allowedDestinationAddresses =
        await coreVaultManager.getAllowedDestinationAddresses();
      expectEvent(tx, "AllowedDestinationAddressAdded", {
        destinationAddress: "addr2",
      });
      expect(allowedDestinationAddresses.length).to.equal(2);
      expect(allowedDestinationAddresses[0]).to.equal("addr1");
      expect(allowedDestinationAddresses[1]).to.equal("addr2");

      assertWeb3Equal(
        await coreVaultManager.isDestinationAddressAllowed("addr1"),
        true
      );
      assertWeb3Equal(
        await coreVaultManager.isDestinationAddressAllowed("addr2"),
        true
      );
      assertWeb3Equal(
        await coreVaultManager.isDestinationAddressAllowed("addr3"),
        false
      );

      // if address already exists, it should not be added again
      await coreVaultManager.addAllowedDestinationAddresses(
        ["addr3", "addr1"],
        { from: governance }
      );
      const allowedDestinationAddresses2 =
        await coreVaultManager.getAllowedDestinationAddresses();
      expect(allowedDestinationAddresses2.length).to.equal(3);
      expect(allowedDestinationAddresses2[0]).to.equal("addr1");
      expect(allowedDestinationAddresses2[1]).to.equal("addr2");
      expect(allowedDestinationAddresses2[2]).to.equal("addr3");
    });

    it("should revert adding allowed destination address if not from governance", async () => {
      const tx = coreVaultManager.addAllowedDestinationAddresses(
        [accounts[1]],
        { from: accounts[2] }
      );
      await expectRevert(tx, "only governance");
    });

    it("should revert adding empty destination address", async () => {
      const tx = coreVaultManager.addAllowedDestinationAddresses([""], {
        from: governance,
      });
      await expectRevert(tx, "destination address cannot be empty");
    });

    it("should remove allowed destination addresses", async () => {
      await coreVaultManager.addAllowedDestinationAddresses(
        ["addr1", "addr2"],
        { from: governance }
      );

      const tx = await coreVaultManager.removeAllowedDestinationAddresses(
        ["addr1", "addr2", "addr3"],
        { from: governance }
      );
      expectEvent(tx, "AllowedDestinationAddressRemoved", {
        destinationAddress: "addr1",
      });
      expectEvent(tx, "AllowedDestinationAddressRemoved", {
        destinationAddress: "addr2",
      });

      const allowedDestinationAddresses =
        await coreVaultManager.getAllowedDestinationAddresses();
      expect(allowedDestinationAddresses.length).to.equal(0);

      // if address is not on the list of allowed destination addresses, it shouldn't be removed
      const tx1 = await coreVaultManager.removeAllowedDestinationAddresses(
        ["addr1"],
        { from: governance }
      );
      expectEvent.notEmitted(tx1, "AllowedDestinationAddressRemoved");
    });

    it("should revert removing allowed destination address if not from governance", async () => {
      const tx = coreVaultManager.removeAllowedDestinationAddresses(
        [accounts[1]],
        { from: accounts[2] }
      );
      await expectRevert(tx, "only governance");
    });

    it("should add triggering accounts", async () => {
      const tx = await coreVaultManager.addTriggeringAccounts(
        [accounts[1], accounts[2]],
        { from: governance }
      );
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
      await coreVaultManager.addTriggeringAccounts(
        [accounts[1], accounts[2], accounts[3]],
        { from: governance }
      );

      const tx = await coreVaultManager.removeTriggeringAccounts(
        [accounts[1], accounts[2]],
        { from: governance }
      );
      expectEvent(tx, "TriggeringAccountRemoved", {
        triggeringAccount: accounts[1],
      });
      expectEvent(tx, "TriggeringAccountRemoved", {
        triggeringAccount: accounts[2],
      });
      expect((await coreVaultManager.getTriggeringAccounts()).length).to.equal(
        1
      );

      // if triggering account is not in the list, it shouldn't be removed
      const tx1 = await coreVaultManager.removeTriggeringAccounts(
        [accounts[1]],
        { from: governance }
      );
      expectEvent.notEmitted(tx1, "TriggeringAccountRemoved");
    });

    it("should revert removing triggering account if not from governance", async () => {
      const tx = coreVaultManager.removeTriggeringAccounts([accounts[1]], {
        from: accounts[2],
      });
      await expectRevert(tx, "only governance");
    });

    it("should update custodian address", async () => {
      const tx = await coreVaultManager.updateCustodianAddress(
        "newCustodianAddress",
        { from: governance }
      );
      expectEvent(tx, "CustodianAddressUpdated", {
        custodianAddress: "newCustodianAddress",
      });
      expect(await coreVaultManager.custodianAddress()).to.equal(
        "newCustodianAddress"
      );
    });

    it("should not update custodian address if not from governance", async () => {
      const tx = coreVaultManager.updateCustodianAddress("custodianAddress", {
        from: accounts[1],
      });
      await expectRevert(tx, "only governance");
    });

    it("should not update custodian address if new address is empty", async () => {
      const tx = coreVaultManager.updateCustodianAddress("", {
        from: governance,
      });
      await expectRevert(tx, "custodian address cannot be empty");
    });

    it("should update settings", async () => {
      const tx = await coreVaultManager.updateSettings(12345, 800, 900, {
        from: governance,
      });
      expectEvent(tx, "SettingsUpdated", {
        escrowEndTimeSeconds: "12345",
        escrowAmount: "800",
        minimalAmount: "900",
      });
      assertWeb3Equal(await coreVaultManager.escrowEndTimeSeconds(), "12345");
      assertWeb3Equal(await coreVaultManager.escrowAmount(), "800");
      assertWeb3Equal(await coreVaultManager.minimalAmount(), "900");
    });

    it("should not update settings if not from governance", async () => {
      const tx = coreVaultManager.updateSettings(12345, 800, 900, {
        from: accounts[1],
      });
      await expectRevert(tx, "only governance");
    });

    it("should not update settings if escrow end time is more than a day", async () => {
      const tx = coreVaultManager.updateSettings(24 * 3600, 800, 900, {
        from: governance,
      });
      await expectRevert(tx, "escrow end time must be less than a day");
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
      const tx = coreVaultManager.addPreimageHashes(
        [web3.utils.keccak256("hash1")],
        { from: accounts[1] }
      );
      await expectRevert(tx, "only governance");
    });

    it("should revert adding preimage hashes if zero hash", async () => {
      const tx = coreVaultManager.addPreimageHashes([ZERO_BYTES32], {
        from: governance,
      });
      await expectRevert(tx, "preimage hash cannot be zero");
    });

    it("should revert adding preimage hashes if hash already exists", async () => {
      const hash = web3.utils.keccak256("hash1");
      const tx = coreVaultManager.addPreimageHashes([hash, hash], {
        from: governance,
      });
      await expectRevert(tx, "preimage hash already exists");
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
      assertWeb3DeepEqual(await coreVaultManager.getUnusedPreimageHashes(), [
        web3.utils.keccak256("hash1"),
      ]);
    });

    it("should not remove unused preimage hashes if not from governance", async () => {
        const tx = coreVaultManager.removeUnusedPreimageHashes(1);
        await expectRevert(tx, "only governance");
    });


    it("should add emergency pause senders", async () => {
      await coreVaultManager.switchToProductionMode({ from: governance });
      const tx = await coreVaultManager.addEmergencyPauseSenders(
        [accounts[1], accounts[2]],
        { from: governance }
      );
      expectEvent(tx, "EmergencyPauseSenderAdded", { sender: accounts[1] });
      expectEvent(tx, "EmergencyPauseSenderAdded", { sender: accounts[2] });

      assertWeb3DeepEqual(await coreVaultManager.getEmergencyPauseSenders(), [
        accounts[1],
        accounts[2],
      ]);

      // if sender already exists, it should not be added again
      const tx1 = await coreVaultManager.addEmergencyPauseSenders(
        [accounts[1]],
        { from: governance }
      );
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
      await coreVaultManager.addEmergencyPauseSenders(
        [accounts[1], accounts[2], accounts[3]],
        { from: governance }
      );

      // remove two senders
      const tx = await coreVaultManager.removeEmergencyPauseSenders(
        [accounts[1], accounts[3]],
        { from: governance }
      );
      expectEvent(tx, "EmergencyPauseSenderRemoved", { sender: accounts[1] });
      expectEvent(tx, "EmergencyPauseSenderRemoved", { sender: accounts[3] });
      assertWeb3DeepEqual(await coreVaultManager.getEmergencyPauseSenders(), [
        accounts[2],
      ]);

      // if sender is not in the list, it shouldn't be removed
      const tx1 = await coreVaultManager.removeEmergencyPauseSenders(
        [accounts[1]],
        { from: governance }
      );
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
      await expectRevert(tx, "only governance or emergency pause senders");

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
        await coreVaultManagerProxy.upgradeToAndCall(
          newImpl.address,
          callData,
          { from: governance }
        );
        // check
        assertWeb3Equal(coreVaultManager.address, proxyAddress);
        assertWeb3Equal(await coreVaultManager.paused(), true);
      });

      it("calling initialize in upgradeToAndCall should revert in GovernedBase", async () => {
        const governanceSettings = await GovernanceSettings.new();
        await governanceSettings.initialise(governance, 60, [governance], {
          from: GENESIS_GOVERNANCE_ADDRESS,
        });
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
        await expectRevert(
          coreVaultManagerProxy.upgradeTo(newImpl.address),
          "only governance"
        );
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
        assert.isTrue(
          await coreVaultManager.supportsInterface(erc165InterfaceId(iERC165.abi))
        );
        assert.isTrue(
          await coreVaultManager.supportsInterface(erc165InterfaceId(iiAddressUpdatable.abi))
        );
        assert.isTrue(
          await coreVaultManager.supportsInterface(
            erc165InterfaceId(iiCoreVaultManager.abi, [
              iCoreVaultManager.abi,
            ])
          )
        );
        assert.isFalse(await coreVaultManager.supportsInterface("0xFFFFFFFF")); // shouldn't support invalid interface
      });
    });

    it("should revert adding allowed destination address if not from governance", async () => {
        const tx = coreVaultManager.addAllowedDestinationAddresses([accounts[1]], { from: accounts[2] });
        await expectRevert(tx, "only governance");
    });

    it("should revert adding empty destination address", async () => {
        const tx = coreVaultManager.addAllowedDestinationAddresses([""], { from: governance });
        await expectRevert(tx, "destination address cannot be empty");
    });


    // it("should add triggering accounts", async () => {
    //     await coreVaultManager.addTriggeringAccounts([accounts[1]], { from: governance });
    //     const triggeringAccounts = await coreVaultManager.triggeringAccounts();
    //     expect(triggeringAccounts.length).to.equal(1);
    //     expect(triggeringAccounts[0]).to.equal(accounts[1]);
    // });

    it("should revert adding triggering account if not from governance", async () => {
        const tx = coreVaultManager.addTriggeringAccounts([accounts[1]], { from: accounts[2] });
        await expectRevert(tx, "only governance");
    });

    it("should confirm payment", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 100;
        const proof = createPaymentProof(transactionId, amount);
        const tx = await coreVaultManager.confirmPayment(proof);
        expectEvent(tx, "PaymentConfirmed", { transactionId, amount: amount.toString() });
        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(amount);
        expect(await coreVaultManager.confirmedPayments(transactionId)).to.equal(true);
    });

    it("should not confirm payment twice", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 100;
        const proof = createPaymentProof(transactionId, amount);
        const tx = await coreVaultManager.confirmPayment(proof);
        expectEvent(tx, "PaymentConfirmed", { transactionId, amount: amount.toString() });
        const tx2 = await coreVaultManager.confirmPayment(proof);
        expectEvent.notEmitted(tx2, "PaymentConfirmed");
        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(amount);
    });

    it("should revert confirming payment with failed status", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 100;
        const proof = createPaymentProof(transactionId, amount, "1");
        await expectRevert(coreVaultManager.confirmPayment(proof), "payment failed");
        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(0);
    });

    it("should revert confirming payment with invalid chain", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 100;
        const proof = createPaymentProof(transactionId, amount, "0", web3.utils.keccak256("124"));
        await expectRevert(coreVaultManager.confirmPayment(proof), "invalid chain");
        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(0);
    });

    it("should revert confirming payment if payment is not proved", async () => {
        await fdcVerification.givenAnyReturnBool(false);
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 100;
        const proof = createPaymentProof(transactionId, amount);
        await expectRevert(coreVaultManager.confirmPayment(proof), "legal payment not proved");
        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(0);
    });

    it("should revert confirming payment sent to different address", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const amount = 100;
        const proof = createPaymentProof(transactionId, amount, "0", chainId, web3.utils.keccak256("notCoreVaultAddress"));
        await expectRevert(coreVaultManager.confirmPayment(proof), "not core vault's address");
        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(0);
    });

    it("should revert confirming payment with zero or negative amount", async () => {
        const transactionId = web3.utils.keccak256("transactionId");
        const proof = createPaymentProof(transactionId, 0);
        await expectRevert(coreVaultManager.confirmPayment(proof), "no amount received");
        const proof2 = createPaymentProof(transactionId, -100);
        await expectRevert(coreVaultManager.confirmPayment(proof2), "no amount received");
        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(0);
    });

    it("should request transfer from core vault (cancelable)", async () => {
        const destinationAddress = "destinationAddress";
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", destinationAddress, "addr2"], { from: governance });
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(destinationAddress, 100, true, { from: assetManager });
        expectEvent(tx, "TransferRequested", { destinationAddress, amount: "100", cancelable: true });

        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(1000);
        expect((await coreVaultManager.cancelableTransferRequestsAmount()).toNumber()).to.equal(100);
        expect((await coreVaultManager.nonCancelableTransferRequestsAmount()).toNumber()).to.equal(0);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(1);
        expect(cancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        expect(cancelableTransferRequests[0].amount.toString()).to.equal("100");
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(0);
    });

    it("should request multiple transfers from core vault - different destination addresses (cancelable)", async () => {
        const destinationAddress = "destinationAddress";
        const destinationAddress2 = "destinationAddress2";
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", destinationAddress, destinationAddress2], { from: governance });
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(destinationAddress, 100, true, { from: assetManager });
        expectEvent(tx, "TransferRequested", { destinationAddress, amount: "100", cancelable: true });
        const tx2 = await coreVaultManager.requestTransferFromCoreVault(destinationAddress2, 300, true, { from: assetManager });
        expectEvent(tx2, "TransferRequested", { destinationAddress: destinationAddress2, amount: "300", cancelable: true });

        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(1000);
        expect((await coreVaultManager.cancelableTransferRequestsAmount()).toNumber()).to.equal(400);
        expect((await coreVaultManager.nonCancelableTransferRequestsAmount()).toNumber()).to.equal(0);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(2);
        expect(cancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        expect(cancelableTransferRequests[0].amount.toString()).to.equal("100");
        expect(cancelableTransferRequests[1].destinationAddress).to.equal(destinationAddress2);
        expect(cancelableTransferRequests[1].amount.toString()).to.equal("300");
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(0);
    });

    it("should revert requesting multiple transfers from core vault - same destination address (cancelable)", async () => {
        const destinationAddress = "destinationAddress";
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", destinationAddress], { from: governance });
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(destinationAddress, 100, true, { from: assetManager });
        expectEvent(tx, "TransferRequested", { destinationAddress, amount: "100", cancelable: true });
        await expectRevert(coreVaultManager.requestTransferFromCoreVault(destinationAddress, 300, true, { from: assetManager }), "transfer request already exists");

        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(1000);
        expect((await coreVaultManager.cancelableTransferRequestsAmount()).toNumber()).to.equal(100);
        expect((await coreVaultManager.nonCancelableTransferRequestsAmount()).toNumber()).to.equal(0);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(1);
        expect(cancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        expect(cancelableTransferRequests[0].amount.toString()).to.equal("100");
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(0);
    });

    it("should request transfer from core vault (non-cancelable)", async () => {
        const destinationAddress = "destinationAddress";
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", destinationAddress, "addr2"], { from: governance });
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(destinationAddress, 100, false, { from: assetManager });
        expectEvent(tx, "TransferRequested", { destinationAddress, amount: "100", cancelable: false });

        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(1000);
        expect((await coreVaultManager.cancelableTransferRequestsAmount()).toNumber()).to.equal(0);
        expect((await coreVaultManager.nonCancelableTransferRequestsAmount()).toNumber()).to.equal(100);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(0);
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(1);
        expect(nonCancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        expect(nonCancelableTransferRequests[0].amount.toString()).to.equal("100");
    });

    it("should request multiple transfers from core vault - different destination addresses (non-cancelable)", async () => {
        const destinationAddress = "destinationAddress";
        const destinationAddress2 = "destinationAddress2";
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", destinationAddress, destinationAddress2], { from: governance });
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(destinationAddress, 100, false, { from: assetManager });
        expectEvent(tx, "TransferRequested", { destinationAddress, amount: "100", cancelable: false });
        const tx2 = await coreVaultManager.requestTransferFromCoreVault(destinationAddress2, 300, false, { from: assetManager });
        expectEvent(tx2, "TransferRequested", { destinationAddress: destinationAddress2, amount: "300", cancelable: false });

        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(1000);
        expect((await coreVaultManager.cancelableTransferRequestsAmount()).toNumber()).to.equal(0);
        expect((await coreVaultManager.nonCancelableTransferRequestsAmount()).toNumber()).to.equal(400);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(0);
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(2);
        expect(nonCancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        expect(nonCancelableTransferRequests[0].amount.toString()).to.equal("100");
        expect(nonCancelableTransferRequests[1].destinationAddress).to.equal(destinationAddress2);
        expect(nonCancelableTransferRequests[1].amount.toString()).to.equal("300");
    });

    it("should request multiple transfers from core vault - same destination addresses (non-cancelable)", async () => {
        const destinationAddress = "destinationAddress";
        const destinationAddress2 = "destinationAddress2";
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", destinationAddress, destinationAddress2], { from: governance });
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(destinationAddress, 100, false, { from: assetManager });
        expectEvent(tx, "TransferRequested", { destinationAddress, amount: "100", cancelable: false });
        const tx2 = await coreVaultManager.requestTransferFromCoreVault(destinationAddress2, 300, false, { from: assetManager });
        expectEvent(tx2, "TransferRequested", { destinationAddress: destinationAddress2, amount: "300", cancelable: false });
        const tx3 = await coreVaultManager.requestTransferFromCoreVault(destinationAddress, 100, false, { from: assetManager });
        expectEvent(tx3, "TransferRequested", { destinationAddress: destinationAddress, amount: "100", cancelable: false });

        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(1000);
        expect((await coreVaultManager.cancelableTransferRequestsAmount()).toNumber()).to.equal(0);
        expect((await coreVaultManager.nonCancelableTransferRequestsAmount()).toNumber()).to.equal(500);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(0);
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(2);
        expect(nonCancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress);
        expect(nonCancelableTransferRequests[0].amount.toString()).to.equal("200");
        expect(nonCancelableTransferRequests[1].destinationAddress).to.equal(destinationAddress2);
        expect(nonCancelableTransferRequests[1].amount.toString()).to.equal("300");
    });

    it("should revert requesting transfer if not from asset manager", async () => {
        assert.notEqual(assetManager, accounts[1]);
        await expectRevert(coreVaultManager.requestTransferFromCoreVault("addr1", 10, false, { from: accounts[1]}), "only asset manager");
    });

    it("should revert requesting transfer if paused", async () => {
        await coreVaultManager.pause({ from: governance });
        await expectRevert(coreVaultManager.requestTransferFromCoreVault("addr1", 10, false, { from: assetManager}), "paused");
    });

    it("should revert requesting transfer if amount is 0", async () => {
        await expectRevert(coreVaultManager.requestTransferFromCoreVault("addr1", 0, false, { from: assetManager}), "amount must be greater than zero");
    });

    it("should revert requesting transfer if destination address is not allowed", async () => {
        await expectRevert(coreVaultManager.requestTransferFromCoreVault("addr1", 10, false, { from: assetManager}), "destination address not allowed");
    });

    it("should revert requesting transfer if there are insufficient funds", async () => {
        const destinationAddress = "destinationAddress";
        const destinationAddress2 = "destinationAddress2";
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", destinationAddress, destinationAddress2], { from: governance });
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        await coreVaultManager.requestTransferFromCoreVault(destinationAddress, 100, true, { from: assetManager})
        await coreVaultManager.requestTransferFromCoreVault(destinationAddress2, 300, false, { from: assetManager})

        await coreVaultManager.addAllowedDestinationAddresses(["addr1"], { from: governance });
        await expectRevert(coreVaultManager.requestTransferFromCoreVault("addr1", 700, false, { from: assetManager}), "insufficient funds");
    });

    it("should cancel request transfer from core vault and keep the order", async () => {
        const destinationAddress = "destinationAddress";
        const destinationAddress2 = "destinationAddress2";
        const destinationAddress3 = "destinationAddress3";
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", destinationAddress, destinationAddress2, destinationAddress3], { from: governance });
        const proof = createPaymentProof(web3.utils.keccak256("transactionId"), 1000);
        await coreVaultManager.confirmPayment(proof); // available funds = 1000

        const tx = await coreVaultManager.requestTransferFromCoreVault(destinationAddress, 100, true, { from: assetManager });
        expectEvent(tx, "TransferRequested", { destinationAddress, amount: "100", cancelable: true });
        const tx2 = await coreVaultManager.requestTransferFromCoreVault(destinationAddress2, 300, true, { from: assetManager });
        expectEvent(tx2, "TransferRequested", { destinationAddress: destinationAddress2, amount: "300", cancelable: true });
        const tx3 = await coreVaultManager.requestTransferFromCoreVault(destinationAddress3, 600, true, { from: assetManager });
        expectEvent(tx3, "TransferRequested", { destinationAddress: destinationAddress3, amount: "600", cancelable: true });

        const tx4 = await coreVaultManager.cancelTransferRequestFromCoreVault(destinationAddress, { from: assetManager });
        expectEvent(tx4, "TransferRequestCanceled", { destinationAddress, amount: "100" });

        expect((await coreVaultManager.availableFunds()).toNumber()).to.equal(1000);
        expect((await coreVaultManager.cancelableTransferRequestsAmount()).toNumber()).to.equal(900);
        expect((await coreVaultManager.nonCancelableTransferRequestsAmount()).toNumber()).to.equal(0);
        const cancelableTransferRequests = await coreVaultManager.getCancelableTransferRequests();
        expect(cancelableTransferRequests.length).to.equal(2);
        expect(cancelableTransferRequests[0].destinationAddress).to.equal(destinationAddress2);
        expect(cancelableTransferRequests[0].amount.toString()).to.equal("300");
        expect(cancelableTransferRequests[1].destinationAddress).to.equal(destinationAddress3);
        expect(cancelableTransferRequests[1].amount.toString()).to.equal("600");
        const nonCancelableTransferRequests = await coreVaultManager.getNonCancelableTransferRequests();
        expect(nonCancelableTransferRequests.length).to.equal(0);
    });

    it("should revert canceling request transfer if not from asset manager", async () => {
        assert.notEqual(assetManager, accounts[1]);
        await expectRevert(coreVaultManager.cancelTransferRequestFromCoreVault("addr1", { from: accounts[1]}), "only asset manager");
    });

    it("should revert canceling request transfer if request not found", async () => {
        await expectRevert(coreVaultManager.cancelTransferRequestFromCoreVault("addr1", { from: assetManager}), "transfer request not found");
    });

    function createPaymentProof(_transactionId: string, _amount: number, _status = "0", _chainId = chainId, _receivingAddressHash = web3.utils.keccak256(coreVaultAddress)): Payment.Proof {
         const requestBody: Payment.RequestBody = {
            transactionId: _transactionId,
            inUtxo: "0",
            utxo: "0"
        };
        const responseBody: Payment.ResponseBody = {
            blockNumber: "0",
            blockTimestamp: "0",
            sourceAddressHash: ZERO_BYTES32,
            sourceAddressesRoot: ZERO_BYTES32,
            receivingAddressHash: _receivingAddressHash,
            intendedReceivingAddressHash: _receivingAddressHash,
            standardPaymentReference: ZERO_BYTES32,
            spentAmount: "0",
            intendedSpentAmount: "0",
            receivedAmount: String(_amount),
            intendedReceivedAmount: String(_amount),
            oneToOne: false,    // not needed
            status: _status
        };

        const response: Payment.Response = {
            attestationType: Payment.TYPE,
            sourceId: _chainId,
            votingRound: "0",
            lowestUsedTimestamp: "0",
            requestBody: requestBody,
            responseBody: responseBody
        };

        const proof: Payment.Proof = {
            merkleProof: [],
            data: response
        };

        return proof;
    }

});
