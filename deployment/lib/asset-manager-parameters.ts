// Mapped to integer in JSON schema.
type integer = number;

export interface CollateralTypeParameters {
    /**
     * The ERC20 token contract for this collateral type.
     * Can be an address (0x...) or a name of a contract in contracts.json.
     * @pattern ^\w+$
     */
    token: string;

    /**
     * Same as token.decimals(), when that exists.
     * @minimum 0
     */
    decimals: integer;

    /**
     * When `true`, the FTSO with symbol `assetFtsoSymbol` returns asset price relative to this token
     * (such FTSO's will probably exist for major stablecoins).
     * When `false`, the FTSOs with symbols `assetFtsoSymbol` and `tokenFtsoSymbol` give asset and token
     * price relative to the same reference currency and the asset/token price is calculated as their ratio.
     */
    directPricePair: boolean;

    /**
     * FTSO symbol for the asset, relative to this token or a reference currency
     * (it depends on the value of `directPricePair`).
     * @pattern ^\w+$
     */
    assetFtsoSymbol: string;

    /**
     * FTSO symbol for this token in reference currency.
     * Used for asset/token price calculation when `directPricePair` is `false`.
     * Otherwise it is irrelevant to asset/token price calculation, but is still used
     * in calculation of challenger rewards, confirmation rewards and token burning.
     * @pattern ^\w+$
     */
    tokenFtsoSymbol: string;

    /**
     * Minimum collateral ratio for healthy agents.
     * @minimum 0
     */
    minCollateralRatioBIPS: integer;

    /**
     * Minimum collateral ratio for agent in CCB (Collateral call band).
     * If the agent's collateral ratio is less than this, skip the CCB and go straight to liquidation.
     * A bit smaller than minCollateralRatioBIPS.
     * @minimum 0
     */
    ccbMinCollateralRatioBIPS: integer;

    /**
     * Minimum collateral ratio required to get agent out of liquidation.
     * Will always be greater than minCollateralRatioBIPS.
     * @minimum 0
     */
    safetyMinCollateralRatioBIPS: integer;
}

export interface AssetManagerParameters {
    /**
     * JSON schema url
     */
    $schema?: string;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Common parameters (for all f-assets in this network)

    /**
     * Address for burning native currency (e.g. for collateral reservation fee afetr successful minting).
     * @pattern ^0x[0-9a-fA-F]{40}$
     */
    burnAddress: string;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    // F-asset (chain) specific parameters

    /**
     * Chain id as used in the state connector.
     * @minimum 0
     */
    chainId: integer;

    /**
     * Name of the original asset on the underlying chain.
     */
    assetName: string;

    /**
     * Symbol for the original asset on the underlying chain.
     * @pattern ^\w+$
     */
    assetSymbol: string;

    /**
     * The number of decimals in asset.
     * @minimum 0
     */
    assetDecimals: integer;

    /**
     * The name of the f-asset.
     */
    fAssetName: string;

    /**
     * The symbol for the f-asset.
     * @pattern ^\w+$
     */
    fAssetSymbol: string;

    /**
     * The number of decimals of precision for minting.
     * Usually it is the same as assetDecimals (e.g. 8 for BTC).
     * But for some asset types e.g. ethereum, the number of asset decimals is 18, so we internally
     * manage all mintings with a smaller number of decimals (e.g. 9).
     * The maximum number of decimals must be such that the total supply of fasset will never
     * exceed 64bit when expressed as fixed point with this many decimals (this allows for storage optimization).
     * @minimum 0
     */
    assetMintingDecimals: integer;

    /**
     * If non-null, the whitelist contains a list of accounts that can call public methods
     * (minting, redeeming, challenging, etc.)
     * Can be a contract address (0x...) or a name in contracts.json.
     * @pattern ^\w+$
     */
    whitelist: string | null;

    /**
     * If non-null, the whitelist contains a list of allowed agent owners.
     * Can be a contract address (0x...) or a name in contracts.json.
     * @pattern ^\w+$
     */
    agentWhitelist: string | null;

    /**
     * Underlying address validator in format `[artifactName, constructorParameters]`.
     * Each asset manager gets its own instance of underlying address validator.
     */
    underlyingAddressValidator: [string, any[]];

    /**
     * Liquidation strategy factory name from `deployment/lib/liquidationStrategyFactory`
     * (will be deployed automatically if needed).
     * @pattern ^\w+$
     */
    liquidationStrategy: string;

    /**
     * Liquidation strategy initial settings.
     */
    liquidationStrategySettings: any;

    /**
     * Data about the collateral used in the collateral pool, token is always WNat (FLR/SGB).
     */
    poolCollateral: CollateralTypeParameters;

    /**
     * The data about allowed class1 collateral types.
     */
    class1Collaterals: CollateralTypeParameters[];

    /**
     * The percentage of minted f-assets that the agent must hold in his underlying address.
     * @minimum 0
     * @maximum 10000
     */
    minUnderlyingBackingBIPS: integer;

    /**
     * Maximum minted amount of the f-asset, in base unit of underlying asset.
     * @pattern ^[0-9 ]+$
     */
    mintingCap: string;

    /**
     * Lot size in base unit of underlying asset (e.g. satoshi or wei).
     * May change, which affects subsequent mintings and redemptions.
     * @pattern ^[0-9 ]+$
     */
    lotSize: string;

    /**
     * For some chains (e.g. Ethereum) we require that agent proves that underlying address is an EOA address.
     * This must be done by presenting a payment proof from that address.
     */
    requireEOAAddressProof: boolean;

    /**
     * Collateral reservation fee that must be paid by the minter.
     * Payment is in NAT, but is proportional to the value of assets to be minted.
     * @minimum 0
     */
    collateralReservationFeeBIPS: integer;

    /**
     * The minimum amount of pool tokens the agent must hold to be able to mint.
     * To be able to mint, the NAT value of all backed fassets together with new ones times this percentage
     * must be smaller than the agent's pool tokens' amount converted to NAT.
     * @minimum 0
     */
    mintingPoolHoldingsRequiredBIPS: integer;

    /**
     * To prevent unbounded work, the number of tickets redeemed in a single request is limited.
     * @minimum 1
     */
    maxRedeemedTickets: integer;

    /**
     * Redemption fee as percentage of the redemption amount.
     * @minimum 0
     */
    redemptionFeeBIPS: integer;

    /**
     * On redemption underlying payment failure, redeemer is compensated with
     * redemption value recalculated times redemption failure factor.
     * This is the part of factor paid from agent's class 1 collateral.
     * @minimum 0
     */
    redemptionDefaultFactorClass1BIPS: integer;

    /**
     * On redemption underlying payment failure, redeemer is compensated with
     * redemption value recalculated times redemption failure factor.
     * This is the part of factor paid from pool in FLR/SGB.
     * @minimum 0
     */
    redemptionDefaultFactorPoolBIPS: integer;

    /**
     * Number of underlying blocks that the minter or agent is allowed to pay underlying value.
     * If payment not reported in that time, minting/redemption can be challenged and default action triggered.
     * CAREFUL: Count starts from the current proved block height, so the minters and agents should
     * make sure that current block height is fresh, otherwise they might not have enough time for payment.
     * @minimum 0
     */
    underlyingBlocksForPayment: integer;

    /**
     * Minimum time to allow agent to pay for redemption or minter to pay for minting.
     * This is useful for fast chains, when there can be more than one block per second.
     * Redemption/minting payment failure can be called only after underlyingSecondsForPayment have elapsed
     * on underlying chain.
     * CAREFUL: Count starts from the current proved block timestamp, so the minters and agents should
     * make sure that current block timestamp is fresh, otherwise they might not have enough time for payment.
     * This is partially mitigated by adding local duration since the last block height update to
     * the current underlying block timestamp.
     * @minimum 0
     */
    underlyingSecondsForPayment: integer;

    /**
     * Maximum time for which it is possible to obtain payment or non-payment proofs.
     * @minimum 0
     */
    attestationWindowSeconds: integer;

    /**
     * Average time between two successive blocks on the underlying chain, in milliseconds.
     * @minimum 0
     */
    averageBlockTimeMS: integer;

    /**
     * If the agent or redeemer becomes unresponsive, we still need payment or non-payment confirmations
     * to be presented eventually to properly track agent's underlying balance.
     * Therefore we allow anybody to confirm payments/non-payments this many seconds after request was made.
     * @minimum 0
     */
    confirmationByOthersAfterSeconds: integer;

    /**
     * The user who makes abandoned redemption confirmations gets rewarded by the following amount.
     * The payment is in agent's class1 currency, converted from the usd amount in this setting.
     * @pattern ^[0-9 ]+$
     */
    confirmationByOthersRewardUSD5: string;

    /**
     * Challenge reward can be composed of two part - fixed and proportional (any of them can be zero).
     * The payment is in agent's class1 currency. This is the proportional part (in BIPS).
     * @minimum 0
     */
    paymentChallengeRewardBIPS: integer;

    /**
     * Challenge reward can be composed of two part - fixed and proportional (any of them can be zero).
     * The payment is in agent's class1 currency. This is the fixed part, converted from the usd amount in this setting.
     * @pattern ^[0-9 ]+$
     */
    paymentChallengeRewardUSD5: string;

    /**
     * Agent can remain in CCB for this much time, after that liquidation starts automatically.
     * @minimum 0
     */
    ccbTimeSeconds: integer;

    /**
     * Maximum age that trusted price feed is valid.
     * Otherwise (if there were no trusted votes for that long) just use generic ftso price feed.
     * @minimum 0
     */
    maxTrustedPriceAgeSeconds: integer;

    /**
     * Agent has to announce any collateral withdrawal ar vault destroy and then wait for at least
     * withdrawalWaitMinSeconds. This prevents challenged agent to remove all collateral before
     * challenge can be proved.
     * @minimum 0
     */
    withdrawalWaitMinSeconds: integer;

    /**
     * Minimum time that has to pass between underlying withdrawal announcement and the confirmation.
     * Any value is ok, but higher values give more security agains multiple announcement attack by a miner.
     * Shouldn't be much bigger than state connector response time, so that payments can be confirmed without
     * extra wait. Should be smaller than confirmationByOthersAfterSeconds (e.g. less than 1 hour).
     * @minimum 0
     */
    announcedUnderlyingConfirmationMinSeconds: integer;

    /**
     * Ratio at which the agents can buy back their collateral when f-asset is terminated.
     * Typically a bit more than 1 to incentivise agents to buy f-assets and self-close instead.
     * @minimum 0
     */
    buybackCollateralFactorBIPS: integer;

    /**
     * On some rare occasions (stuck minting, locked fassets after termination), the agent has to unlock
     * collateral. For this, part of collateral corresponding to FTSO asset value is burned and the rest is released.
     * However, we cannot burn typical class1 collateral (stablecoins), so the agent must buy them for NAT
     * at FTSO price multiplied with this factor (should be a bit above 1) and then we burn the NATs.
     * @minimum 0
     */
    class1BuyForFlareFactorBIPS: integer;

    /**
     * Minimum time after an update of a setting before the same setting can be updated again.
     * @minimum 0
     */
    minUpdateRepeatTimeSeconds: integer;

    /**
     * Minimum time from the moment token is deprecated to when it becomes invalid and agents still using
     * it as class1 get liquidated.
     * @minimum 0
     */
    tokenInvalidationTimeMinSeconds: integer;

    /**
     * Amount of seconds that have to pass between available list exit announcement and execution.
     * @minimum 0
     */
    agentExitAvailableTimelockSeconds: integer;

    /**
     * Amount of seconds that have to pass between agent fee and pool fee share change announcement and execution.
     * @minimum 0
     */
    agentFeeChangeTimelockSeconds: integer;

    /**
     * Amount of seconds that have to pass between agent-set collateral ratio (minting, pool exit)
     * change announcement and execution.
     * @minimum 0
     */
    agentCollateralRatioChangeTimelockSeconds: integer;
}
