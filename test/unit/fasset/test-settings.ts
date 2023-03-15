import { constants } from "@openzeppelin/test-helpers";
import { AgentSettings, AssetManagerSettings, CollateralToken, CollateralTokenClass } from "../../../lib/fasset/AssetManagerTypes";
import { LiquidationStrategyImplSettings } from "../../../lib/fasset/LiquidationStrategyImpl";
import { DAYS, HOURS, MINUTES, toBIPS, toBNExp } from "../../../lib/utils/helpers";
import {
    AddressUpdaterInstance, AgentVaultFactoryInstance, AssetManagerControllerInstance, AttestationClientSCInstance,
    CollateralPoolFactoryInstance, ERC20MockInstance, FtsoMockInstance, FtsoRegistryMockInstance, GovernanceSettingsInstance,
    IAddressValidatorInstance, IWhitelistInstance, WNatInstance
} from "../../../typechain-truffle";
import { GENESIS_GOVERNANCE_ADDRESS } from "../../utils/constants";
import { setDefaultVPContract } from "../../utils/token-test-helpers";

const WNat = artifacts.require("WNat");
const AddressUpdater = artifacts.require('AddressUpdater');
const AttestationClient = artifacts.require('AttestationClientSC');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const StateConnector = artifacts.require('StateConnectorMock');
const GovernanceSettings = artifacts.require('GovernanceSettings');
const AgentVaultFactory = artifacts.require('AgentVaultFactory');
const ERC20Mock = artifacts.require("ERC20Mock");
const CollateralPoolFactory = artifacts.require("CollateralPoolFactory");
const TrivialAddressValidatorMock = artifacts.require("TrivialAddressValidatorMock");
const AssetManagerController = artifacts.require('AssetManagerController');

export interface TestSettingsContracts {
    governanceSettings: GovernanceSettingsInstance;
    addressUpdater: AddressUpdaterInstance;
    agentVaultFactory: AgentVaultFactoryInstance;
    collateralPoolFactory: CollateralPoolFactoryInstance;
    attestationClient: AttestationClientSCInstance;
    addressValidator: IAddressValidatorInstance;
    assetManagerController: AssetManagerControllerInstance;
    whitelist?: IWhitelistInstance;
    agentWhitelist?: IWhitelistInstance;
    ftsoRegistry: FtsoRegistryMockInstance;
    liquidationStrategy: string; // lib address
    wNat: WNatInstance,
    stablecoins: Record<string, ERC20MockInstance>
}

export interface TestSettingOptions {
    burnAddress?: string;
    requireEOAAddressProof?: boolean;
    burnWithSelfDestruct?: boolean;
}

export function createTestSettings(contracts: TestSettingsContracts, options: TestSettingOptions = {}): AssetManagerSettings {
    return {
        assetManagerController: constants.ZERO_ADDRESS,     // replaced in newAssetManager(...)
        fAsset: constants.ZERO_ADDRESS,                     // replaced in newAssetManager(...)
        agentVaultFactory: contracts.agentVaultFactory.address,
        collateralPoolFactory: contracts.collateralPoolFactory.address,
        attestationClient: contracts.attestationClient.address,
        underlyingAddressValidator: contracts.addressValidator.address,
        liquidationStrategy: contracts.liquidationStrategy,
        whitelist: contracts.whitelist?.address ?? constants.ZERO_ADDRESS,
        agentWhitelist: contracts.agentWhitelist?.address ?? constants.ZERO_ADDRESS,
        ftsoRegistry: contracts.ftsoRegistry.address,
        mintingCapAMG: 0,                                   // minting cap disabled
        assetFtsoSymbol: "ETH",
        assetFtsoIndex: 0,                                  // set automatically in contract
        burnAddress: options.burnAddress ?? constants.ZERO_ADDRESS,
        burnWithSelfDestruct: options.burnWithSelfDestruct ?? false,
        chainId: 1,
        collateralReservationFeeBIPS: toBIPS("1%"),
        assetDecimals: 18,
        assetUnitUBA: toBNExp(1, 18),                   // 1e18 wei per eth
        assetMintingDecimals: 9,                        // 1 eth = 1e9 amg
        assetMintingGranularityUBA: toBNExp(1, 9),      // 1 amg = 1 eth / 1e9 = 1e9 uba
        lotSizeAMG: toBNExp(1_000, 9),                  // 1000 eth
        requireEOAAddressProof: options.requireEOAAddressProof ?? true,
        underlyingBlocksForPayment: 10,
        underlyingSecondsForPayment: 120,                      // 12s per block assumed
        redemptionFeeBIPS: toBIPS("2%"),
        maxRedeemedTickets: 20,                                 // TODO: find number that fits comfortably in gas limits
        redemptionDefaultFactorAgentC1BIPS: toBIPS(1.1),
        redemptionDefaultFactorPoolBIPS: toBIPS(0.1),
        confirmationByOthersAfterSeconds: 6 * HOURS,            // 6 hours
        confirmationByOthersRewardUSD5: toBNExp(100, 5),    // 100 USD
        paymentChallengeRewardUSD5: toBNExp(300, 5),        // 300 USD
        paymentChallengeRewardBIPS: 0,
        withdrawalWaitMinSeconds: 300,
        ccbTimeSeconds: 180,
        maxTrustedPriceAgeSeconds: 8 * MINUTES,
        minUpdateRepeatTimeSeconds: 1 * DAYS,
        attestationWindowSeconds: 1 * DAYS,
        buybackCollateralFactorBIPS: toBIPS(1.1),               // 1.1
        announcedUnderlyingConfirmationMinSeconds: 0,           // should be higher in production (~ state connector response time, in tests sc response time is 0)
        agentFeeChangeTimelockSeconds: 6 * HOURS,
        agentCollateralRatioChangeTimelockSeconds: 1 * HOURS,
        agentExitAvailableTimelockSeconds: 10 * MINUTES,
        class1BuyForFlareFactorBIPS: toBIPS(1.05),
        mintingPoolHoldingsRequiredBIPS: toBIPS("50%"),
        tokenInvalidationTimeMinSeconds: 1 * DAYS,
    };
}

export function createTestCollaterals(contracts: TestSettingsContracts): CollateralToken[] {
    const poolCollateral: CollateralToken = {
        tokenClass: CollateralTokenClass.POOL,
        token: contracts.wNat.address,
        decimals: 18,
        validUntil: 0,  // not deprecated
        ftsoSymbol: "NAT",
        minCollateralRatioBIPS: toBIPS(2.0),
        ccbMinCollateralRatioBIPS: toBIPS(1.9),
        safetyMinCollateralRatioBIPS: toBIPS(2.1),
    };
    const usdcCollateral: CollateralToken = {
        tokenClass: CollateralTokenClass.CLASS1,
        token: contracts.stablecoins.USDC.address,
        decimals: 18,
        validUntil: 0,  // not deprecated
        ftsoSymbol: "USDC",
        minCollateralRatioBIPS: toBIPS(1.4),
        ccbMinCollateralRatioBIPS: toBIPS(1.3),
        safetyMinCollateralRatioBIPS: toBIPS(1.5),
    };
    const usdtCollateral: CollateralToken = {
        tokenClass: CollateralTokenClass.CLASS1,
        token: contracts.stablecoins.USDT.address,
        decimals: 18,
        validUntil: 0,  // not deprecated
        ftsoSymbol: "USDT",
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
    const attestationClient = await AttestationClient.new(stateConnector.address);
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
    // create agent vault factory
    const agentVaultFactory = await AgentVaultFactory.new();
    // create collateral pool factory
    const collateralPoolFactory = await CollateralPoolFactory.new();
    // create address validator
    const addressValidator = await TrivialAddressValidatorMock.new();
    // create liquidation strategy
    const liquidationStrategyLib = await artifacts.require("LiquidationStrategyImpl").new();
    const liquidationStrategy = liquidationStrategyLib.address;
    // create asset manager controller
    const assetManagerController = await AssetManagerController.new(governanceSettings.address, governance, addressUpdater.address);
    await assetManagerController.switchToProductionMode({ from: governance });
    //
    return { governanceSettings, addressUpdater, agentVaultFactory, collateralPoolFactory, attestationClient,
        addressValidator, assetManagerController, ftsoRegistry, wNat, liquidationStrategy, stablecoins };
}
