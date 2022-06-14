import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentVaultFactoryInstance, AssetManagerInstance, AttestationClientSCInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WhitelistInstance, WNatInstance } from "../../../../typechain-truffle";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../utils/fasset/AttestationHelper";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../../utils/fasset/PaymentReference";
import { DAYS, getTestFile, HOURS, toBN, toBNExp, toNumber } from "../../../utils/helpers";
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
const AgentVaultFactory = artifacts.require('AgentVaultFactory');

contract(`AssetManager.sol; ${getTestFile(__filename)}; Asset manager basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let agentVaultFactory: AgentVaultFactoryInstance;
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
        // create agent vault factory
        agentVaultFactory = await AgentVaultFactory.new();
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
            await expectRevert(assetManager.unpause({ from: assetManagerController }), "f-asset terminated");
        });

        it("should unpause if not yet terminated", async () => {
            await assetManager.pause({ from: assetManagerController });
            assert.isTrue(await assetManager.paused());
            await assetManager.unpause({ from: assetManagerController });
            assert.isFalse(await assetManager.paused());
        });

        it("should not pause if not called from asset manager controller", async () => {
            const promise = assetManager.pause({ from: accounts[0] });
            await expectRevert(promise, "only asset manager controller");
            assert.isFalse(await assetManager.paused());
        });

        it("should not unpause if not called from asset manager controller", async () => {
            await assetManager.pause({ from: assetManagerController });
            assert.isTrue(await assetManager.paused());
            const promise = assetManager.unpause({ from: accounts[0] });
            await expectRevert(promise, "only asset manager controller");
            assert.isTrue(await assetManager.paused());
        });

        it("should not terminate if not called from asset manager controller", async () => {
            const MINIMUM_PAUSE_BEFORE_STOP = 30 * DAYS;
            assert.isFalse(await assetManager.paused());
            await assetManager.pause({ from: assetManagerController });
            assert.isTrue(await assetManager.paused());
            await time.increase(MINIMUM_PAUSE_BEFORE_STOP);
            const promise = assetManager.terminate({ from: accounts[0] });
            await expectRevert(promise, "only asset manager controller");
            assert.isFalse(await fAsset.terminated());
        });
    });

    describe("should update contracts", () => {
        it("should update contract addresses", async () => {
            let agentVaultFactoryNewAddress = accounts[21];
            let attestationClientNewAddress = accounts[22];
            let ftsoRegistryNewAddress = accounts[23];
            let wnatNewAddress = accounts[24];
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("updateContracts(address,IAgentVaultFactory,IAttestationClient,IFtsoRegistry,IWNat)")), 
            web3.eth.abi.encodeParameters(['address', 'address', 'address', 'address', 'address'], [assetManagerController, agentVaultFactoryNewAddress, attestationClientNewAddress, ftsoRegistryNewAddress, wnatNewAddress]), 
                { from: assetManagerController });
            const res = web3ResultStruct(await assetManager.getSettings());
            assert.notEqual(newSettings.agentVaultFactory, res.agentVaultFactory)
            assert.notEqual(newSettings.attestationClient, res.attestationClient)
            assert.notEqual(newSettings.ftsoRegistry, res.ftsoRegistry)
            assert.notEqual(newSettings.wNat, res.wNat)
        });

        it("should not update contract addresses", async () => {
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("updateContracts(address,IAgentVaultFactory,IAttestationClient,IFtsoRegistry,IWNat)")), 
            web3.eth.abi.encodeParameters(['address', 'address', 'address', 'address', 'address'], [assetManagerController, agentVaultFactory.address, attestationClient.address, ftsoRegistry.address, wnat.address]), 
                { from: assetManagerController });
            const res = web3ResultStruct(await assetManager.getSettings());
            assertWeb3DeepEqual(res, newSettings)
        });
    });

    describe("should validate settings at creation", () => {
        it("should validate settings - cannot be zero", async () => {
            let newSettings0 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings0.collateralReservationFeeBIPS = 0;
            let res0 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings0);
            await expectRevert(res0, "cannot be zero");
            
            let newSettings1 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings1.assetUnitUBA = 0;
            let res1 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings1);
            await expectRevert(res1, "cannot be zero");

            let newSettings2 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings2.assetMintingGranularityUBA = 0;
            let res2 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings2);            
            await expectRevert(res2, "cannot be zero");

            let newSettings3 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings3.minCollateralRatioBIPS = 0;
            let res3 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings3);
            await expectRevert(res3, "cannot be zero");

            let newSettings4 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings4.ccbMinCollateralRatioBIPS = 0;
            let res4 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings4);
            await expectRevert(res4, "cannot be zero");

            let newSettings5 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings5.ccbMinCollateralRatioBIPS = 0;
            let res5 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings5);
            await expectRevert(res5, "cannot be zero");

            let newSettings6 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings6.underlyingBlocksForPayment = 0;
            let res6 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings6);
            await expectRevert(res6, "cannot be zero");

            let newSettings7 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings7.underlyingSecondsForPayment = 0;
            let res7 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings7);
            await expectRevert(res7, "cannot be zero");

            let newSettings8 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings8.redemptionFeeBIPS = 0;
            let res8 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings8);
            await expectRevert(res8, "cannot be zero");;

            let newSettings9 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings9.confirmationByOthersRewardNATWei = 0;
            let res9 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings9);
            await expectRevert(res9, "cannot be zero");

            let newSettings10 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings10.maxRedeemedTickets = 0;
            let res10 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings10);
            await expectRevert(res10, "cannot be zero");

            let newSettings11 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings11.ccbTimeSeconds = 0;
            let res11 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings11);
            await expectRevert(res11, "cannot be zero");

            let newSettings12 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings12.liquidationStepSeconds = 0;
            let res12 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings12);
            await expectRevert(res12, "cannot be zero");

            let newSettings13 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings13.maxTrustedPriceAgeSeconds = 0;
            let res13 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings13);
            await expectRevert(res13, "cannot be zero");

            let newSettings14 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings14.timelockSeconds = 0;
            let res14 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings14);
            await expectRevert(res14, "cannot be zero");

            let newSettings15 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings15.minUpdateRepeatTimeSeconds = 0;
            let res15 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings15);
            await expectRevert(res15, "cannot be zero");

            let newSettings16 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings16.buybackCollateralFactorBIPS = 0;
            let res16 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings16);
            await expectRevert(res16, "cannot be zero");

            let newSettings17 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings17.withdrawalWaitMinSeconds = 0;
            let res17 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings17);
            await expectRevert(res17, "cannot be zero");

            let newSettings19 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry)
            newSettings19.lotSizeAMG = 0;
            let res19 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings19);
            await expectRevert(res19, "cannot be zero");
        });

        it("should validate settings - other validators", async () => {
            let newSettings0 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);            
            newSettings0.collateralReservationFeeBIPS = 10001;
            let res0 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings0);
            await expectRevert(res0, "bips value too high");

            let newSettings1 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings1.redemptionFeeBIPS = 10001;
            let res1 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings1);
            await expectRevert(res1, "bips value too high");

            let newSettings2 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings2.redemptionDefaultFactorBIPS = 10000;
            let res2 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings2);
            await expectRevert(res2, "bips value too low");

            let newSettings3 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings3.attestationWindowSeconds = 0.9 * DAYS;
            let res3 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings3);
            await expectRevert(res3, "window too small");

            let newSettings4 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings4.confirmationByOthersAfterSeconds = 1.9 * HOURS;
            let res4 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings4);
            await expectRevert(res4, "must be at least two hours");

            let newSettings5 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings5.liquidationCollateralFactorBIPS = [];
            let res5 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings5);
            await expectRevert(res5, "at least one factor required");

            newSettings5.liquidationCollateralFactorBIPS = [12000, 11000];;
            let res6 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings5);
            await expectRevert(res6, "factors not increasing");

            let value = toNumber(newSettings5.safetyMinCollateralRatioBIPS) + 10000;
            newSettings5.liquidationCollateralFactorBIPS = [value];
            let res7 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings5);
            await expectRevert(res7, "liquidation factor too high");

            newSettings5.liquidationCollateralFactorBIPS = [1000];
            let res8 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings5);
            await expectRevert(res8, "factor not above 1");

            let newSettings6 = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
            newSettings6.minCollateralRatioBIPS = 1_8000;
            newSettings6.ccbMinCollateralRatioBIPS = 2_2000;
            newSettings6.safetyMinCollateralRatioBIPS = 2_4000;            
            let res9 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings6);
            await expectRevert(res9, "invalid collateral ratios");
        });
    });
});
