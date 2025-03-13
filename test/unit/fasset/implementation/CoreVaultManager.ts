import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { AddressUpdaterInstance, CoreVaultManagerInstance, CoreVaultManagerProxyInstance, MockContractInstance } from "../../../../typechain-truffle";
import { GENESIS_GOVERNANCE_ADDRESS } from "../../../utils/constants";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { Payment } from "@flarenetwork/state-connector-protocol/dist/generated/types/typescript/Payment";
import { ZERO_BYTES32 } from "../../../../lib/utils/helpers";

const CoreVaultManager = artifacts.require('CoreVaultManager');
const CoreVaultManagerProxy = artifacts.require('CoreVaultManagerProxy');
const GovernanceSettings = artifacts.require('GovernanceSettings');
const AddressUpdater = artifacts.require('AddressUpdater');
const MockContract = artifacts.require('MockContract');

contract.only(`CoreVaultManager.sol; ${getTestFile(__filename)}; CoreVaultManager basic tests`, async accounts => {
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
        await governanceSettings.initialise(governance, 60, [governance], { from: GENESIS_GOVERNANCE_ADDRESS });
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
            chainId,
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

    it("should add and get allowed destination addresses", async () => {
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", "addr2"], { from: governance });
        const allowedDestinationAddresses = await coreVaultManager.getAllowedDestinationAddresses();
        expect(allowedDestinationAddresses.length).to.equal(2);
        expect(allowedDestinationAddresses[0]).to.equal("addr1");
        expect(allowedDestinationAddresses[1]).to.equal("addr2");

        // if address already exists, it should not be added again
        await coreVaultManager.addAllowedDestinationAddresses(["addr3", "addr1"], { from: governance });
        const allowedDestinationAddresses2 = await coreVaultManager.getAllowedDestinationAddresses();
        expect(allowedDestinationAddresses2.length).to.equal(3);
        expect(allowedDestinationAddresses2[0]).to.equal("addr1");
        expect(allowedDestinationAddresses2[1]).to.equal("addr2");
        expect(allowedDestinationAddresses2[2]).to.equal("addr3");
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
