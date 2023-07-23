import { constants } from "@openzeppelin/test-helpers";
import { AgentSettings, AssetManagerSettings, CollateralType, CollateralClass } from "../../lib/fasset/AssetManagerTypes";
import { encodeLiquidationStrategyImplSettings, LiquidationStrategyImplSettings } from "../../lib/fasset/LiquidationStrategyImpl";
import { PaymentReference } from "../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../lib/underlying-chain/AttestationHelper";
import { findRequiredEvent } from "../../lib/utils/events/truffle";
import { DAYS, HOURS, MAX_BIPS, MINUTES, toBIPS, toBNExp } from "../../lib/utils/helpers";
import { web3DeepNormalize } from "../../lib/utils/web3normalize";
import {
    AddressUpdaterInstance, AgentVaultFactoryInstance, AssetManagerInstance, SCProofVerifierInstance,
    CollateralPoolFactoryInstance, ERC20MockInstance, FtsoMockInstance, FtsoRegistryMockInstance, GovernanceSettingsInstance,
    IAddressValidatorInstance, IWhitelistInstance, StateConnectorMockInstance, WNatInstance
} from "../../typechain-truffle";
import { TestChainInfo } from "../integration/utils/TestChainInfo";
import { GENESIS_GOVERNANCE_ADDRESS } from "./constants";
import { MockChain, MockChainWallet } from "./fasset/MockChain";
import { setDefaultVPContract } from "./token-test-helpers";
import { ChainInfo } from "../../lib/fasset/ChainInfo";

const AgentVault = artifacts.require("AgentVault");
const WNat = artifacts.require("WNat");
const AddressUpdater = artifacts.require('AddressUpdater');
const SCProofVerifier = artifacts.require('SCProofVerifier');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const StateConnector = artifacts.require('StateConnectorMock');
const GovernanceSettings = artifacts.require('GovernanceSettings');
const AgentVaultFactory = artifacts.require('AgentVaultFactory');
const ERC20Mock = artifacts.require("ERC20Mock");
const CollateralPoolFactory = artifacts.require("CollateralPoolFactory");
const TrivialAddressValidatorMock = artifacts.require("TrivialAddressValidatorMock");
const WhitelistMock = artifacts.require("WhitelistMock");

export interface TestSettingsContracts {
    governanceSettings: GovernanceSettingsInstance;
    addressUpdater: AddressUpdaterInstance;
    agentVaultFactory: AgentVaultFactoryInstance;
    collateralPoolFactory: CollateralPoolFactoryInstance;
    stateConnector: StateConnectorMockInstance;
    scProofVerifier: SCProofVerifierInstance;
    addressValidator: IAddressValidatorInstance;
    whitelist?: IWhitelistInstance;
    agentWhitelist: IWhitelistInstance;
    ftsoRegistry: FtsoRegistryMockInstance;
    liquidationStrategy: string; // lib address
    wNat: WNatInstance,
    stablecoins: Record<string, ERC20MockInstance>,
}

export type TestSettingOptions = Partial<AssetManagerSettings>;

export function createTestSettings(contracts: TestSettingsContracts, ci: TestChainInfo, options?: TestSettingOptions): AssetManagerSettings {
    const result: AssetManagerSettings = {
        assetManagerController: constants.ZERO_ADDRESS,     // replaced in newAssetManager(...)
        fAsset: constants.ZERO_ADDRESS,                     // replaced in newAssetManager(...)
        agentVaultFactory: contracts.agentVaultFactory.address,
        collateralPoolFactory: contracts.collateralPoolFactory.address,
        scProofVerifier: contracts.scProofVerifier.address,
        underlyingAddressValidator: contracts.addressValidator.address,
        liquidationStrategy: contracts.liquidationStrategy,
        whitelist: contracts.whitelist?.address ?? constants.ZERO_ADDRESS,
        agentWhitelist: contracts.agentWhitelist?.address ?? constants.ZERO_ADDRESS,
        ftsoRegistry: contracts.ftsoRegistry.address,
        burnAddress: constants.ZERO_ADDRESS,
        chainId: ci.chainId,
        collateralReservationFeeBIPS: toBIPS("1%"),
        assetDecimals: ci.decimals,
        assetUnitUBA: toBNExp(1, ci.decimals),
        assetMintingDecimals: ci.amgDecimals,
        assetMintingGranularityUBA: toBNExp(1, ci.decimals - ci.amgDecimals),
        minUnderlyingBackingBIPS: MAX_BIPS,
        mintingCapAMG: 0,                                   // minting cap disabled
        lotSizeAMG: toBNExp(ci.lotSize, ci.amgDecimals),
        requireEOAAddressProof: ci.requireEOAProof,
        underlyingBlocksForPayment: ci.underlyingBlocksForPayment,
        underlyingSecondsForPayment: ci.underlyingBlocksForPayment * ci.blockTime,
        redemptionFeeBIPS: toBIPS("2%"),
        maxRedeemedTickets: 20,                                 // TODO: find number that fits comfortably in gas limits
        redemptionDefaultFactorAgentC1BIPS: toBIPS(1.1),
        redemptionDefaultFactorPoolBIPS: toBIPS(0.1),
        confirmationByOthersAfterSeconds: 6 * HOURS,            // 6 hours
        confirmationByOthersRewardUSD5: toBNExp(100, 5),        // 100 USD
        paymentChallengeRewardUSD5: toBNExp(300, 5),            // 300 USD
        paymentChallengeRewardBIPS: 0,
        withdrawalWaitMinSeconds: 300,
        ccbTimeSeconds: 3 * MINUTES,
        maxTrustedPriceAgeSeconds: 8 * MINUTES,
        minUpdateRepeatTimeSeconds: 1 * DAYS,
        attestationWindowSeconds: 1 * DAYS,
        averageBlockTimeMS: Math.round(ci.blockTime * 1000),
        buybackCollateralFactorBIPS: toBIPS(1.1),               // 1.1
        announcedUnderlyingConfirmationMinSeconds: 0,           // should be higher in production (~ state connector response time, in tests sc response time is 0)
        agentFeeChangeTimelockSeconds: 6 * HOURS,
        agentCollateralRatioChangeTimelockSeconds: 1 * HOURS,
        agentExitAvailableTimelockSeconds: 10 * MINUTES,
        class1BuyForFlareFactorBIPS: toBIPS(1.05),
        mintingPoolHoldingsRequiredBIPS: toBIPS("50%"),
        tokenInvalidationTimeMinSeconds: 1 * DAYS,
    };
    return Object.assign(result, options ?? {});
}

export function createTestCollaterals(contracts: TestSettingsContracts, ci: ChainInfo): CollateralType[] {
    const poolCollateral: CollateralType = {
        collateralClass: CollateralClass.POOL,
        token: contracts.wNat.address,
        decimals: 18,
        validUntil: 0,  // not deprecated
        directPricePair: false,
        assetFtsoSymbol: ci.symbol,
        tokenFtsoSymbol: "NAT",
        minCollateralRatioBIPS: toBIPS(2.0),
        ccbMinCollateralRatioBIPS: toBIPS(1.9),
        safetyMinCollateralRatioBIPS: toBIPS(2.1),
    };
    const usdcCollateral: CollateralType = {
        collateralClass: CollateralClass.CLASS1,
        token: contracts.stablecoins.USDC.address,
        decimals: 18,
        validUntil: 0,  // not deprecated
        directPricePair: false,
        assetFtsoSymbol: ci.symbol,
        tokenFtsoSymbol: "USDC",
        minCollateralRatioBIPS: toBIPS(1.4),
        ccbMinCollateralRatioBIPS: toBIPS(1.3),
        safetyMinCollateralRatioBIPS: toBIPS(1.5),
    };
    const usdtCollateral: CollateralType = {
        collateralClass: CollateralClass.CLASS1,
        token: contracts.stablecoins.USDT.address,
        decimals: 18,
        validUntil: 0,  // not deprecated
        directPricePair: false,
        assetFtsoSymbol: ci.symbol,
        tokenFtsoSymbol: "USDT",
        minCollateralRatioBIPS: toBIPS(1.5),
        ccbMinCollateralRatioBIPS: toBIPS(1.4),
        safetyMinCollateralRatioBIPS: toBIPS(1.6),
    };
    return [poolCollateral, usdcCollateral, usdtCollateral];
}

export function createTestLiquidationSettings(): LiquidationStrategyImplSettings {
    return {
        liquidationStepSeconds: 90,
        liquidationCollateralFactorBIPS: [toBIPS(1.2), toBIPS(1.6), toBIPS(2.0)],
        liquidationFactorClass1BIPS: [toBIPS(1), toBIPS(1), toBIPS(1)],
    };
}

export type TestFtsos = Record<'nat' | 'usdc' | 'usdt' | 'asset', FtsoMockInstance>;

export async function createTestFtsos(ftsoRegistry: FtsoRegistryMockInstance, assetChainInfo: TestChainInfo): Promise<TestFtsos> {
    return {
        nat: await createFtsoMock(ftsoRegistry, "NAT", 0.42),
        usdc: await createFtsoMock(ftsoRegistry, "USDC", 1.01),
        usdt: await createFtsoMock(ftsoRegistry, "USDT", 0.99),
        asset: await createFtsoMock(ftsoRegistry, assetChainInfo.symbol, assetChainInfo.startPrice),
    };
}

export function createTestAgentSettings(underlyingAddress: string, class1TokenAddress: string, options?: Partial<AgentSettings>): AgentSettings {
    const defaults: AgentSettings = {
        underlyingAddressString: underlyingAddress,
        class1CollateralToken: class1TokenAddress,
        feeBIPS: toBIPS("10%"),
        poolFeeShareBIPS: toBIPS("40%"),
        mintingClass1CollateralRatioBIPS: toBIPS(1.6),
        mintingPoolCollateralRatioBIPS: toBIPS(2.5),
        poolExitCollateralRatioBIPS: toBIPS(2.6),
        buyFAssetByAgentFactorBIPS: toBIPS(0.9),
        poolTopupCollateralRatioBIPS: toBIPS(2.1),
        poolTopupTokenPriceFactorBIPS: toBIPS(0.8),
    };
    return { ...defaults, ...(options ?? {}) };
}

export function createEncodedTestLiquidationSettings() {
    return encodeLiquidationStrategyImplSettings(createTestLiquidationSettings());
}

export async function createFtsoMock(ftsoRegistry: FtsoRegistryMockInstance, ftsoSymbol: string, initialPrice: number, decimals: number = 5): Promise<FtsoMockInstance> {
    const ftso = await FtsoMock.new(ftsoSymbol, decimals);
    await ftso.setCurrentPrice(toBNExp(initialPrice, decimals), 0);
    await ftso.setCurrentPriceFromTrustedProviders(toBNExp(initialPrice, decimals), 0);
    await ftsoRegistry.addFtso(ftso.address);
    return ftso;
}

export async function createTestContracts(governance: string): Promise<TestSettingsContracts> {
    // create governance settings
    const governanceSettings = await GovernanceSettings.new();
    await governanceSettings.initialise(governance, 60, [governance], { from: GENESIS_GOVERNANCE_ADDRESS });
    // create address updater
    const addressUpdater = await AddressUpdater.new(governance);  // don't switch to production
    // create state connector
    const stateConnector = await StateConnector.new();
    // create attestation client
    const scProofVerifier = await SCProofVerifier.new(stateConnector.address);
    // create WNat token
    const wNat = await WNat.new(governance, "NetworkNative", "NAT");
    await setDefaultVPContract(wNat, governance);
    // create stablecoins
    const stablecoins = {
        USDC: await ERC20Mock.new("USDCoin", "USDC"),
        USDT: await ERC20Mock.new("Tether", "USDT"),
    };
    // create ftso registry
    const ftsoRegistry = await FtsoRegistryMock.new();
    // add some addresses to address updater
    await addressUpdater.addOrUpdateContractNamesAndAddresses(
        ["GovernanceSettings", "AddressUpdater", "StateConnector", "FtsoRegistry", "WNat"],
        [governanceSettings.address, addressUpdater.address, stateConnector.address, ftsoRegistry.address, wNat.address],
        { from: governance });
    // create agent vault factory
    const agentVaultFactory = await AgentVaultFactory.new();
    // create collateral pool factory
    const collateralPoolFactory = await CollateralPoolFactory.new();
    // create address validator
    const addressValidator = await TrivialAddressValidatorMock.new();
    // create allow-all agent whitelist
    const agentWhitelist = await WhitelistMock.new(true);
    // create liquidation strategy
    const liquidationStrategyLib = await artifacts.require("LiquidationStrategyImpl").new();
    const liquidationStrategy = liquidationStrategyLib.address;
    //
    return { governanceSettings, addressUpdater, agentVaultFactory, collateralPoolFactory, stateConnector, scProofVerifier,
        addressValidator, agentWhitelist, ftsoRegistry, wNat, liquidationStrategy, stablecoins };
}

export interface CreateTestAgentDeps {
    assetManager: AssetManagerInstance;
    settings: AssetManagerSettings;
    chain?: MockChain;
    wallet?: MockChainWallet;
    attestationProvider?: AttestationHelper;
}

export async function createTestAgent(deps: CreateTestAgentDeps, owner: string, underlyingAddress: string, class1TokenAddress: string, options?: Partial<AgentSettings>) {
    if (deps.settings.requireEOAAddressProof) {
        if (!deps.chain || !deps.wallet || !deps.attestationProvider) throw new Error("Missing chain data for EOA proof");
        // mint some funds on underlying address (just enough to make EOA proof)
        deps.chain.mint(underlyingAddress, 101);
        // create and prove transaction from underlyingAddress
        const txHash = await deps.wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(owner), { maxFee: 100 });
        const proof = await deps.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
        await deps.assetManager.proveUnderlyingAddressEOA(proof, { from: owner });
    }
    // create agent
    const agentSettings = createTestAgentSettings(underlyingAddress, class1TokenAddress, options);
    const response = await deps.assetManager.createAgent(web3DeepNormalize(agentSettings), { from: owner });
    // extract agent vault address from AgentCreated event
    const event = findRequiredEvent(response, 'AgentCreated');
    const agentVaultAddress = event.args.agentVault;
    // get vault contract at this address
    return await AgentVault.at(agentVaultAddress);
}
