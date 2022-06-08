import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerInstance, AttestationClientSCInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WhitelistInstance, WNatInstance } from "../../../../typechain-truffle";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../utils/fasset/AttestationHelper";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../../utils/fasset/PaymentReference";
import { DAYS, getTestFile, toBN, toBNExp } from "../../../utils/helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { SourceId } from "../../../utils/verification/sources/sources";
import { assertWeb3DeepEqual, web3ResultStruct } from "../../../utils/web3assertions";
import { createTestSettings } from "../test-settings";

const AttestationClient = artifacts.require('AttestationClientSC');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const Whitelist = artifacts.require('Whitelist');
const StateConnector = artifacts.require('StateConnectorMock');

contract(`AssetManager.sol; ${getTestFile(__filename)}; Asset manager basic tests`, async accounts => {
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
    let whitelist: WhitelistInstance;
    
    // addresses
    const underlyingBurnAddr = "Burn";
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    const whitelistedAccount = accounts[1];


    beforeEach(async () => {
        // create state connector
        const stateConnector = await StateConnector.new();
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
        settings = createTestSettings(attestationClient, wnat, ftsoRegistry);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings);
    });

    describe("set and update settings", () => {
        it("should correctly set asset manager settings", async () => {
            const resFAsset = await assetManager.fAsset();
            assert.notEqual(resFAsset, constants.ZERO_ADDRESS);
            assert.equal(resFAsset, fAsset.address);
            const resSettings = web3ResultStruct(await assetManager.getSettings());
            settings.assetManagerController = assetManagerController;           // added to settings in newAssetManager
            settings.natFtsoIndex = await ftsoRegistry.getFtsoIndex(settings.natFtsoSymbol);        // set in contract
            settings.assetFtsoIndex = await ftsoRegistry.getFtsoIndex(settings.assetFtsoSymbol);    // set in contract
            assertWeb3DeepEqual(resSettings, settings);
            assert.equal(await assetManager.assetManagerController(), assetManagerController);
        });

        it("should update settings correctly", async () => {
            // act
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            newSettings.collateralReservationFeeBIPS = 150;
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("setCollateralReservationFeeBips(uint256)")), 
                web3.eth.abi.encodeParameters(['uint256'], [150]), 
                { from: assetManagerController });
            // assert
            const res = web3ResultStruct(await assetManager.getSettings());
            assertWeb3DeepEqual(newSettings, res);
        });

        it("should revert update settings - invalid method", async () => {
            let res = assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("invalidMethod")), 
            constants.ZERO_ADDRESS,
            { from: assetManagerController });
            await expectRevert(res,"update: invalid method");
        });
    });

    describe("whitelisting", () => {
        it("should require whitelisting, when whitelist exists, to create agent", async () => {
            whitelist = await Whitelist.new(governance);
            await whitelist.addAddressToWhitelist(whitelistedAccount, {from: governance});
                                
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("setWhitelist(address)")), 
                web3.eth.abi.encodeParameters(['address'], [whitelist.address]), 
                { from: assetManagerController });
            const timeIncrease = toBN(settings.timelockSeconds).addn(1);
            await time.increase(timeIncrease);
            chain.skipTime(timeIncrease.toNumber());
            await time.advanceBlock();
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("executeSetWhitelist()")), 
                constants.ZERO_ADDRESS,
                { from: assetManagerController });
            // assert
            await expectRevert(assetManager.createAgent(underlyingAgent1, { from: agentOwner1 }),
                "not whitelisted");

            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(whitelistedAccount));
            const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
            await assetManager.proveUnderlyingAddressEOA(proof, { from: whitelistedAccount });
            expectEvent(await assetManager.createAgent(underlyingAgent1, { from: whitelistedAccount}), "AgentCreated");
        });
    });

    describe("pause minting and terminate fasset", () => {
        it("should pause and terminate only after 30 days", async () => {
            const MINIMUM_PAUSE_BEFORE_STOP = 30 * DAYS;
            assert.isFalse(await assetManager.paused());
            await assetManager.pause({ from: assetManagerController });
            assert.isTrue(await assetManager.paused());
            await time.increase(MINIMUM_PAUSE_BEFORE_STOP / 2);
            await assetManager.pause({ from: assetManagerController });
            assert.isTrue(await assetManager.paused());
            await expectRevert(assetManager.terminate({ from: assetManagerController }), "asset manager not paused enough");
            await time.increase(MINIMUM_PAUSE_BEFORE_STOP / 2);
            assert.isFalse(await fAsset.terminated());
            await assetManager.terminate({ from: assetManagerController });
            assert.isTrue(await fAsset.terminated());
        });

        it("should not pause if not called from asset manager controller", async () => {
            const promise = assetManager.pause({ from: accounts[0] });
            await expectRevert(promise, "only asset manager controller");
            assert.isFalse(await assetManager.paused());
        });
    });

    describe("should update contracts", () => {
        it("should update contract addresses", async () => {
            let attestationClientNewAddress = accounts[21];
            let ftsoRegistryNewAddress = accounts[22];
            let wnatNewAddress = accounts[23];
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("updateContracts(address,IAttestationClient,IFtsoRegistry,IWNat)")), 
            web3.eth.abi.encodeParameters(['address', 'address', 'address', 'address'], [assetManagerController, attestationClientNewAddress, ftsoRegistryNewAddress, wnatNewAddress]), 
                { from: assetManagerController });
            const res = web3ResultStruct(await assetManager.getSettings());
            assert.notEqual(newSettings.attestationClient, res.attestationClient)
            assert.notEqual(newSettings.ftsoRegistry, res.ftsoRegistry)
            assert.notEqual(newSettings.wNat, res.wNat)
        });

        it("should not update contract addresses", async () => {
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("updateContracts(address,IAttestationClient,IFtsoRegistry,IWNat)")), 
            web3.eth.abi.encodeParameters(['address', 'address', 'address', 'address'], [assetManagerController, attestationClient.address, ftsoRegistry.address, wnat.address]), 
                { from: assetManagerController });
            const res = web3ResultStruct(await assetManager.getSettings());
            assertWeb3DeepEqual(res, newSettings)
        });
    });
});
