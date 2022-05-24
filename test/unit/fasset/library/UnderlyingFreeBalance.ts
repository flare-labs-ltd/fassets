import { AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { findRequiredEvent } from "../../../utils/events";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../utils/fasset/AttestationHelper";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile, randomAddress, toBNExp } from "../../../utils/helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { SourceId } from "../../../utils/verification/sources/sources";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { createTestSettings } from "../test-settings";
import { PaymentReference } from "../../../utils/fasset/PaymentReference";
import { expectRevert } from "@openzeppelin/test-helpers";
import { ethers } from "hardhat";

const AgentVault = artifacts.require('AgentVault');
const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');

contract(`UnderlyingFreeBalance.sol; ${getTestFile(__filename)};  UnderlyingFreeBalance unit tests`, async accounts => {

    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let attestationClient: AttestationClientMockInstance;
    let assetManager: AssetManagerInstance;
    let wnat: WNatInstance;
    let fAsset: FAssetInstance;
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
        chain.mint(underlyingAddress, 1000);
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

    it("should confirm top up payment", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        let txHash = await wallet.addTransaction(underlyingAgent1, underlyingAgent1, 500, PaymentReference.topup(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        await assetManager.confirmTopupPayment(proof, agentVault.address, { from: agentOwner1 });
    });
    it("should reject confirmation of top up payment - not underlying address", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);  
        let txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.topup(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        let res = assetManager.confirmTopupPayment(proof, agentVault.address, { from: agentOwner1 });
        await expectRevert(res, 'not underlying address');
    });
    it("should reject confirmation of top up payment - not a topup payment", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);    
        let txHash = await wallet.addTransaction(underlyingAgent1, underlyingAgent1, 500, PaymentReference.topup(randomAddress()));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        let res = assetManager.confirmTopupPayment(proof, agentVault.address, { from: agentOwner1 });   
        await expectRevert(res, 'not a topup payment');
    });
    it("should reject confirmation of top up payment - topup before agent created", async () => {
        let agentVaultAddressCalc = ethers.utils.getContractAddress({from: assetManager.address, nonce: 1});
        let txHash = await wallet.addTransaction(underlyingAgent1, underlyingAgent1, 500, PaymentReference.topup(agentVaultAddressCalc));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);  
        let res =  assetManager.confirmTopupPayment(proof, agentVault.address, { from: agentOwner1 });   
        await expectRevert(res, 'topup before agent created');
    });
});