import { expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentVaultInstance, AssetManagerInstance, AttestationClientSCInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { findRequiredEvent } from "../../../utils/events";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../utils/fasset/AttestationHelper";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../../utils/fasset/PaymentReference";
import { getTestFile, toBNExp } from "../../../utils/helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { SourceId } from "../../../utils/verification/sources/sources";
import { createTestSettings } from "../test-settings";

const AgentVault = artifacts.require('AgentVault');
const AttestationClient = artifacts.require('AttestationClientSC');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const StateConnector = artifacts.require('StateConnectorMock');

contract(`PaymentConfirmations.sol; ${getTestFile(__filename)}; PaymentConfirmations basic tests`, async accounts => {
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
    const agentOwner1 = accounts[20];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1"; 
    const underlyingRandomAddress = "Random";

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

    async function agentTopup(agentVault: AgentVaultInstance){
        let txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, 1, PaymentReference.topup(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        await assetManager.confirmTopupPayment(proof, agentVault.address, { from: agentOwner1 });
        return proof;
    }

    beforeEach(async () => {
        // create state connector
        const stateConnector = await StateConnector.new();
        // create atetstation client
        attestationClient = await AttestationClient.new(stateConnector.address);
        // create mock chain attestation provider
        chain = new MockChain(await time.latest());
        wallet = new MockChainWallet(chain);
        chain.mint(underlyingRandomAddress, 1000);
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
        settings = createTestSettings(attestationClient, wnat, ftsoRegistry);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings);
    });

    it("should cleanup payment verifications after 5 days", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const proof1 = await agentTopup(agentVault);
        // make transaction in the "future" (chains timestamp may differ)
        chain.skipTime(5 * 86400);
        const proof2 = await agentTopup(agentVault);
        // it should revert confirming twice
        await expectRevert(assetManager.confirmTopupPayment(proof1, agentVault.address, { from: agentOwner1 }), "payment already confirmed");
        await expectRevert(assetManager.confirmTopupPayment(proof2, agentVault.address, { from: agentOwner1 }), "payment already confirmed");
        // after 15 days it should cleanup old payment verifications
        await time.increase(15 * 86400);
        await agentTopup(agentVault);
        await agentTopup(agentVault);
        await expectRevert(assetManager.confirmTopupPayment(proof1, agentVault.address, { from: agentOwner1 }), "verified transaction too old");
        await assetManager.confirmTopupPayment(proof2, agentVault.address, { from: agentOwner1 });
        // skipping one more day
        await time.increase(86400);
        chain.skipTime(86400);
        await agentTopup(agentVault);
        await expectRevert(assetManager.confirmTopupPayment(proof1, agentVault.address, { from: agentOwner1 }), "verified transaction too old");
        await expectRevert(assetManager.confirmTopupPayment(proof2, agentVault.address, { from: agentOwner1 }), "payment already confirmed");
        // after 5 days it should cleanup old payment verifications
        await time.increase(5 * 86400);
        chain.skipTime(5 * 86400);
        await agentTopup(agentVault);
        await expectRevert(assetManager.confirmTopupPayment(proof1, agentVault.address, { from: agentOwner1 }), "verified transaction too old");
        await expectRevert(assetManager.confirmTopupPayment(proof2, agentVault.address, { from: agentOwner1 }), "verified transaction too old");
    });
});
