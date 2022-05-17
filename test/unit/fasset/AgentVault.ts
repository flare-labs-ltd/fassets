import { constants, ether, expectRevert } from "@openzeppelin/test-helpers";
import { AddressUpdaterInstance, AgentVaultInstance, AssetManagerControllerInstance, AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, WNatInstance } from "../../../typechain-truffle";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { newAssetManager } from "../../utils/fasset/DeployAssetManager";
import { getTestFile, toBNExp } from "../../utils/helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { createTestSettings } from "./test-settings";

const WNat = artifacts.require("WNat");
const AgentVault = artifacts.require("AgentVault");
const AddressUpdater = artifacts.require('AddressUpdater');
const AssetManagerController = artifacts.require('AssetManagerController');
const AttestationClient = artifacts.require('AttestationClientMock');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');

contract(`AgentVault.sol; ${getTestFile(__filename)}; AgentVault unit tests`, async accounts => {
    let wnat: WNatInstance;
    let agentVault: AgentVaultInstance;
    let assetManagerController: AssetManagerControllerInstance;
    let addressUpdater: AddressUpdaterInstance;
    let attestationClient: AttestationClientMockInstance;
    let natFtso: FtsoMockInstance;
    let assetFtso: FtsoMockInstance;
    let settings: AssetManagerSettings;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;

    const owner = accounts[1];
    const governance = accounts[10];

    beforeEach(async () => {
        // create atetstation client
        attestationClient = await AttestationClient.new();
        // create WNat token
        wnat = await WNat.new(governance, "NetworkNative", "NAT");
        await setDefaultVPContract(wnat, governance);
        // create FTSOs for nat and asset and set some price
        natFtso = await FtsoMock.new("NAT");
        await natFtso.setCurrentPrice(toBNExp(1.12, 5), 0);
        assetFtso = await FtsoMock.new("ETH");
        await assetFtso.setCurrentPrice(toBNExp(3521, 5), 0);
        // create ftso registry
        const ftsoRegistry = await FtsoRegistryMock.new();
        await ftsoRegistry.addFtso(natFtso.address);
        await ftsoRegistry.addFtso(assetFtso.address);
        // create asset manager controller
        addressUpdater = await AddressUpdater.new(governance);
        assetManagerController = await AssetManagerController.new(governance, addressUpdater.address);
        // create asset manager
        settings = createTestSettings(attestationClient, wnat, ftsoRegistry);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController.address, "Ethereum", "ETH", 18, settings);
        await assetManagerController.addAssetManager(assetManager.address, { from: governance });
        // create agent vault
        agentVault = await AgentVault.new(assetManager.address, owner);

    });

    it("cannot delegate if not owner", async () => {
        const res = agentVault.delegate(accounts[2], 50);
        await expectRevert(res, "only owner")
    });

    it("should delegate", async () => {
        await agentVault.delegate(accounts[2], 50, { from: owner });
        const { _delegateAddresses } = await wnat.delegatesOf(agentVault.address) as any;
        assertWeb3Equal(_delegateAddresses[0], accounts[2]);
    });

    it("should undelegate all", async () => {
        await agentVault.delegate(accounts[2], 50, { from: owner });
        await agentVault.delegate(accounts[3], 10, { from: owner });
        let resDelegate = await wnat.delegatesOf(agentVault.address) as any;
        assertWeb3Equal(resDelegate._delegateAddresses.length, 2);

        await agentVault.undelegateAll({ from: owner });
        let resUndelegate = await wnat.delegatesOf(agentVault.address) as any;
        assertWeb3Equal(resUndelegate._delegateAddresses.length, 0);
    });

    it("should revoke delegation", async () => {
        await agentVault.delegate(accounts[2], 50, { from: owner });
        const blockNumber = await web3.eth.getBlockNumber();
        await agentVault.revokeDelegationAt(accounts[2], blockNumber, { from: owner });
    });

});
