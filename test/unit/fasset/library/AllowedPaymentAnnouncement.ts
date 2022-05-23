import { balance, ether, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { findRequiredEvent } from "../../../utils/events";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../utils/fasset/AttestationHelper";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../../utils/fasset/PaymentReference";
import { getTestFile, randomAddress, toBN, toBNExp, toWei } from "../../../utils/helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { SourceId } from "../../../utils/verification/sources/sources";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { createTestSettings } from "../test-settings";

const AgentVault = artifacts.require('AgentVault');
const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');

contract(`AllowedPaymentAnnouncement.sol; ${getTestFile(__filename)}; AllowedPaymentAnnouncement basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let attestationClient: AttestationClientMockInstance;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;
    let wnat: WNatInstance;
    let ftsoRegistry: FtsoRegistryMockInstance;
    let natFtso: FtsoMockInstance;
    let assetFtso: FtsoMockInstance;
    let settings: AssetManagerSettings;
    const chainId: SourceId = 1;
    let chain: MockChain;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;
    
    // addresses
    const underlyingBurnAddr = "Burn";
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique


    async function createAgent(chain: MockChain, owner: string, underlyingAddress: string) {
        // mint some funds on underlying address (just enough to make EOA proof)
        chain.mint(underlyingAddress, 101);
        // create and prove transaction from underlyingAddress
        const txHash = await wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(owner), { maxFee: 100 });
        const proof = await attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
        await assetManager.proveUnderlyingAddressEOA(proof, { from: owner });
        // create agent
        const response = await assetManager.createAgent(underlyingAddress, { from: owner });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        const agentVaultAddress = event.args.agentVault;
        // get vault contract at this address
        return await AgentVault.at(agentVaultAddress);
    }

    beforeEach(async () => {
        // create atetstation client
        attestationClient = await AttestationClient.new();
        // create mock chain attestation provider
        chain = new MockChain();
        wallet = new MockChainWallet(chain);
        stateConnectorClient = new MockStateConnectorClient(attestationClient, { [chainId]: chain }, 'auto');
        attestationProvider = new AttestationHelper(stateConnectorClient, chain, chainId, 0);
        // create WNat token
        wnat = await WNat.new(governance, "NetworkNative", "NAT");
        await setDefaultVPContract(wnat, governance);
        // create FTSOs for nat and asset and set some price
        natFtso = await FtsoMock.new("NAT");
        await natFtso.setCurrentPrice(toBNExp(1.12, 5), 0);
        assetFtso = await FtsoMock.new("ETH");
        await assetFtso.setCurrentPrice(toBNExp(3521, 5), 0);
        // create ftso registry
        ftsoRegistry = await FtsoRegistryMock.new();
        await ftsoRegistry.addFtso(natFtso.address);
        await ftsoRegistry.addFtso(assetFtso.address);
        // create asset manager
        settings = createTestSettings(attestationClient, wnat, ftsoRegistry);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings);
    });

    it("should announce allowed payment", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        const res = await assetManager.announceAllowedPayment(agentVault.address, { from: agentOwner1 });
        // assert
        expectEvent(res, "AllowedPaymentAnnounced", {agentVault: agentVault.address, announcementId: toBN(1), paymentReference: PaymentReference.announcedWithdrawal(1)});
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.announcedUnderlyingWithdrawalId, 1);
    });

    it("should not change announced allowed payment", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await assetManager.announceAllowedPayment(agentVault.address, { from: agentOwner1 });
        // act
        const promise = assetManager.announceAllowedPayment(agentVault.address, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "announced payment active");
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.announcedUnderlyingWithdrawalId, 1);
    });

    it("only owner can announce allowed payment", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.announceAllowedPayment(agentVault.address),
            "only agent vault owner");
    });

    it("should confirm allowed payment", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceAllowedPayment(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const blockId = (await chain.getTransactionBlock(txHash))!.number;
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        const res = await assetManager.confirmAllowedPayment(proof, agentVault.address, announcementId, { from: agentOwner1 });
        // assert
        expectEvent(res, "AllowedPaymentConfirmed", {agentVault: agentVault.address, announcementId: toBN(1), spentUBA: toBN(500), underlyingBlock: toBN(blockId)});
    });

    it("others can confirm allowed payment after some time", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceAllowedPayment(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const blockId = (await chain.getTransactionBlock(txHash))!.number;
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        const settings = await assetManager.getSettings();
        await time.increase(settings.confirmationByOthersAfterSeconds);
        const res = await assetManager.confirmAllowedPayment(proof, agentVault.address, announcementId, { from: agentOwner1 });
        // assert
        expectEvent(res, "AllowedPaymentConfirmed", {agentVault: agentVault.address, announcementId: toBN(1), spentUBA: toBN(500), underlyingBlock: toBN(blockId)});
    });

    it("only owner can confirm allowed payment immediatelly", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceAllowedPayment(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        // assert
        await expectRevert(assetManager.confirmAllowedPayment(proof, agentVault.address, announcementId),
            "only agent vault owner");
    });

    it("only announced payment can be confirmed", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        // assert
        await expectRevert(assetManager.confirmAllowedPayment(proof, agentVault.address, announcementId, { from: agentOwner1 }),
            "no active announcement");
    });

    it("should revert confirming allowed payment if reference is wrong", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceAllowedPayment(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(toBN(announcementId).addn(1)));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        // assert
        await expectRevert(assetManager.confirmAllowedPayment(proof, agentVault.address, announcementId),
            "wrong announced pmt reference");
    });

    it("should revert confirming allowed payment if source is wrong", async () => {
        // init
        const underlyingAgent2 = "Agent2"
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent2, 500);
        await assetManager.announceAllowedPayment(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent2, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent2, null);
        // assert
        await expectRevert(assetManager.confirmAllowedPayment(proof, agentVault.address, announcementId),
            "wrong announced pmt source");
    });
});
