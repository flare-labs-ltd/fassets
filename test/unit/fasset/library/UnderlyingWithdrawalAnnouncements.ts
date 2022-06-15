import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerInstance, AttestationClientSCInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { findRequiredEvent } from "../../../../lib/utils/events";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../utils/fasset/AttestationHelper";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../../utils/fasset/PaymentReference";
import { toBN, toBNExp } from "../../../../lib/utils/helpers";
import { getTestFile } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { SourceId } from "../../../../lib/verification/sources/sources";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { createTestSettings } from "../test-settings";

const AgentVault = artifacts.require('AgentVault');
const AttestationClient = artifacts.require('AttestationClientSC');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const StateConnector = artifacts.require('StateConnectorMock');
const AgentVaultFactory = artifacts.require('AgentVaultFactory');

contract(`UnderlyingWithdrawalAnnouncements.sol; ${getTestFile(__filename)}; UnderlyingWithdrawalAnnouncements basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let attestationClient: AttestationClientSCInstance;
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
        // create state connector
        const stateConnector = await StateConnector.new();
        // create agent vault factory
        const agentVaultFactory = await AgentVaultFactory.new();
        // create atetstation client
        attestationClient = await AttestationClient.new(stateConnector.address);
        // create mock chain attestation provider
        chain = new MockChain(await time.latest());
        wallet = new MockChainWallet(chain);
        stateConnectorClient = new MockStateConnectorClient(stateConnector, { [chainId]: chain }, 'auto');
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
        settings = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings);
    });

    it("should announce underlying withdrawal", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        const res = await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        // assert
        expectEvent(res, "UnderlyingWithdrawalAnnounced", {agentVault: agentVault.address, announcementId: toBN(1), paymentReference: PaymentReference.announcedWithdrawal(1)});
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.announcedUnderlyingWithdrawalId, 1);
    });

    it("should not change announced underlying withdrawal", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        // act
        const promise = assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "announced underlying withdrawal active");
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.announcedUnderlyingWithdrawalId, 1);
    });

    it("only owner can announce underlying withdrawal", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.announceUnderlyingWithdrawal(agentVault.address),
            "only agent vault owner");
    });

    it("should confirm underlying withdrawal", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const blockId = (await chain.getTransactionBlock(txHash))!.number;
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        const res = await assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address, { from: agentOwner1 });
        // assert
        expectEvent(res, "UnderlyingWithdrawalConfirmed", {agentVault: agentVault.address, announcementId: toBN(1), spentUBA: toBN(500), underlyingBlock: toBN(blockId)});
    });

    it("others can confirm underlying withdrawal after some time", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const blockId = (await chain.getTransactionBlock(txHash))!.number;
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        const settings = await assetManager.getSettings();
        await time.increase(settings.confirmationByOthersAfterSeconds);
        const res = await assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address, { from: agentOwner1 });
        // assert
        expectEvent(res, "UnderlyingWithdrawalConfirmed", {agentVault: agentVault.address, announcementId: toBN(1), spentUBA: toBN(500), underlyingBlock: toBN(blockId)});
    });

    it("only owner can confirm underlying withdrawal immediatelly", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        // assert
        await expectRevert(assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address),
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
        await expectRevert(assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address, { from: agentOwner1 }),
            "no active announcement");
    });

    it("should revert confirming underlying withdrawal if reference is wrong", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(toBN(announcementId).addn(1)));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        // assert
        await expectRevert(assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address),
            "wrong announced pmt reference");
    });

    it("should revert confirming underlying withdrawal if source is wrong", async () => {
        // init
        const underlyingAgent2 = "Agent2"
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent2, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent2, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent2, null);
        // assert
        await expectRevert(assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address),
            "wrong announced pmt source");
    });

    it("should cancel underlying withdrawal", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        // act
        const res = await assetManager.cancelUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        // assert
        expectEvent(res, "UnderlyingWithdrawalCancelled", {agentVault: agentVault.address, announcementId: toBN(1)})
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.announcedUnderlyingWithdrawalId, 0);
    });

    it("only owner can cancel underlying withdrawal", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        // act
        const promise = assetManager.cancelUnderlyingWithdrawal(agentVault.address);
        // assert
        await expectRevert(promise, "only agent vault owner");
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.announcedUnderlyingWithdrawalId, 1);
    });

    it("should cancel underlying withdrawal only if active", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        const promise = assetManager.cancelUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "no active announcement");
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.announcedUnderlyingWithdrawalId, 0);
    });
});
