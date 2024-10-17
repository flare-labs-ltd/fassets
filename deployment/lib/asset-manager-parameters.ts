import { int } from "hardhat/internal/core/params/argumentTypes";

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
     * Address for burning native currency (e.g. for collateral reservation fee after successful minting).
     * @pattern ^0x[0-9a-fA-F]{40}$
     */
    burnAddress: string;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Contracts - may be shared between asset managers. Most have sensible defaults.

    /**
     * The asset manager controller which manages all the asset manager settings.
     * Can be a contract address (0x...) or a name in contracts.json.
     * Optional, default is 'AssetManagerController' in contracts.json.
     * @pattern ^\w+$
     */
    assetManagerController?: string;

    /**
     * The factory contract for creating agent vaults.
     * Can be a contract address (0x...) or a name in contracts.json.
     * Optional, default is 'AgentVaultFactory' in contracts.json.
     * @pattern ^\w+$
     */
    agentVaultFactory?: string;

    /**
     * The factory contract for creating agent collateral pools.
     * Can be a contract address (0x...) or a name in contracts.json.
     * Optional, default is 'CollateralPoolFactory' in contracts.json.
     * @pattern ^\w+$
     */
    collateralPoolFactory?: string;

    /**
     * The factory contract for creating agent collateral pools.
     * Can be a contract address (0x...) or a name in contracts.json.
     * Optional, default is 'CollateralPoolTokenFactory' in contracts.json.
     * @pattern ^\w+$
     */
    collateralPoolTokenFactory?: string;

    /**
     * The proof verifier contract for state connector proofs.
     * Can be a contract address (0x...) or a name in contracts.json.
     * Optional, default is 'SCProofVerifier' in contracts.json.
     * @pattern ^\w+$
     */
    scProofVerifier?: string;

    /**
     * Price reader contract is a simple abstraction of FTSO system.
     * Can be a contract address (0x...) or a name in contracts.json.
     * Optional, default is 'SCProofVerifier' in contracts.json.
     * @pattern ^\w+$
     */
    priceReader?: string;

    /**
     * The agent whitelist contains a list of allowed agent owners.
     * Can be a contract address (0x...) or a name in contracts.json.
     * Optional, default is 'AgentOwnerRegistry' in contracts.json.
     * @pattern ^\w+$
     */
    agentOwnerRegistry?: string;

    /**
     * If non-null, the whitelist contains a list of accounts that can call public methods
     * (minting, redeeming, challenging, etc.)
     * If null, there will be no user whitelisting.
     * Can be a contract address (0x...) or a name in contracts.json.
     * @pattern ^\w+$
     */
    userWhitelist: string | null;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////
    // F-asset (chain) specific parameters

    /**
     * Chain name; must match the state connector chainId, when encoded as bytes.
     * @minimum 0
     */
    chainName: string;

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
     * The suffix to pool token name and symbol that identifies new vault's collateral pool token.
     * When vault is created, the owner passes own suffix which will be appended to this.
     */
    poolTokenSuffix: string;

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
     * Data about the collateral used in the collateral pool, token is always WNat (FLR/SGB).
     */
    poolCollateral: CollateralTypeParameters;

    /**
     * The data about allowed vault collateral types.
     */
    vaultCollaterals: CollateralTypeParameters[];

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
     * This is the part of factor paid from agent's vault collateral.
     * @minimum 0
     */
    redemptionDefaultFactorVaultCollateralBIPS: integer;

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
     * The payment is in agent's vault collateral tokens, converted from the usd amount in this setting.
     * @pattern ^[0-9 ]+$
     */
    confirmationByOthersRewardUSD5: string;

    /**
     * Challenge reward can be composed of two part - fixed and proportional (any of them can be zero).
     * The payment is in agent's vault collateral tokens. This is the proportional part (in BIPS).
     * @minimum 0
     */
    paymentChallengeRewardBIPS: integer;

    /**
     * Challenge reward can be composed of two part - fixed and proportional (any of them can be zero).
     * The payment is in agent's vault collateral tokens. This is the fixed part, converted from
     * the usd amount in this setting.
     * @pattern ^[0-9 ]+$
     */
    paymentChallengeRewardUSD5: string;

    /**
     * Agent can remain in CCB for this much time, after that liquidation starts automatically.
     * @minimum 0
     */
    ccbTimeSeconds: integer;

    /**
     * If there was no liquidator for the current liquidation offer,
     * go to the next step of liquidation after a certain period of time.
     * @minimum 1
     */
    liquidationStepSeconds: integer;

    /**
     * Factor with which to multiply the asset price in native currency to obtain the payment to the liquidator.
     * Expressed in BIPS, e.g. [12000, 16000, 20000] means that the liquidator will be paid 1.2, 1.6 and 2.0
     * times the market price of the liquidated assets after each `liquidationStepSeconds`.
     * Values in the array must increase and be greater than 100%.
     */
    liquidationCollateralFactorBIPS: integer[];

    /**
     * How much of the liquidation is paid in vault collateral.
     * Expressed in BIPS relative to the liquidated FAsset value at current price.
     * The remainder will be paid in pool NAT collateral.
     */
    liquidationFactorVaultCollateralBIPS: integer[];

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
     * Any value is ok, but higher values give more security against multiple announcement attack by a miner.
     * Shouldn't be much bigger than state connector response time, so that payments can be confirmed without
     * extra wait. Should be smaller than confirmationByOthersAfterSeconds (e.g. less than 1 hour).
     * @minimum 0
     */
    announcedUnderlyingConfirmationMinSeconds: integer;

    /**
     * Ratio at which the agents can buy back their collateral when f-asset is terminated.
     * Typically a bit more than 1 to incentivize agents to buy f-assets and self-close instead.
     * @minimum 0
     */
    buybackCollateralFactorBIPS: integer;

    /**
     * On some rare occasions (stuck minting, locked fassets after termination), the agent has to unlock
     * collateral. For this, part of collateral corresponding to FTSO asset value is burned and the rest is released.
     * However, we cannot burn typical vault collateral (stablecoins), so the agent must buy them for NAT
     * at FTSO price multiplied with this factor (should be a bit above 1) and then we burn the NATs.
     * @minimum 0
     */
    vaultCollateralBuyForFlareFactorBIPS: integer;

    /**
     * Minimum time after an update of a setting before the same setting can be updated again.
     * @minimum 0
     */
    minUpdateRepeatTimeSeconds: integer;

    /**
     * Minimum time from the moment token is deprecated to when it becomes invalid and agents still using
     * it as vault collateral get liquidated.
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
     * Amount of seconds that have to pass between agent-set minting collateral ratio (vault or pool)
     * change announcement and execution.
     * @minimum 0
     */
    agentMintingCRChangeTimelockSeconds: integer;

    /**
     * Amount of seconds that have to pass between agent-set settings for pool exit and topup
     * (exit CR, topup CR, topup bonus) change announcement and execution.
     * @minimum 0
     */
    poolExitAndTopupChangeTimelockSeconds: integer;

    /**
     * Amount of seconds that an agent is allowed to execute an update once it is allowed.
     * @minimum 60
     */
    agentTimelockedOperationWindowSeconds: integer;

    /**
     * Amount of seconds that a collateral pool enterer must wait before spending obtained tokens.
     */
    collateralPoolTokenTimelockSeconds: integer;

    /**
     * When there are many redemption requests in short time, agent gets
     * up to this amount of extra payment time per redemption.
     */
    redemptionPaymentExtensionSeconds: integer;

    /**
     * Minimum time that the system must wait before performing diamond cut.
     * The actual timelock is the maximum of this setting and GovernanceSettings.timelock.
     */
    diamondCutMinTimelockSeconds: integer;

    /**
     * The maximum total pause that can be triggered by non-governance (but governance allowed) caller.
     * The duration count can be reset by the governance.
     */
    maxEmergencyPauseDurationSeconds: integer;

    /**
     * The amount of time since last emergency pause after which the total pause duration counter
     * will reset automatically.
     */
    emergencyPauseDurationResetAfterSeconds: integer;

    /**
     * The amount of time after which the collateral reservation can be cancelled if the
     * hand-shake is not completed.
     * @minimum 1
     */
    cancelCollateralReservationAfterSeconds: integer;

    /**
     * Time window inside which the agent can reject the redemption request.
     * @minimum 1
     */
    rejectRedemptionRequestWindowSeconds: integer;

    /**
     * Time window inside which the agent can take over the redemption request from another agent
     * that has rejected it.
     * @minimum 1
     */
    takeOverRedemptionRequestWindowSeconds: integer;

    /**
     * On redemption rejection, without take over, redeemer is compensated with
     * redemption value recalculated in flare/sgb times redemption failure factor.
     * Expressed in BIPS, e.g. 12000 for factor of 1.2.
     * This is the part of factor paid from agent's vault collateral.
     * @minimum 0
     */
    rejectedRedemptionDefaultFactorVaultCollateralBIPS: integer;

    /**
     * This is the part of rejected redemption factor paid from agent's pool collateral.
     * @minimum 0
     */
    rejectedRedemptionDefaultFactorPoolBIPS: integer;
}
