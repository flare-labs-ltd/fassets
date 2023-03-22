import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralToken } from "../../../../lib/fasset/AssetManagerTypes";
import { encodeLiquidationStrategyImplSettings } from "../../../../lib/fasset/LiquidationStrategyImpl";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { DAYS, HOURS, toBNExp, toNumber } from "../../../../lib/utils/helpers";
import { AssetManagerInstance, ERC20MockInstance, FAssetInstance, WNatInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { GENESIS_GOVERNANCE_ADDRESS } from "../../../utils/constants";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../../utils/test-helpers";
import { assertWeb3DeepEqual, web3ResultStruct } from "../../../utils/web3assertions";
import { createEncodedTestLiquidationSettings, createTestLiquidationSettings, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings, TestFtsos, TestSettingsContracts, createTestAgentSettings } from "../test-settings";

const Whitelist = artifacts.require('Whitelist');
const GovernanceSettings = artifacts.require('GovernanceSettings');

function createTestAgentSettings_(underlyingAgent: string, class1TokenAddress: string) {
    const settings = createTestAgentSettings(underlyingAgent, class1TokenAddress);
    settings.mintingClass1CollateralRatioBIPS = settings.mintingClass1CollateralRatioBIPS.toString();
    settings.mintingPoolCollateralRatioBIPS = settings.mintingPoolCollateralRatioBIPS.toString();
    settings.poolExitCollateralRatioBIPS = settings.poolExitCollateralRatioBIPS.toString();
    settings.buyFAssetByAgentFactorBIPS = settings.buyFAssetByAgentFactorBIPS.toString();
    settings.poolTopupCollateralRatioBIPS = settings.poolTopupCollateralRatioBIPS.toString();
    settings.poolTopupTokenPriceFactorBIPS = settings.poolTopupTokenPriceFactorBIPS.toString();
    settings.poolFeeShareBIPS = settings.poolFeeShareBIPS.toString();
    settings.feeBIPS = settings.feeBIPS.toString();
    return settings;
}

contract(`AssetManager.sol; ${getTestFile(__filename)}; Asset manager basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let contracts: TestSettingsContracts;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;
    let wNat: WNatInstance;
    let usdc: ERC20MockInstance;
    let ftsos: TestFtsos;
    let settings: AssetManagerSettings;
    let collaterals: CollateralToken[];
    let chain: MockChain;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;

    // addresses
    const underlyingBurnAddr = "Burn";
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    const whitelistedAccount = accounts[1];


    beforeEach(async () => {
        const ci = testChainInfo.eth;
        contracts = await createTestContracts(governance);
        // save some contracts as globals
        ({ wNat } = contracts);
        usdc = contracts.stablecoins.USDC;
        // create FTSOs for nat, stablecoins and asset and set some price
        ftsos = await createTestFtsos(contracts.ftsoRegistry, ci);
        // create mock chain and attestation provider
        chain = new MockChain(await time.latest());
        wallet = new MockChainWallet(chain);
        stateConnectorClient = new MockStateConnectorClient(contracts.stateConnector, { [ci.chainId]: chain }, 'auto');
        attestationProvider = new AttestationHelper(stateConnectorClient, chain, ci.chainId);
        // create asset manager
        collaterals = createTestCollaterals(contracts);
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true });
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, createEncodedTestLiquidationSettings());
    });

    describe("set and update settings", () => {
        it("should correctly set asset manager settings", async () => {
            const resFAsset = await assetManager.fAsset();
            assert.notEqual(resFAsset, constants.ZERO_ADDRESS);
            assert.equal(resFAsset, fAsset.address);
            const resSettings = web3ResultStruct(await assetManager.getSettings());
            settings.fAsset = fAsset.address;
            settings.assetManagerController = assetManagerController;
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
            // create governance settings
            const governanceSettings = await GovernanceSettings.new();
            await governanceSettings.initialise(governance, 60, [governance], { from: GENESIS_GOVERNANCE_ADDRESS });
            // create whitelist
            const whitelist = await Whitelist.new(governanceSettings.address, governance, false);
            await whitelist.switchToProductionMode({ from: governance });
            await whitelist.addAddressToWhitelist(whitelistedAccount, { from: governance });
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("setAgentWhitelist(address)")),
                web3.eth.abi.encodeParameters(['address'], [whitelist.address]),
                { from: assetManagerController });
            // assert
            const settings = createTestAgentSettings_(underlyingAgent1, usdc.address);
            await expectRevert(assetManager.createAgent(settings, { from: agentOwner1 }),
                "not whitelisted");
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(whitelistedAccount));
            const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
            await assetManager.proveUnderlyingAddressEOA(proof, { from: whitelistedAccount });
            expectEvent(await assetManager.createAgent(settings, { from: whitelistedAccount}), "AgentCreated");
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
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("updateContracts(address,IAttestationClient,IFtsoRegistry)")),
                web3.eth.abi.encodeParameters(['address', 'address', 'address'], [assetManagerController, attestationClientNewAddress, ftsoRegistryNewAddress]),
                { from: assetManagerController });
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("setAgentVaultFactory(address)")),
                web3.eth.abi.encodeParameters(['address'], [agentVaultFactoryNewAddress]), { from: assetManagerController });
            const res = web3ResultStruct(await assetManager.getSettings());
            assert.notEqual(newSettings.agentVaultFactory, res.agentVaultFactory)
            assert.notEqual(newSettings.attestationClient, res.attestationClient)
            assert.notEqual(newSettings.ftsoRegistry, res.ftsoRegistry)
        });

        it("should not update contract addresses", async () => {
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("updateContracts(address,IAttestationClient,IFtsoRegistry)")),
            web3.eth.abi.encodeParameters(['address', 'address', 'address'], [assetManagerController, contracts.attestationClient.address, contracts.ftsoRegistry.address]),
                { from: assetManagerController });
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("setAgentVaultFactory(address)")),
                web3.eth.abi.encodeParameters(['address'], [contracts.agentVaultFactory.address]), { from: assetManagerController });
            const res = web3ResultStruct(await assetManager.getSettings());
            assertWeb3DeepEqual(res, newSettings)
        });
    });

    describe("should validate settings at creation", () => {
        it("should validate settings - cannot be zero", async () => {
            const liquidationSettings = createEncodedTestLiquidationSettings();

            let newSettings0 = createTestSettings(contracts, testChainInfo.eth);
            newSettings0.collateralReservationFeeBIPS = 0;
            let res0 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings0, collaterals, liquidationSettings);
            await expectRevert(res0, "cannot be zero");

            let newSettings1 = createTestSettings(contracts, testChainInfo.eth);
            newSettings1.assetUnitUBA = 0;
            let res1 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings1, collaterals, liquidationSettings);
            await expectRevert(res1, "cannot be zero");

            let newSettings2 = createTestSettings(contracts, testChainInfo.eth);
            newSettings2.assetMintingGranularityUBA = 0;
            let res2 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings2, collaterals, liquidationSettings);
            await expectRevert(res2, "cannot be zero");

            let collaterals3 = createTestCollaterals(contracts);
            collaterals3[0].minCollateralRatioBIPS = 0;
            collaterals3[0].ccbMinCollateralRatioBIPS = 0;
            collaterals3[0].safetyMinCollateralRatioBIPS = 0;
            await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings, collaterals3, liquidationSettings);
            // await expectRevert(res3, "cannot be zero");

            let newSettings6 = createTestSettings(contracts, testChainInfo.eth);
            newSettings6.underlyingBlocksForPayment = 0;
            let res6 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings6, collaterals, liquidationSettings);
            await expectRevert(res6, "cannot be zero");

            let newSettings7 = createTestSettings(contracts, testChainInfo.eth);
            newSettings7.underlyingSecondsForPayment = 0;
            let res7 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings7, collaterals, liquidationSettings);
            await expectRevert(res7, "cannot be zero");

            let newSettings8 = createTestSettings(contracts, testChainInfo.eth);
            newSettings8.redemptionFeeBIPS = 0;
            let res8 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings8, collaterals, liquidationSettings);
            await expectRevert(res8, "cannot be zero");;

            let newSettings10 = createTestSettings(contracts, testChainInfo.eth);
            newSettings10.maxRedeemedTickets = 0;
            let res10 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings10, collaterals, liquidationSettings);
            await expectRevert(res10, "cannot be zero");

            let newSettings11 = createTestSettings(contracts, testChainInfo.eth);
            newSettings11.ccbTimeSeconds = 0;
            let res11 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings11, collaterals, liquidationSettings);
            await expectRevert(res11, "cannot be zero");

            let newSettings12 = createTestSettings(contracts, testChainInfo.eth);
            let liquidationSettings12 = createTestLiquidationSettings();
            liquidationSettings12.liquidationStepSeconds = 0;
            let res12 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings12, collaterals, encodeLiquidationStrategyImplSettings(liquidationSettings12));
            await expectRevert(res12, "cannot be zero");

            let newSettings13 = createTestSettings(contracts, testChainInfo.eth);
            newSettings13.maxTrustedPriceAgeSeconds = 0;
            let res13 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings13, collaterals, liquidationSettings);
            await expectRevert(res13, "cannot be zero");

            let newSettings15 = createTestSettings(contracts, testChainInfo.eth);
            newSettings15.minUpdateRepeatTimeSeconds = 0;
            let res15 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings15, collaterals, liquidationSettings);
            await expectRevert(res15, "cannot be zero");

            let newSettings16 = createTestSettings(contracts, testChainInfo.eth);
            newSettings16.buybackCollateralFactorBIPS = 0;
            let res16 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings16, collaterals, liquidationSettings);
            await expectRevert(res16, "cannot be zero");

            let newSettings17 = createTestSettings(contracts, testChainInfo.eth);
            newSettings17.withdrawalWaitMinSeconds = 0;
            let res17 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings17, collaterals, liquidationSettings);
            await expectRevert(res17, "cannot be zero");

            let newSettings19 = createTestSettings(contracts, testChainInfo.eth)
            newSettings19.lotSizeAMG = 0;
            let res19 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings19, collaterals, liquidationSettings);
            await expectRevert(res19, "cannot be zero");

            let newSettings20 = createTestSettings(contracts, testChainInfo.eth)
            newSettings20.announcedUnderlyingConfirmationMinSeconds = 2 * HOURS;
            let res20 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings20, collaterals, liquidationSettings);
            await expectRevert(res20, "confirmation time too big");
        });

        it("should validate settings - other validators", async () => {
            const liquidationSettings = createEncodedTestLiquidationSettings();

            let newSettings0 = createTestSettings(contracts, testChainInfo.eth);
            newSettings0.collateralReservationFeeBIPS = 10001;
            let res0 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings0, collaterals, liquidationSettings);
            await expectRevert(res0, "bips value too high");

            let newSettings1 = createTestSettings(contracts, testChainInfo.eth);
            newSettings1.redemptionFeeBIPS = 10001;
            let res1 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings1, collaterals, liquidationSettings);
            await expectRevert(res1, "bips value too high");

            let newSettings2 = createTestSettings(contracts, testChainInfo.eth);
            newSettings2.redemptionDefaultFactorAgentC1BIPS = 5000;
            newSettings2.redemptionDefaultFactorPoolBIPS = 5000;
            let res2 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings2, collaterals, liquidationSettings);
            await expectRevert(res2, "bips value too low");

            let newSettings3 = createTestSettings(contracts, testChainInfo.eth);
            newSettings3.attestationWindowSeconds = 0.9 * DAYS;
            let res3 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings3, collaterals, liquidationSettings);
            await expectRevert(res3, "window too small");

            let newSettings4 = createTestSettings(contracts, testChainInfo.eth);
            newSettings4.confirmationByOthersAfterSeconds = 1.9 * HOURS;
            let res4 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, newSettings4, collaterals, liquidationSettings);
            await expectRevert(res4, "must be at least two hours");

            let liquidationSettings5 = createTestLiquidationSettings();
            liquidationSettings5.liquidationCollateralFactorBIPS = [];
            liquidationSettings5.liquidationFactorClass1BIPS = [];
            let res5 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings, collaterals, encodeLiquidationStrategyImplSettings(liquidationSettings5));
            await expectRevert(res5, "at least one factor required");

            let liquidationSettings6 = createTestLiquidationSettings();
            liquidationSettings6.liquidationCollateralFactorBIPS = [12000, 11000];
            liquidationSettings6.liquidationFactorClass1BIPS = [12000, 11000];
            let res6 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings, collaterals, encodeLiquidationStrategyImplSettings(liquidationSettings6));
            await expectRevert(res6, "factors not increasing");

            let liquidationSettings7 = createTestLiquidationSettings();
            liquidationSettings7.liquidationCollateralFactorBIPS = [12000];
            liquidationSettings7.liquidationFactorClass1BIPS = [12001];
            let res7 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings, collaterals, encodeLiquidationStrategyImplSettings(liquidationSettings7));
            await expectRevert(res7, "class1 factor higher than total");

            let liquidationSettings8 = createTestLiquidationSettings();
            liquidationSettings8.liquidationCollateralFactorBIPS = [1000];
            liquidationSettings8.liquidationFactorClass1BIPS = [1000];
            let res8 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings, collaterals, encodeLiquidationStrategyImplSettings(liquidationSettings8));
            await expectRevert(res8, "factor not above 1");

            let collaterals6 = createTestCollaterals(contracts);
            collaterals6[0].minCollateralRatioBIPS = 1_8000;
            collaterals6[0].ccbMinCollateralRatioBIPS = 2_2000;
            collaterals6[0].safetyMinCollateralRatioBIPS = 2_4000;
            let res9 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings, collaterals6, liquidationSettings);
            await expectRevert(res9, "invalid collateral ratios");
        });
    });
});
