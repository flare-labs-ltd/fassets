import { AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../../typechain-truffle";
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

const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');

contract(`StateUpdater.sol; ${getTestFile(__filename)}; StateUpdater basic tests`, async accounts => {
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
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique

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

    it("update current block - twice", async () => {
        chain.mint(underlyingAgent1, 200);
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingAgent1, 50, PaymentReference.addressOwnership(agentOwner1), { maxFee: 100 });
        await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingAgent1);

        const proof = await attestationProvider.proveConfirmedBlockHeightExists();
        await assetManager.updateCurrentBlock(proof);
        const proof2 = await attestationProvider.proveConfirmedBlockHeightExists();
        await assetManager.updateCurrentBlock(proof2);;
    });
});
