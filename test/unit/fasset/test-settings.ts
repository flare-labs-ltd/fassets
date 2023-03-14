import { constants } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralToken, CollateralTokenClass } from "../../../lib/fasset/AssetManagerTypes";
import { LiquidationStrategyImplSettings } from "../../../lib/fasset/LiquidationStrategyImpl";
import { DAYS, Dict, HOURS, MINUTES, toBIPS, toBNExp } from "../../../lib/utils/helpers";
import { AgentVaultFactoryInstance, AttestationClientSCInstance, CollateralPoolFactoryInstance, IAddressValidatorInstance, IERC20Instance, IFtsoRegistryInstance, IWhitelistInstance, IWNatInstance, WNatInstance } from "../../../typechain-truffle";

export const GENESIS_GOVERNANCE = "0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7";

export interface TestSettingsContracts {
    agentVaultFactory: AgentVaultFactoryInstance;
    collateralPoolFactory: CollateralPoolFactoryInstance;
    attestationClient: AttestationClientSCInstance;
    addressValidator: IAddressValidatorInstance;
    whitelist?: IWhitelistInstance;
    agentWhitelist?: IWhitelistInstance;
    ftsoRegistry: IFtsoRegistryInstance;
    liquidationStrategy: string; // lib address
    wNat: WNatInstance,
    stablecoins: Dict<IERC20Instance>
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
