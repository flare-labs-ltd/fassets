import { AgentSettings, AssetManagerSettings, CollateralClass, CollateralType } from "../../lib/fasset/AssetManagerTypes";
import { ChainInfo } from "../../lib/fasset/ChainInfo";
import { PaymentReference } from "../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../lib/underlying-chain/AttestationHelper";
import { findRequiredEvent } from "../../lib/utils/events/truffle";
import { BNish, DAYS, HOURS, MAX_BIPS, MINUTES, toBIPS, toBNExp, WEEKS, ZERO_ADDRESS } from "../../lib/utils/helpers";
import { web3DeepNormalize } from "../../lib/utils/web3normalize";
import {
    AddressUpdaterInstance,
    AgentOwnerRegistryInstance,
    AgentVaultFactoryInstance,
    CollateralPoolFactoryInstance,
    CollateralPoolTokenFactoryInstance,
    ERC20MockInstance, FtsoMockInstance, FtsoRegistryMockInstance, GovernanceSettingsInstance,
    IIAssetManagerInstance,
    IPriceReaderInstance,
    IWhitelistInstance,
    WNatInstance,
    IFdcVerificationInstance,
    RelayMockInstance,
    FdcHubMockInstance
} from "../../typechain-truffle";
import { CoreVaultManagerSettings } from "../integration/utils/MockCoreVaultBot";
import { TestChainInfo } from "../integration/utils/TestChainInfo";
import { GENESIS_GOVERNANCE_ADDRESS } from "./constants";
import { AssetManagerInitSettings, waitForTimelock } from "./fasset/CreateAssetManager";
import { MockChain, MockChainWallet } from "./fasset/MockChain";
import { setDefaultVPContract } from "./token-test-helpers";

const AgentVault = artifacts.require("AgentVault");
const WNat = artifacts.require("WNat");
const AddressUpdater = artifacts.require('AddressUpdater');
const FdcVerification = artifacts.require('FdcVerificationMock');
const PriceReader = artifacts.require('FtsoV1PriceReader');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const FdcHub = artifacts.require('FdcHubMock');
const Relay = artifacts.require('RelayMock');
const GovernanceSettings = artifacts.require('GovernanceSettings');
const AgentVaultFactory = artifacts.require('AgentVaultFactory');
const ERC20Mock = artifacts.require("ERC20Mock");
const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");
const CollateralPoolFactory = artifacts.require("CollateralPoolFactory");
const CollateralPoolTokenFactory = artifacts.require("CollateralPoolTokenFactory");
const AgentOwnerRegistry = artifacts.require("AgentOwnerRegistry");
const CoreVaultManager = artifacts.require('CoreVaultManager');
const CoreVaultManagerProxy = artifacts.require('CoreVaultManagerProxy');

export interface TestSettingsCommonContracts {
    governanceSettings: GovernanceSettingsInstance;
    addressUpdater: AddressUpdaterInstance;
    agentVaultFactory: AgentVaultFactoryInstance;
    collateralPoolFactory: CollateralPoolFactoryInstance;
    collateralPoolTokenFactory: CollateralPoolTokenFactoryInstance;
    relay: RelayMockInstance;
    fdcHub: FdcHubMockInstance;
    fdcVerification: IFdcVerificationInstance;
    priceReader: IPriceReaderInstance,
    whitelist?: IWhitelistInstance;
    agentOwnerRegistry: AgentOwnerRegistryInstance;
    wNat: WNatInstance,
    stablecoins: Record<string, ERC20MockInstance>,
}

export interface CoreVaultManagerInitSettings extends CoreVaultManagerSettings {
    underlyingAddress: string;
    initialNonce: BNish;
    custodianAddress: string;
    triggeringAccounts: string[];
}

export interface TestSettingsContracts extends TestSettingsCommonContracts {
    ftsoRegistry: FtsoRegistryMockInstance;
}

export type TestSettingOptions = Partial<AssetManagerInitSettings>;

export function createTestSettings(contracts: TestSettingsCommonContracts, ci: TestChainInfo, options?: TestSettingOptions): AssetManagerInitSettings {
    const result: AssetManagerInitSettings = {
        assetManagerController: ZERO_ADDRESS,     // replaced in newAssetManager(...)
        fAsset: ZERO_ADDRESS,                     // replaced in newAssetManager(...)
        agentVaultFactory: contracts.agentVaultFactory.address,
        collateralPoolFactory: contracts.collateralPoolFactory.address,
        collateralPoolTokenFactory: contracts.collateralPoolTokenFactory.address,
        fdcVerification: contracts.fdcVerification.address,
        priceReader: contracts.priceReader.address,
        whitelist: contracts.whitelist?.address ?? ZERO_ADDRESS,
        agentOwnerRegistry: contracts.agentOwnerRegistry?.address ?? ZERO_ADDRESS,
        burnAddress: ZERO_ADDRESS,
        chainId: ci.chainId,
        poolTokenSuffix: ci.assetSymbol,
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
        redemptionDefaultFactorVaultCollateralBIPS: toBIPS(1.1),
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
        announcedUnderlyingConfirmationMinSeconds: 0,           // should be higher in production (~ Flare data connector response time, in tests sc response time is 0)
        agentFeeChangeTimelockSeconds: 6 * HOURS,
        agentMintingCRChangeTimelockSeconds: 1 * HOURS,
        poolExitAndTopupChangeTimelockSeconds: 2 * HOURS,
        agentTimelockedOperationWindowSeconds: 1 * HOURS,
        agentExitAvailableTimelockSeconds: 10 * MINUTES,
        vaultCollateralBuyForFlareFactorBIPS: toBIPS(1.05),
        mintingPoolHoldingsRequiredBIPS: toBIPS("50%"),
        tokenInvalidationTimeMinSeconds: 1 * DAYS,
        collateralPoolTokenTimelockSeconds: 1 * HOURS,
        liquidationStepSeconds: 90,
        liquidationCollateralFactorBIPS: [toBIPS(1.2), toBIPS(1.6), toBIPS(2.0)],
        liquidationFactorVaultCollateralBIPS: [toBIPS(1), toBIPS(1), toBIPS(1)],
        diamondCutMinTimelockSeconds: 1 * HOURS,
        maxEmergencyPauseDurationSeconds: 1 * DAYS,
        emergencyPauseDurationResetAfterSeconds: 7 * DAYS,
        redemptionPaymentExtensionSeconds: 10,
        cancelCollateralReservationAfterSeconds: 30,
        rejectOrCancelCollateralReservationReturnFactorBIPS: toBIPS(0.95),
        rejectRedemptionRequestWindowSeconds: 120,
        takeOverRedemptionRequestWindowSeconds: 120,
        rejectedRedemptionDefaultFactorVaultCollateralBIPS: toBIPS(1.05),
        rejectedRedemptionDefaultFactorPoolBIPS: toBIPS(0.05),
        transferFeeMillionths: 0,
        transferFeeClaimFirstEpochStartTs: Math.floor(new Date("2024-09-01").getTime() / 1000),
        transferFeeClaimEpochDurationSeconds: 1 * WEEKS,
        transferFeeClaimMaxUnexpiredEpochs: 12,
        coreVaultNativeAddress: "0xfa3BdC8709226Da0dA13A4d904c8b66f16c3c8BA",     // one of test accounts [9]
        coreVaultTransferFeeBIPS: toBIPS("0.5%"),
        coreVaultTransferTimeExtensionSeconds: 2 * HOURS,
        coreVaultRedemptionFeeBIPS: toBIPS("1%"),
        coreVaultMinimumAmountLeftBIPS: 0,
        coreVaultMinimumRedeemLots: 10,
    };
    return Object.assign(result, options ?? {});
}

export function createTestCoreVaultManagerSettings(ci: TestChainInfo, options?: Partial<CoreVaultManagerInitSettings>): CoreVaultManagerInitSettings {
    const lotSize = toBNExp(ci.lotSize, ci.decimals);
    const defaultTestSettings: CoreVaultManagerInitSettings = {
        underlyingAddress: "CORE_VAULT_UNDERLYING",
        initialNonce: 1,
        custodianAddress: "CORE_VAULT_CUSTODIAN",
        escrowAmount: lotSize.muln(100),
        escrowEndTimeSeconds: 12 * HOURS,   // 12h noon
        minimalAmountLeft: lotSize.muln(100),
        chainPaymentFee: 50,
        triggeringAccounts: [],
    }
    return { ...defaultTestSettings, ...options };
}

export function createTestCollaterals(contracts: TestSettingsCommonContracts, ci: ChainInfo): CollateralType[] {
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
        collateralClass: CollateralClass.VAULT,
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
        collateralClass: CollateralClass.VAULT,
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

export type TestFtsos = Record<'nat' | 'usdc' | 'usdt' | 'asset', FtsoMockInstance>;

export async function createTestFtsos(ftsoRegistry: FtsoRegistryMockInstance, assetChainInfo: TestChainInfo): Promise<TestFtsos> {
    return {
        nat: await createFtsoMock(ftsoRegistry, "NAT", 0.42),
        usdc: await createFtsoMock(ftsoRegistry, "USDC", 1.01),
        usdt: await createFtsoMock(ftsoRegistry, "USDT", 0.99),
        asset: await createFtsoMock(ftsoRegistry, assetChainInfo.symbol, assetChainInfo.startPrice),
    };
}

let poolTokenSymbolCounter = 0;

export function createTestAgentSettings(vaultCollateralTokenAddress: string, options?: Partial<AgentSettings>): AgentSettings {
    const defaults: AgentSettings = {
        vaultCollateralToken: vaultCollateralTokenAddress,
        poolTokenSuffix: `AGNT${++poolTokenSymbolCounter}`,
        feeBIPS: toBIPS("10%"),
        poolFeeShareBIPS: toBIPS("40%"),
        mintingVaultCollateralRatioBIPS: toBIPS(1.6),
        mintingPoolCollateralRatioBIPS: toBIPS(2.5),
        poolExitCollateralRatioBIPS: toBIPS(2.6),
        buyFAssetByAgentFactorBIPS: toBIPS(0.9),
        poolTopupCollateralRatioBIPS: toBIPS(2.1),
        poolTopupTokenPriceFactorBIPS: toBIPS(0.8),
        handshakeType: 0,
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
    // create FdcHub
    const fdcHub = await FdcHub.new();
    // create Relay
    const relay = await Relay.new();
    // create attestation client
    const fdcVerification = await FdcVerification.new(relay.address, 200);
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
        ["GovernanceSettings", "AddressUpdater", "FdcHub", "Relay", "FdcVerification", "FtsoRegistry", "WNat"],
        [governanceSettings.address, addressUpdater.address, fdcHub.address, relay.address, fdcVerification.address, ftsoRegistry.address, wNat.address],
        { from: governance });
    // create price reader
    const priceReader = await PriceReader.new(addressUpdater.address, ftsoRegistry.address);
    // create agent vault factory
    const agentVaultImplementation = await AgentVault.new(ZERO_ADDRESS);
    const agentVaultFactory = await AgentVaultFactory.new(agentVaultImplementation.address);
    // create collateral pool factory
    const collateralPoolImplementation = await CollateralPool.new(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, 0, 0, 0);
    const collateralPoolFactory = await CollateralPoolFactory.new(collateralPoolImplementation.address);
    // create collateral pool token factory
    const collateralPoolTokenImplementation = await CollateralPoolToken.new(ZERO_ADDRESS, "", "");
    const collateralPoolTokenFactory = await CollateralPoolTokenFactory.new(collateralPoolTokenImplementation.address);
    // create allow-all agent whitelist
    const agentOwnerRegistry = await AgentOwnerRegistry.new(governanceSettings.address, governance, true);
    await agentOwnerRegistry.setAllowAll(true, { from: governance });
    //
    return {
        governanceSettings, addressUpdater, agentVaultFactory, collateralPoolFactory, collateralPoolTokenFactory, relay, fdcHub, fdcVerification,
        priceReader, agentOwnerRegistry, ftsoRegistry, wNat, stablecoins };
}

export async function assignCoreVaultManager(assetManager: IIAssetManagerInstance, addressUpdater: AddressUpdaterInstance, settings: CoreVaultManagerInitSettings)
{
    const coreVaultManagerImpl = await CoreVaultManager.new();
    const assetManagerSettings = await assetManager.getSettings();
    const governanceSettings = await assetManager.governanceSettings();
    const governance = await assetManager.governance();
    const coreVaultManagerProxy = await CoreVaultManagerProxy.new(coreVaultManagerImpl.address, governanceSettings, governance, addressUpdater.address,
        assetManager.address, assetManagerSettings.chainId, settings.custodianAddress, settings.underlyingAddress, settings.initialNonce);
    const coreVaultManager = await CoreVaultManager.at(coreVaultManagerProxy.address);
    await addressUpdater.updateContractAddresses([coreVaultManager.address], { from: governance });
    await coreVaultManager.updateSettings(settings.escrowEndTimeSeconds, settings.escrowAmount, settings.minimalAmountLeft, settings.chainPaymentFee, { from: governance });
    await coreVaultManager.addTriggeringAccounts(settings.triggeringAccounts, { from: governance });
    await waitForTimelock(assetManager.setCoreVaultManager(coreVaultManager.address, { from: governance }), assetManager, governance);
    return coreVaultManager;
}

export interface CreateTestAgentDeps {
    assetManager: IIAssetManagerInstance;
    settings: AssetManagerSettings;
    chain?: MockChain;
    wallet?: MockChainWallet;
    attestationProvider: AttestationHelper;
}

export async function createTestAgent(deps: CreateTestAgentDeps, owner: string, underlyingAddress: string, vaultCollateralTokenAddress: string, options?: Partial<AgentSettings>) {
    if (deps.settings.requireEOAAddressProof) {
        if (!deps.chain || !deps.wallet) throw new Error("Missing chain data for EOA proof");
        // mint some funds on underlying address (just enough to make EOA proof)
        deps.chain.mint(underlyingAddress, 101);
        // create and prove transaction from underlyingAddress
        const txHash = await deps.wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(owner), { maxFee: 100 });
        const proof = await deps.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
        await deps.assetManager.proveUnderlyingAddressEOA(proof, { from: owner });
    }
    // validate underlying address
    const addressValidityProof = await deps.attestationProvider.proveAddressValidity(underlyingAddress);
    // create agent
    const agentSettings = createTestAgentSettings(vaultCollateralTokenAddress, options);
    const response = await deps.assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings), { from: owner });
    // extract agent vault address from AgentVaultCreated event
    const event = findRequiredEvent(response, 'AgentVaultCreated');
    const agentVaultAddress = event.args.agentVault;
    // get vault contract at this address
    return await AgentVault.at(agentVaultAddress);
}
