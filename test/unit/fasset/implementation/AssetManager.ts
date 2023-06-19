import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralType } from "../../../../lib/fasset/AssetManagerTypes";
import { decodeLiquidationStrategyImplSettings, encodeLiquidationStrategyImplSettings } from "../../../../lib/fasset/LiquidationStrategyImpl";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { findRequiredEvent } from "../../../../lib/utils/events/truffle";
import { BNish, DAYS, HOURS, MAX_BIPS, erc165InterfaceId, toBIPS, toBN, toBNExp, toWei } from "../../../../lib/utils/helpers";
import { web3DeepNormalize } from "../../../../lib/utils/web3normalize";
import { AgentVaultInstance, AssetManagerInstance, ERC20MockInstance, FAssetInstance, FtsoMockInstance, IERC165Contract, WNatInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { GENESIS_GOVERNANCE_ADDRESS } from "../../../utils/constants";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import {
    TestFtsos, TestSettingsContracts, createEncodedTestLiquidationSettings, createTestAgentSettings, createTestCollaterals, createTestContracts,
    createTestFtsos, createTestLiquidationSettings, createTestSettings
} from "../../../utils/test-settings";
import { assertWeb3DeepEqual, assertWeb3Equal, web3ResultStruct } from "../../../utils/web3assertions";

const Whitelist = artifacts.require('Whitelist');
const GovernanceSettings = artifacts.require('GovernanceSettings');
const AgentVault = artifacts.require('AgentVault');
const CollateralPool = artifacts.require('CollateralPool');
const CollateralPoolToken = artifacts.require('CollateralPoolToken');
const ERC20Mock = artifacts.require('ERC20Mock');

const mulBIPS = (x: BN, y: BN) => x.mul(y).div(toBN(MAX_BIPS));
const divBIPS = (x: BN, y: BN) => x.mul(toBN(MAX_BIPS)).div(y);

function assertEqualWithNumError(x: BN, y: BN, err: BN) {
    assert.isTrue(x.sub(y).abs().lte(err), `Expected ${x} to be within ${err} of ${y}`);
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
    let collaterals: CollateralType[];
    let chain: MockChain;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;

    // addresses
    const underlyingBurnAddr = "Burn";
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    const whitelistedAccount = accounts[1];

    function lotsToUBA(lots: BNish): BN {
        return toBN(lots)
            .mul(toBN(settings.lotSizeAMG))
            .mul(toBN(settings.assetUnitUBA))
            .div(toBN(settings.assetMintingGranularityUBA));
    }

    async function getCollateralPoolToken(agentVault: string) {
        const pool = await CollateralPool.at(await assetManager.getCollateralPool(agentVault));
        return CollateralPoolToken.at(await pool.token());
    }

    // price of ftso-asset in uba/wei/base units
    async function ubaToUSDWei(uba: BN, ftso: FtsoMockInstance) {
        const { 0: assetPrice, 2: decimals } = await ftso.getCurrentPriceWithDecimals();
        return uba.mul(assetPrice).div(toBN(10**decimals.toNumber()));
    }
    async function ubaToC1Wei(uba: BN) {
        const { 0: assetPrice } = await ftsos.asset.getCurrentPrice();
        const { 0: usdcPrice } = await ftsos.usdc.getCurrentPrice();
        return uba.mul(assetPrice).div(usdcPrice);
    }
    async function ubaToPoolWei(uba: BN) {
        const { 0: assetPriceMul, 1: assetPriceDiv } = await assetManager.assetPriceNatWei();
        return uba.mul(assetPriceMul).div(assetPriceDiv);
    }
    async function usd5ToClass1Wei(usd5: BN) {
        const { 0: usdcPrice, 2: usdcDecimals } = await ftsos.usdc.getCurrentPriceWithDecimals();
        return usd5.mul(toWei(10**usdcDecimals.toNumber())).div(usdcPrice);
    }

    async function depositUnderlyingAsset(agentVault: AgentVaultInstance, owner: string, underlyingAgent: string, amount: BN) {
        chain.mint("random_address", amount);
        const txHash = await wallet.addTransaction("random_address", underlyingAgent, amount, PaymentReference.topup(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, "random_address", underlyingAgent);
        await assetManager.confirmTopupPayment(proof, agentVault.address, { from: owner });
        return proof;
    }

    async function depositAgentCollaterals(
        agentVault: AgentVaultInstance, owner: string,
        depositClass1: BN = toWei(3e8), depositPool: BN = toWei(3e8)
    ) {
        await usdc.mintAmount(owner, depositClass1);
        await usdc.approve(agentVault.address, depositClass1, { from: owner });
        await agentVault.depositCollateral(usdc.address, depositClass1, { from: owner });
        await agentVault.buyCollateralPoolTokens({ from: owner, value: depositPool });
    }

    async function createAgentWithEOA(owner: string, underlyingAddress: string): Promise<AgentVaultInstance> {
        chain.mint(underlyingAddress, toBNExp(100, 18));
        const txHash = await wallet.addTransaction(underlyingAddress, underlyingBurnAddr, 1, PaymentReference.addressOwnership(owner));
        const proof = await attestationProvider.provePayment(txHash, underlyingAddress, underlyingBurnAddr);
        await assetManager.proveUnderlyingAddressEOA(proof, { from: owner });
        const settings = createTestAgentSettings(underlyingAddress, usdc.address);
        const response = await assetManager.createAgent(web3DeepNormalize(settings), { from: owner });
        return AgentVault.at(findRequiredEvent(response, 'AgentCreated').args.agentVault);
    }

    async function createAvailableAgentWithEOA(
        owner: string, underlyingAddress: string,
        depositClass1: BN = toWei(3e8), depositPool: BN = toWei(3e8)
    ): Promise<AgentVaultInstance> {
        const agentVault = await createAgentWithEOA(owner, underlyingAddress);
        await depositAgentCollaterals(agentVault, owner, depositClass1, depositPool);
        await assetManager.makeAgentAvailable(agentVault.address, { from: owner });
        return agentVault;
    }

    // self-mints through an agent and then sends f-assets to the minter
    async function mintFassets(agentVault: AgentVaultInstance, owner: string, underlyingAgent: string, minter: string, lots: BN) {
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const amountUBA = lotsToUBA(lots);
        const feeUBA = mulBIPS(amountUBA, toBN(agentInfo.feeBIPS));
        const poolFeeShareUBA = mulBIPS(feeUBA, toBN(agentInfo.poolFeeShareBIPS));
        const agentFeeShareUBA = feeUBA.sub(poolFeeShareUBA);
        const paymentAmountUBA = amountUBA.add(feeUBA);
        // make and prove payment transaction
        chain.mint("random_address", paymentAmountUBA);
        const txHash = await wallet.addTransaction("random_address", underlyingAgent, paymentAmountUBA,
            PaymentReference.selfMint(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, "random_address", underlyingAgent);
        // self-mint and send f-assets to minter
        await assetManager.selfMint(proof, agentVault.address, lots, { from: owner });
        if (minter != owner) await fAsset.transfer(minter, amountUBA, { from: owner });
        return { underlyingPaymentUBA: paymentAmountUBA, underlyingTxHash: txHash, poolFeeShareUBA, agentFeeShareUBA }
    }

    function skipToProofUnavailability(lastUnderlyingBlock: BNish, lastUnderlyingTimestamp: BNish) {
        chain.skipTimeTo(Number(lastUnderlyingTimestamp));
        chain.mine(Number(lastUnderlyingBlock) - chain.blockHeight() + 1);
        chain.skipTime(stateConnectorClient.queryWindowSeconds + 1);
        chain.mine(chain.finalizationBlocks);
    }

    async function initialize() {
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
        collaterals = createTestCollaterals(contracts, ci);
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true, announcedUnderlyingConfirmationMinSeconds: 10 });
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, createEncodedTestLiquidationSettings());
        return { contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset };
    }

    beforeEach(async () => {
        ({ contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset } = await loadFixtureCopyVars(initialize));
    });

    describe("set and update settings / properties", () => {

        it("should correctly remove asset manager controller", async () => {
            const isAttachedBefore = await assetManager.controllerAttached();
            assert.equal(isAttachedBefore, true);
            await assetManager.attachController(false, { from: assetManagerController });
            const isAttachedAfter = await assetManager.controllerAttached();
            assert.equal(isAttachedAfter, false);
        });

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

        it("should correctly update liquidation strategy settings", async () => {
            const liquidationSettings = decodeLiquidationStrategyImplSettings(await assetManager.getLiquidationSettings());
            assertWeb3DeepEqual(liquidationSettings, createTestLiquidationSettings());
            liquidationSettings.liquidationStepSeconds = 100;
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("updateLiquidationStrategySettings(bytes)")),
                encodeLiquidationStrategyImplSettings(liquidationSettings),
                { from: assetManagerController });
            const newLiquidationSettings = decodeLiquidationStrategyImplSettings(await assetManager.getLiquidationSettings());
            assertWeb3DeepEqual(newLiquidationSettings, liquidationSettings);
        });
    });

    describe("update agent settings", () => {

        it("should set owner hot address", async () => {
            // create agent
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            // set owner hot address
            await assetManager.setOwnerHotAddress("0xe34BDff68a5b89216D7f6021c1AB25c012142425", { from: agentOwner1 });
            const OwnerColdAndHotAddresses = await assetManager.getAgentVaultOwner(agentVault.address);
            assert.equal(OwnerColdAndHotAddresses[0], agentOwner1);
            assert.equal(OwnerColdAndHotAddresses[1], "0xe34BDff68a5b89216D7f6021c1AB25c012142425");
        });

        it("should fail at announcing agent setting update from non-agent-owner account", async () => {
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            await expectRevert(assetManager.announceAgentSettingUpdate(agentVault.address, "feeBIPS", 2000, { from: accounts[80] }),
                "only agent vault owner");
        });

        it("should fail at changing announced agent settings from non-agent-owner account", async () => {
            const agentFeeChangeTimelock = (await assetManager.getSettings()).agentFeeChangeTimelockSeconds;
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            await assetManager.announceAgentSettingUpdate(agentVault.address, "feeBIPS", 2000, { from: agentOwner1 });
            await time.increase(agentFeeChangeTimelock);
            await expectRevert(assetManager.executeAgentSettingUpdate(agentVault.address, "feeBIPS", { from: accounts[80] }),
                "only agent vault owner");
        });

        it("should correctly update agent settings fee BIPS", async () => {
            const agentFeeChangeTimelock = (await assetManager.getSettings()).agentFeeChangeTimelockSeconds;
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            await assetManager.announceAgentSettingUpdate(agentVault.address, "feeBIPS", 2000, { from: agentOwner1 });
            await time.increase(agentFeeChangeTimelock);
            await assetManager.executeAgentSettingUpdate(agentVault.address, "feeBIPS", { from: agentOwner1 });
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assert.equal(agentInfo.feeBIPS.toString(), "2000");
        });

        it("should correctly update agent setting pool fee share BIPS", async () => {
            const agentFeeChangeTimelock = (await assetManager.getSettings()).agentFeeChangeTimelockSeconds;
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            await assetManager.announceAgentSettingUpdate(agentVault.address, "poolFeeShareBIPS", 2000, { from: agentOwner1 });
            await time.increase(agentFeeChangeTimelock);
            await assetManager.executeAgentSettingUpdate(agentVault.address, "poolFeeShareBIPS", { from: agentOwner1 });
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assert.equal(agentInfo.poolFeeShareBIPS.toString(), "2000");
        });

        it("should correctly update agent setting minting Class1 collateral ratio BIPS", async () => {
            const agentCollateralRatioChangeTimelock = (await assetManager.getSettings()).agentCollateralRatioChangeTimelockSeconds;
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            await assetManager.announceAgentSettingUpdate(agentVault.address, "mintingClass1CollateralRatioBIPS", 25000, { from: agentOwner1 });
            await time.increase(agentCollateralRatioChangeTimelock);
            await assetManager.executeAgentSettingUpdate(agentVault.address, "mintingClass1CollateralRatioBIPS", { from: agentOwner1 });
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            console.log(agentInfo.mintingClass1CollateralRatioBIPS.toString());
            assert.equal(agentInfo.mintingClass1CollateralRatioBIPS.toString(), "25000");
        });

        it("should correctly update agent setting minting pool collateral ratio BIPS", async () => {
            const agentCollateralRatioChangeTimelock = (await assetManager.getSettings()).agentCollateralRatioChangeTimelockSeconds;
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            await assetManager.announceAgentSettingUpdate(agentVault.address, "mintingPoolCollateralRatioBIPS", 25000, { from: agentOwner1 });
            await time.increase(agentCollateralRatioChangeTimelock);
            await assetManager.executeAgentSettingUpdate(agentVault.address, "mintingPoolCollateralRatioBIPS", { from: agentOwner1 });
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assert.equal(agentInfo.mintingPoolCollateralRatioBIPS.toString(), "25000");
        });

        it("should correctly update agent setting buy fasset by agent factor BIPS", async () => {
            const agentBuyFactorChangeTimelock = (await assetManager.getSettings()).agentFeeChangeTimelockSeconds;
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            await assetManager.announceAgentSettingUpdate(agentVault.address, "buyFAssetByAgentFactorBIPS", 25000, { from: agentOwner1 });
            await time.increase(agentBuyFactorChangeTimelock);
            await assetManager.executeAgentSettingUpdate(agentVault.address, "buyFAssetByAgentFactorBIPS", { from: agentOwner1 });
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assert.equal(agentInfo.buyFAssetByAgentFactorBIPS.toString(), "25000");
        });

        it("should correctly update agent setting pool exit collateral ratio BIPS", async () => {
            const agentPoolExitCRChangeTimelock = (await assetManager.getSettings()).agentCollateralRatioChangeTimelockSeconds;
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            await assetManager.announceAgentSettingUpdate(agentVault.address, "poolExitCollateralRatioBIPS", 25000, { from: agentOwner1 });
            await time.increase(agentPoolExitCRChangeTimelock);
            await assetManager.executeAgentSettingUpdate(agentVault.address, "poolExitCollateralRatioBIPS", { from: agentOwner1 });
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assert.equal(agentInfo.poolExitCollateralRatioBIPS.toString(), "25000");
        });

        it("should correctly update agent setting pool exit collateral ratio BIPS", async () => {
            const agentPoolTopupCRChangeTimelock = (await assetManager.getSettings()).agentCollateralRatioChangeTimelockSeconds;
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            await assetManager.announceAgentSettingUpdate(agentVault.address, "poolTopupCollateralRatioBIPS", 25000, { from: agentOwner1 });
            await time.increase(agentPoolTopupCRChangeTimelock);
            await assetManager.executeAgentSettingUpdate(agentVault.address, "poolTopupCollateralRatioBIPS", { from: agentOwner1 });
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assert.equal(agentInfo.poolTopupCollateralRatioBIPS.toString(), "25000");
        });

        it("should correctly update agent setting pool topup token price factor BIPS", async () => {
            const agentPoolTopupPriceFactorChangeTimelock = (await assetManager.getSettings()).agentCollateralRatioChangeTimelockSeconds;
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            await assetManager.announceAgentSettingUpdate(agentVault.address, "poolTopupTokenPriceFactorBIPS", 9000, { from: agentOwner1 });
            await time.increase(agentPoolTopupPriceFactorChangeTimelock);
            await assetManager.executeAgentSettingUpdate(agentVault.address, "poolTopupTokenPriceFactorBIPS", { from: agentOwner1 });
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assert.equal(agentInfo.poolTopupTokenPriceFactorBIPS.toString(), "9000");
        });
    });

    describe("collateral tokens", () => {

        it("should correctly add collateral token", async () => {
            const collateral = JSON.parse(JSON.stringify(web3DeepNormalize(collaterals[1]))); // make a deep copy
            collateral.token = (await ERC20Mock.new("New Token", "NT")).address;
            collateral.tokenFtsoSymbol = "NT";
            collateral.assetFtsoSymbol = "NT";
            await assetManager.addCollateralType(web3DeepNormalize(collateral), { from: assetManagerController });
            const resCollaterals = await assetManager.getCollateralTypes();
            assertWeb3DeepEqual(collateral.token, resCollaterals[3].token);
        });

        it("should set collateral ratios for token", async () => {
            await assetManager.setCollateralRatiosForToken(collaterals[0].collateralClass, collaterals[0].token,
                toBIPS(1.5), toBIPS(1.4), toBIPS(1.6), { from: assetManagerController });
            const collateralType = await assetManager.getCollateralType(collaterals[0].collateralClass, collaterals[0].token);
            assertWeb3Equal(collateralType.minCollateralRatioBIPS, toBIPS(1.5));
            assertWeb3Equal(collateralType.ccbMinCollateralRatioBIPS, toBIPS(1.4));
            assertWeb3Equal(collateralType.safetyMinCollateralRatioBIPS, toBIPS(1.6));
        });

        it("should deprecate collateral token", async () => {
            const tx = await assetManager.deprecateCollateralType(collaterals[0].collateralClass, collaterals[0].token,
                settings.tokenInvalidationTimeMinSeconds, { from: assetManagerController });
            expectEvent(tx, "CollateralTypeDeprecated");
            const collateralType = await assetManager.getCollateralType(collaterals[0].collateralClass, collaterals[0].token);
            assertWeb3Equal(collateralType.validUntil, (await time.latest()).add(toBN(settings.tokenInvalidationTimeMinSeconds)));
        });

        it("should switch class1 collateral token", async () => {
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            //deprecate token
            const tx = await assetManager.deprecateCollateralType(collaterals[1].collateralClass, collaterals[1].token,
                settings.tokenInvalidationTimeMinSeconds, { from: assetManagerController });
            expectEvent(tx, "CollateralTypeDeprecated");
            const collateralType = await assetManager.getCollateralType(collaterals[1].collateralClass, collaterals[1].token);
            assertWeb3Equal(collateralType.validUntil, (await time.latest()).add(toBN(settings.tokenInvalidationTimeMinSeconds)));
            //Wait until you can swtich class1 token
            await time.increase(settings.tokenInvalidationTimeMinSeconds);
            //switch class1 token
            const tx1 = await assetManager.switchClass1Collateral(agentVault.address,collaterals[2].token, { from: agentOwner1 });
            expectEvent(tx1, "AgentCollateralTypeChanged");
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assert.equal(agentInfo.class1CollateralToken, collaterals[2].token);
        });

        it("should set pool collateral token", async () => {
            const newWnat = await ERC20Mock.new("Wrapped NAT", "WNAT");
            const tokenInfo = collaterals[0];
            tokenInfo.token = newWnat.address;
            tokenInfo.assetFtsoSymbol = "WNAT";
            await assetManager.setPoolWNatCollateralType(web3DeepNormalize(tokenInfo), { from: assetManagerController });
            const token = await assetManager.getCollateralType(tokenInfo.collateralClass, tokenInfo.token);
            assertWeb3Equal(token.token, newWnat.address);
        });

        it("should set pool collateral token and upgrade wnat", async () => {
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            const newWnat = await ERC20Mock.new("Wrapped NAT", "WNAT");
            const tokenInfo = collaterals[0];
            tokenInfo.token = newWnat.address;
            tokenInfo.assetFtsoSymbol = "WNAT";
            await assetManager.setPoolWNatCollateralType(web3DeepNormalize(tokenInfo), { from: assetManagerController });
            const res = assetManager.upgradeWNatContract(agentVault.address, {from: agentOwner1});
            expectEvent(await res, "AgentCollateralTypeChanged");
            const token = await assetManager.getCollateralType(tokenInfo.collateralClass, tokenInfo.token);
            assertWeb3Equal(token.token, newWnat.address);
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
            const settings = createTestAgentSettings(underlyingAgent1, usdc.address);
            await expectRevert(assetManager.createAgent(web3DeepNormalize(settings), { from: agentOwner1 }),
                "not whitelisted");
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(whitelistedAccount));
            const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
            await assetManager.proveUnderlyingAddressEOA(proof, { from: whitelistedAccount });
            expectEvent(await assetManager.createAgent(web3DeepNormalize(settings), { from: whitelistedAccount}), "AgentCreated");
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

        it("should buy back agent collateral", async () => {
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1, toWei(3e8));
            await mintFassets(agentVault, agentOwner1, underlyingAgent1, accounts[83], toBN(1));
            // terminate f-asset
            const MINIMUM_PAUSE_BEFORE_STOP = 30 * DAYS;
            await assetManager.pause({ from: assetManagerController });
            await time.increase(MINIMUM_PAUSE_BEFORE_STOP);
            await assetManager.terminate({ from: assetManagerController });
            // buy back the collateral
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            const mintedUSD = await ubaToC1Wei(toBN(agentInfo.mintedUBA));
            await assetManager.buybackAgentCollateral(agentVault.address, { from: agentOwner1, value: toWei(3e6) });
            const buybackPriceUSD = mulBIPS(mintedUSD, toBN(settings.buybackCollateralFactorBIPS));
            assertEqualWithNumError(await usdc.balanceOf(agentOwner1), buybackPriceUSD, toBN(1));
        });
    });

    describe("should update contracts", () => {
        it("should update contract addresses", async () => {
            let agentVaultFactoryNewAddress = accounts[21];
            let attestationClientNewAddress = accounts[22];
            let ftsoRegistryNewAddress = accounts[23];
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("updateContracts(address,address,address)")),
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
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("updateContracts(address,address,address)")),
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

            let collaterals3 = createTestCollaterals(contracts, testChainInfo.eth);
            collaterals3[0].minCollateralRatioBIPS = 0;
            let res3 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings, collaterals3, liquidationSettings);
            await expectRevert(res3, "invalid collateral ratios");

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

            let collaterals6 = createTestCollaterals(contracts, testChainInfo.eth);
            collaterals6[0].minCollateralRatioBIPS = 1_8000;
            collaterals6[0].ccbMinCollateralRatioBIPS = 2_2000;
            collaterals6[0].safetyMinCollateralRatioBIPS = 2_4000;
            let res9 = newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings, collaterals6, liquidationSettings);
            await expectRevert(res9, "invalid collateral ratios");
        });
    });

    describe("agent collateral deposit and withdrawal", () => {

        it("should announce class1 collateral withdrawal and execute it", async () => {
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            // deposit collateral
            await usdc.mintAmount(agentOwner1, 10000);
            await usdc.approve(agentVault.address, 10000, { from: agentOwner1 });
            await agentVault.depositCollateral(usdc.address, 10000, { from: agentOwner1 });
            const _agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(_agentInfo.totalClass1CollateralWei, 10000);
            // announce withdrawal and execute it
            await assetManager.announceClass1CollateralWithdrawal(agentVault.address, 1000, { from: agentOwner1 });
            const agentWithdrawalTimelock = (await assetManager.getSettings()).withdrawalWaitMinSeconds;
            await time.increase(agentWithdrawalTimelock);
            await agentVault.withdrawCollateral(usdc.address, 1000, accounts[80], { from: agentOwner1 });
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(agentInfo.totalClass1CollateralWei, 9000);
        });

        it("should announce pool redemption (class2 withdrawal) and execute it", async () => {
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            // deposit pool tokens to agent vault (there is a min-limit on nat deposited to collateral pool)
            await agentVault.buyCollateralPoolTokens({ from: agentOwner1, value: toWei(10) });
            const _agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(_agentInfo.totalAgentPoolTokensWei, toWei(10));
            // announce withdrawal and execute it (nat to pool token ratio is 1:1 as there are no minted f-assets)
            await assetManager.announceAgentPoolTokenRedemption(agentVault.address, toWei(1), { from: agentOwner1 });
            const agentWithdrawalTimelock = (await assetManager.getSettings()).withdrawalWaitMinSeconds;
            await time.increase(agentWithdrawalTimelock);
            const natRecipient = "0xe34BDff68a5b89216D7f6021c1AB25c012142425"
            await agentVault.redeemCollateralPoolTokens(toWei(1), natRecipient, { from: agentOwner1 });
            // check pool tokens were withdrawn
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3DeepEqual(agentInfo.totalAgentPoolTokensWei, toWei(9));
            const token = await getCollateralPoolToken(agentVault.address);
            assertWeb3DeepEqual(await token.balanceOf(agentVault.address), toWei(9));
            assertWeb3Equal(await web3.eth.getBalance(natRecipient), toWei(1));
        });
    });

    describe("agent availability", () => {
        it("should make an agent available and then unavailable", async () => {
            // create an available agent
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            // check if agent available in three ways
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);7
            assert.equal(agentInfo.publiclyAvailable, true);
            const availableAgentList = await assetManager.getAvailableAgentsList(0, 10);
            assert.equal(availableAgentList[0].length, 1);
            assert.equal(availableAgentList[0][0], agentVault.address);
            const availableAgentDetailedList = await assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(availableAgentDetailedList[0].length, 1);
            assert.equal(availableAgentDetailedList[0][0].agentVault, agentVault.address);
            // announce and make agent unavailable
            await assetManager.announceExitAvailableAgentList(agentVault.address, { from: agentOwner1 });
            // make agent unavailable
            await time.increase((await assetManager.getSettings()).agentExitAvailableTimelockSeconds);
            await assetManager.exitAvailableAgentList(agentVault.address, { from: agentOwner1 });
            // check that agent is no longer available in three ways
            const agentInfo2 = await assetManager.getAgentInfo(agentVault.address);
            assert.equal(agentInfo2.publiclyAvailable, false);
            const availableAgentList2 = await assetManager.getAvailableAgentsList(0, 10);
            assert.equal(availableAgentList2[0].length, 0);
            const availableAgentDetailedList2 = await assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(availableAgentDetailedList2[0].length, 0);
        });
    });

    describe("minting", () => {
        it("should update the current block", async () => {
            const proof = await attestationProvider.proveConfirmedBlockHeightExists(Number(settings.attestationWindowSeconds));
            await assetManager.updateCurrentBlock(proof);
            const currentBlock = await assetManager.currentUnderlyingBlock();
            assertWeb3Equal(currentBlock[0], proof.blockNumber);
            assertWeb3Equal(currentBlock[1], proof.blockTimestamp);
        });

        it("should execute minting", async () => {
            // create agent vault and make available
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            // reserve collateral
            const minter = accounts[80];
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            const reservationFee = await assetManager.collateralReservationFee(1);
            const tx = await assetManager.reserveCollateral(agentVault.address, 1, agentInfo.feeBIPS,
                { from: minter, value: reservationFee });
            const crt = findRequiredEvent(tx, "CollateralReserved").args;
            // make and prove the payment transaction
            const paymentAmount = crt.valueUBA.add(crt.feeUBA);
            chain.mint("underlying_minter", paymentAmount);
            const txHash = await wallet.addTransaction("underlying_minter", underlyingAgent1, paymentAmount,
                PaymentReference.minting(crt.collateralReservationId));
            const proof = await attestationProvider.provePayment(txHash, "underlying_minter", underlyingAgent1);
            // execute f-asset minting
            await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minter });
            const fassets = await fAsset.balanceOf(minter);
            assertWeb3Equal(fassets, crt.valueUBA);
        });

        it("should do a minting payment default", async () => {
            // create agent vault and make available
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            // reserve collateral
            const minter = accounts[80];
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            const reservationFee = await assetManager.collateralReservationFee(1);
            const tx = await assetManager.reserveCollateral(agentVault.address, 1, agentInfo.feeBIPS,
                { from: minter, value: reservationFee });
            const crt = findRequiredEvent(tx, "CollateralReserved").args;
            assertWeb3Equal(crt.valueUBA, lotsToUBA(1));
            // don't mint f-assets for a while
            chain.mineTo(crt.lastUnderlyingBlock.toNumber()+1);
            chain.skipTimeTo(crt.lastUnderlyingTimestamp.toNumber()+1);
            // prove non-payment
            const proof = await attestationProvider.proveReferencedPaymentNonexistence(underlyingAgent1,
                PaymentReference.minting(crt.collateralReservationId), crt.valueUBA.add(crt.feeUBA),
                0, chain.blockHeight()-1, chain.lastBlockTimestamp()-1);
            const tx2 = await assetManager.mintingPaymentDefault(proof, crt.collateralReservationId, { from: agentOwner1 });
            const def = findRequiredEvent(tx2, "MintingPaymentDefault").args;
            // check that events were emitted correctly
            const agentSettings = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(def.collateralReservationId, crt.collateralReservationId);
            const poolFeeUBA = mulBIPS(toBN(crt.feeUBA), toBN(agentSettings.poolFeeShareBIPS));
            assertWeb3Equal(def.reservedAmountUBA, toBN(crt.valueUBA).add(poolFeeUBA));
            // check that agent and pool got wNat
            const poolShare = mulBIPS(reservationFee, toBN(agentSettings.poolFeeShareBIPS));
            const agentShare = reservationFee.sub(poolShare);
            const agentWnatBalance = await wNat.balanceOf(agentVault.address);
            assertWeb3Equal(agentWnatBalance, agentShare);
            const poolAddress = await assetManager.getCollateralPool(agentVault.address);
            const poolWnatBalance = await wNat.balanceOf(poolAddress);
            assertWeb3Equal(poolWnatBalance.sub(toWei(3e8)), poolShare);
        });

        it("should unstick minting", async () => {
            // create agent vault and make available
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            // reserve collateral
            const minter = accounts[80];
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            const reservationFee = await assetManager.collateralReservationFee(1);
            const tx = await assetManager.reserveCollateral(agentVault.address, 1, agentInfo.feeBIPS,
                { from: minter, value: reservationFee });
            const crt = findRequiredEvent(tx, "CollateralReserved").args;
            // don't mint f-assets for a long time (> 24 hours)
            skipToProofUnavailability(crt.lastUnderlyingBlock, crt.lastUnderlyingTimestamp);
            // calculate the cost of unsticking the minting
            const { 0: multiplier, 1: divisor } = await assetManager.assetPriceNatWei();
            const mintedValueUBA = lotsToUBA(1);
            const mintedValueNAT = mintedValueUBA.mul(multiplier).div(divisor);
            const unstickMintingCost = mulBIPS(mintedValueNAT, toBN(settings.class1BuyForFlareFactorBIPS));
            // unstick minting
            const heightExistenceProof = await attestationProvider.proveConfirmedBlockHeightExists(Number(settings.attestationWindowSeconds));
            const tx2 = await assetManager.unstickMinting(heightExistenceProof, crt.collateralReservationId,
                { from: agentOwner1, value: unstickMintingCost });
            const collateralReservationDeleted = findRequiredEvent(tx2, "CollateralReservationDeleted").args;
            assertWeb3Equal(collateralReservationDeleted.collateralReservationId, crt.collateralReservationId);
        });

        it("should self-mint", async () => {
            // create agent vault and make available
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            // calculate payment amount (as amount >= one lot => include pool fee)
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            const amountUBA = lotsToUBA(1);
            const poolFeeShare = mulBIPS(mulBIPS(amountUBA, toBN(agentInfo.feeBIPS)), toBN(agentInfo.poolFeeShareBIPS));
            const paymentAmount = amountUBA.add(poolFeeShare);
            // make and prove payment transaction
            chain.mint("random_address", paymentAmount);
            const txHash = await wallet.addTransaction("random_address", underlyingAgent1, paymentAmount,
                PaymentReference.selfMint(agentVault.address));
            const proof = await attestationProvider.provePayment(txHash, "random_address", underlyingAgent1);
            // self-mint
            await assetManager.selfMint(proof, agentVault.address, 1, { from: agentOwner1 });
            const fassets = await fAsset.balanceOf(agentOwner1);
            assertWeb3Equal(fassets, amountUBA);
        });
    });

    describe("redemption", () => {

        it("should mint and redeem", async () => {
            // define redeemer and its underlying address
            const redeemer = accounts[80];
            const underlyingRedeemer = "redeemer"
            // create available agentVault and mint f-assets
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            await mintFassets(agentVault, agentOwner1, underlyingAgent1, redeemer, toBN(1));
            // redemption request
            const redemptionRequestTx = await assetManager.redeem(1, underlyingRedeemer, { from: redeemer });
            const redemptionRequest = findRequiredEvent(redemptionRequestTx, "RedemptionRequested").args;
            // prove redemption payment
            const txhash = await wallet.addTransaction(underlyingAgent1, underlyingRedeemer, 1,
                PaymentReference.redemption(redemptionRequest.requestId));
            const proof = await attestationProvider.provePayment(txhash, underlyingAgent1, underlyingRedeemer);
            const redemptionFinishedTx = await assetManager.confirmRedemptionPayment(proof, redemptionRequest.requestId, { from: agentOwner1 });
            const redemptionPerformed = findRequiredEvent(redemptionFinishedTx, "RedemptionPaymentFailed").args;
            // assert (should also check that ticket was burned)
            assertWeb3Equal(redemptionPerformed.requestId, redemptionRequest.requestId);
        });

        it("should do a redemption payment default", async () => {
            // define redeemer and its underlying address
            const redeemer = accounts[83];
            const underlyingRedeemer = "redeemer"
            // create available agentVault and mint f-assets
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            await mintFassets(agentVault, agentOwner1, underlyingAgent1, redeemer, toBN(1));
            // redemption request
            const redemptionRequestTx = await assetManager.redeem(1, underlyingRedeemer, { from: redeemer });
            const redemptionRequest = findRequiredEvent(redemptionRequestTx, "RedemptionRequested").args;
            // agent doesn't pay for specified time / blocks
            chain.mineTo(redemptionRequest.lastUnderlyingBlock.toNumber()+1);
            chain.skipTimeTo(redemptionRequest.lastUnderlyingTimestamp.toNumber()+1);
            // do default
            const proof = await attestationProvider.proveReferencedPaymentNonexistence(underlyingRedeemer,
                PaymentReference.redemption(redemptionRequest.requestId), redemptionRequest.valueUBA.sub(redemptionRequest.feeUBA),
                0, chain.blockHeight()-1, chain.lastBlockTimestamp()-1);
            const redemptionDefaultTx = await assetManager.redemptionPaymentDefault(proof, redemptionRequest.requestId, { from: agentOwner1 });
            // expect events
            const redemptionDefault = findRequiredEvent(redemptionDefaultTx, "RedemptionDefault").args;
            expect(redemptionDefault.agentVault).to.equal(agentVault.address);
            expect(redemptionDefault.redeemer).to.equal(redeemer);
            assertWeb3Equal(redemptionDefault.requestId, redemptionRequest.requestId);
            // expect usdc / wnat balance changes
            const redeemedAssetUSD = await ubaToUSDWei(redemptionRequest.valueUBA, ftsos.asset);
            const redeemerUSDCBalanceUSD = await ubaToUSDWei(await usdc.balanceOf(redeemer), ftsos.usdc);
            const redeemerWNatBalanceUSD = await ubaToUSDWei(await wNat.balanceOf(redeemer), ftsos.nat);
            assertEqualWithNumError(redeemerUSDCBalanceUSD, mulBIPS(redeemedAssetUSD, toBN(settings.redemptionDefaultFactorAgentC1BIPS)), toBN(10));
            assertEqualWithNumError(redeemerWNatBalanceUSD, mulBIPS(redeemedAssetUSD, toBN(settings.redemptionDefaultFactorPoolBIPS)), toBN(10));
        });

        it("should finish non-defaulted redemption payment", async () => {
            // define redeemer and its underlying address
            const redeemer = accounts[83];
            const underlyingRedeemer = "redeemer"
            // create available agentVault and mint f-assets
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            const { agentFeeShareUBA } = await mintFassets(agentVault, agentOwner1, underlyingAgent1, redeemer, toBN(1));
            // default a redemption
            const redemptionRequestTx = await assetManager.redeem(1, underlyingRedeemer, { from: redeemer });
            const redemptionRequest = findRequiredEvent(redemptionRequestTx, "RedemptionRequested").args;
            // don't mint f-assets for a long time (> 24 hours) to escape the provable attestation window
            skipToProofUnavailability(redemptionRequest.lastUnderlyingBlock, redemptionRequest.lastUnderlyingTimestamp);
            // prove redemption payment
            const proof = await attestationProvider.proveConfirmedBlockHeightExists(Number(settings.attestationWindowSeconds));
            const redemptionFinishedTx = await assetManager.finishRedemptionWithoutPayment(proof, redemptionRequest.requestId, { from: agentOwner1 });
            const redemptionDefault = findRequiredEvent(redemptionFinishedTx, "RedemptionDefault").args;
            assertWeb3Equal(redemptionDefault.agentVault, agentVault.address);
            assertWeb3Equal(redemptionDefault.requestId, redemptionRequest.requestId);
            assertWeb3Equal(redemptionDefault.redemptionAmountUBA, lotsToUBA(1));
            // check that free underlying balance was updated
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(agentInfo.freeUnderlyingBalanceUBA, lotsToUBA(1).add(agentFeeShareUBA));
        });
    });

    describe("agent underlying", () => {

        it("should self-close", async () => {
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            const { agentFeeShareUBA } = await mintFassets(agentVault, agentOwner1, underlyingAgent1, agentOwner1, toBN(1));
            const tx = await assetManager.selfClose(agentVault.address, lotsToUBA(1), { from: agentOwner1 });
            const selfClosed = findRequiredEvent(tx, "SelfClose").args;
            assertWeb3Equal(selfClosed.agentVault, agentVault.address);
            assertWeb3Equal(selfClosed.valueUBA, lotsToUBA(1));
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(agentInfo.freeUnderlyingBalanceUBA, lotsToUBA(1).add(agentFeeShareUBA));
        });

        it("should announce underlying withdraw and confirm (from agent owner)", async () => {
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            // deposit underlying asset to not trigger liquidation by making balance negative
            await depositUnderlyingAsset(agentVault, agentOwner1, underlyingAgent1, toWei(10));
            // announce underlying asset withdrawal
            const tx1 = await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
            const underlyingWithdrawalAnnouncement = findRequiredEvent(tx1, "UnderlyingWithdrawalAnnounced").args;
            assertWeb3Equal(underlyingWithdrawalAnnouncement.agentVault, agentVault.address);
            // withdraw
            const txHash = await wallet.addTransaction(underlyingAgent1, "random_address", 1, underlyingWithdrawalAnnouncement.paymentReference);
            const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, "random_address");
            // wait until confirmation
            await time.increase(settings.announcedUnderlyingConfirmationMinSeconds);
            // confirm
            const tx2 = await assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address, { from: agentOwner1 });
            const underlyingWithdrawalConfirmed = findRequiredEvent(tx2, "UnderlyingWithdrawalConfirmed").args;
            assertWeb3Equal(underlyingWithdrawalConfirmed.agentVault, agentVault.address);
            assertWeb3Equal(underlyingWithdrawalConfirmed.spentUBA, toBN(1));
            assertWeb3Equal(underlyingWithdrawalConfirmed.announcementId, underlyingWithdrawalAnnouncement.announcementId);
            // check that agent is not in liquidation
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(agentInfo.status, 0);
        });

        it("should announce underlying withdraw and cancel (from agent owner)", async () => {
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            const tx1 = await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
            const underlyingWithdrawalAnnouncement = findRequiredEvent(tx1, "UnderlyingWithdrawalAnnounced").args;
            await time.increase(settings.announcedUnderlyingConfirmationMinSeconds);
            const tx2 = await assetManager.cancelUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
            const underlyingWithdrawalConfirmed = findRequiredEvent(tx2, "UnderlyingWithdrawalCancelled").args;
            assertWeb3Equal(underlyingWithdrawalConfirmed.agentVault, agentVault.address);
            assertWeb3Equal(underlyingWithdrawalConfirmed.announcementId, underlyingWithdrawalAnnouncement.announcementId);
            // withdrawal didn't happen so agent is not in liquidation
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(agentInfo.status, 0);
        });

        it("should topup the underlying balance", async () => {
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            chain.mint("random_address", 1000);
            const txHash = await wallet.addTransaction("random_address", underlyingAgent1, 1000,
                PaymentReference.topup(agentVault.address));
            const proof = await attestationProvider.provePayment(txHash, "random_address", underlyingAgent1);
            const tx = await assetManager.confirmTopupPayment(proof, agentVault.address, { from: agentOwner1 });
            const underlyingBalanceToppedUp = findRequiredEvent(tx, "UnderlyingBalanceToppedUp").args;
            assertWeb3Equal(underlyingBalanceToppedUp.agentVault, agentVault.address);
            assertWeb3Equal(underlyingBalanceToppedUp.depositedUBA, 1000);
            // check that change was logged in agentInfo
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(agentInfo.freeUnderlyingBalanceUBA, 1000)
        })

    });

    describe("challenges", () => {
        it("should make an illegal payment challenge", async () => {
            const challenger = accounts[83];
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            await depositUnderlyingAsset(agentVault, agentOwner1, underlyingAgent1, toWei(10));
            // make unannounced (illegal) payment
            const txHash = await wallet.addTransaction(underlyingAgent1, "random_address", 1000, PaymentReference.announcedWithdrawal(1));
            const proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
            const tx = await assetManager.illegalPaymentChallenge(proof, agentVault.address, { from: challenger });
            const illegalPaymentConfirmed = findRequiredEvent(tx, "IllegalPaymentConfirmed").args;
            assertWeb3Equal(illegalPaymentConfirmed.agentVault, agentVault.address);
            assertWeb3Equal(illegalPaymentConfirmed.transactionHash, txHash);
            // check that agent went into full liquidation
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(agentInfo.status, 3); // full-liquidation status
            // check that challenger was rewarded
            const expectedChallengerReward = await usd5ToClass1Wei(toBN(settings.paymentChallengeRewardUSD5));
            assertWeb3Equal(await usdc.balanceOf(challenger), expectedChallengerReward);
        });

        it("should make an illegal double payment challenge", async () => {
            const challenger = accounts[83];
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            // announce ONE underlying withdrawal
            await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
            // make two identical payments
            const txHash1 = await wallet.addTransaction(underlyingAgent1, "random_address", 500, PaymentReference.announcedWithdrawal(1));
            const txHash2 = await wallet.addTransaction(underlyingAgent1, "random_address", 500, PaymentReference.announcedWithdrawal(1));
            const proof1 = await attestationProvider.proveBalanceDecreasingTransaction(txHash1, underlyingAgent1);
            const proof2 = await attestationProvider.proveBalanceDecreasingTransaction(txHash2, underlyingAgent1);
            const tx = await assetManager.doublePaymentChallenge(proof1, proof2, agentVault.address, { from: challenger });
            const duplicatePaymentConfirmed = findRequiredEvent(tx, "DuplicatePaymentConfirmed").args;
            assertWeb3Equal(duplicatePaymentConfirmed.agentVault, agentVault.address);
            assertWeb3Equal(duplicatePaymentConfirmed.transactionHash1, txHash1);
            assertWeb3Equal(duplicatePaymentConfirmed.transactionHash2, txHash2);
            // check that agent went into full liquidation
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(agentInfo.status, 3); // full-liquidation status
            // check that challenger was rewarded
            const expectedChallengerReward = await usd5ToClass1Wei(toBN(settings.paymentChallengeRewardUSD5));
            assertWeb3Equal(await usdc.balanceOf(challenger), expectedChallengerReward);
        });

        it("should make a free-balance negative challenge", async () => {
            const challenger = accounts[83];
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1);
            // mint one lot of f-assets
            const lots = toBN(1);
            const { underlyingPaymentUBA } = await mintFassets(agentVault, agentOwner1, underlyingAgent1, agentVault.address, lots);
            // announce withdrawal
            const _tx = await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
            const underlyingWithdrawalAnnouncement = findRequiredEvent(_tx, "UnderlyingWithdrawalAnnounced").args;
            // make payment that would make free balance negative
            const txHash = await wallet.addTransaction(underlyingAgent1, "random_address", lotsToUBA(lots),
                underlyingWithdrawalAnnouncement.paymentReference);
            const proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
            // make a challenge
            const tx = await assetManager.freeBalanceNegativeChallenge([proof], agentVault.address, { from: challenger });
            const underlyingBalanceTooLow = findRequiredEvent(tx, "UnderlyingBalanceTooLow").args;
            assertWeb3Equal(underlyingBalanceTooLow.agentVault, agentVault.address);
            assertWeb3Equal(underlyingBalanceTooLow.balance, underlyingPaymentUBA.sub(lotsToUBA(lots)));
            assertWeb3Equal(underlyingBalanceTooLow.requiredBalance,
                mulBIPS(await fAsset.totalSupply(), toBN(settings.minUnderlyingBackingBIPS)));
            // check that challenger was rewarded
            const expectedChallengerReward = await usd5ToClass1Wei(toBN(settings.paymentChallengeRewardUSD5));
            assertWeb3Equal(await usdc.balanceOf(challenger), expectedChallengerReward);
        });
    });

    describe("liquidation", () => {

        it("should start liquidation", async () => {
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1)
            // mint some f-assets that require backing
            await mintFassets(agentVault, agentOwner1, underlyingAgent1, accounts[82], toBN(1));
            // price change
            await ftsos.asset.setCurrentPrice(toBNExp(3521, 50), 0);
            await ftsos.asset.setCurrentPriceFromTrustedProviders(toBNExp(3521, 50), 0);
            // start liquidation
            const tx = await assetManager.startLiquidation(agentVault.address, { from: accounts[83] });
            expectEvent(tx, "LiquidationStarted");
            // check that agent is in liquidation phase
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(agentInfo.status, 2);
        });

        it("should liquidate", async () => {
            const liquidator = accounts[83];
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1, toWei(3e8), toWei(3e8))
            await mintFassets(agentVault, agentOwner1, underlyingAgent1, liquidator, toBN(2));
            // simulate liquidation (set cr to eps > 0)
            await ftsos.asset.setCurrentPrice(toBNExp(10, 12), 0);
            await ftsos.asset.setCurrentPriceFromTrustedProviders(toBNExp(10, 12), 0);
            await assetManager.startLiquidation(agentVault.address, { from: liquidator });
            // calculate liquidation value and liquidate liquidate
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            const liquidationUBA = lotsToUBA(2);
            const liquidationUSDC = await ubaToC1Wei(mulBIPS(liquidationUBA, toBN(agentInfo.class1CollateralRatioBIPS)));
            const liquidationPool = await ubaToPoolWei(mulBIPS(liquidationUBA, toBN(agentInfo.poolCollateralRatioBIPS)));
            const tx = await assetManager.liquidate(agentVault.address, lotsToUBA(2), { from: liquidator });
            expectEvent(tx, "LiquidationPerformed");
            assertWeb3Equal(await usdc.balanceOf(liquidator), liquidationUSDC);
            assertWeb3Equal(await wNat.balanceOf(liquidator), liquidationPool);
        });

        it("should start and then end liquidation", async () => {
            const agentVault = await createAvailableAgentWithEOA(agentOwner1, underlyingAgent1, toWei(3e8), toWei(3e8))
            await mintFassets(agentVault, agentOwner1, underlyingAgent1, accounts[83], toBN(2));
            // price change #1
            await ftsos.asset.setCurrentPrice(toBNExp(3521, 50), 0);
            await ftsos.asset.setCurrentPriceFromTrustedProviders(toBNExp(3521, 50), 0);
            // start liquidation
            await assetManager.startLiquidation(agentVault.address, { from: accounts[83] });
            // price change #2
            await ftsos.asset.setCurrentPrice(testChainInfo.eth.startPrice, 0);
            await ftsos.asset.setCurrentPriceFromTrustedProviders(testChainInfo.eth.startPrice, 0);
            // end liquidation
            const tx = await assetManager.endLiquidation(agentVault.address, { from: accounts[83] });
            expectEvent(tx, "LiquidationEnded");
            // check that agent status is normal
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(agentInfo.status, 0);
        });
    });

    describe("getting agents", () => {
        it("should get all agents", async () => {
            // create agent
            const agentVault1 = await createAgentWithEOA(accounts[82], "Agent1");
            const agentVault2 = await createAgentWithEOA(accounts[83], "Agent2")
            // get all agents
            const agents = await assetManager.getAllAgents(0, 10);
            assert.equal(agents[0].length, 2);
            assert.equal(agents[0][0], agentVault1.address);
            assert.equal(agents[0][1], agentVault2.address);
            assert.equal(agents[1].toString(), "2");
        });
        it("should announce and destroy agent", async () => {
            const agentVault = await createAgentWithEOA(agentOwner1, underlyingAgent1);
            await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
            await time.increase(2 * time.duration.hours(2));
            await assetManager.destroyAgent(agentVault.address, agentOwner1, { from: agentOwner1 });
            const tx = assetManager.getAgentInfo(agentVault.address);
            await expectRevert(tx, "invalid agent vault address");
        });
    });

    describe("ERC-165 interface identification", () => {
        it("should properly respond to supportsInterface", async () => {
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as any) as any as IERC165Contract;
            const IAssetManager = artifacts.require("IAssetManager");
            const IIAssetManager = artifacts.require("IIAssetManager");
            const iERC165 = await IERC165.at(assetManager.address);
            const iAssetManager = await IAssetManager.at(assetManager.address);
            const iiAssetManager = await IIAssetManager.at(assetManager.address);
            assert.isTrue(await assetManager.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await assetManager.supportsInterface(erc165InterfaceId(iAssetManager.abi)));
            assert.isTrue(await assetManager.supportsInterface(erc165InterfaceId(iiAssetManager.abi, [iAssetManager.abi])));
            assert.isFalse(await assetManager.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });
});
