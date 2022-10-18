// Mapped to integer in JSON schema.
type integer = number;

export interface AssetManagerParameters {
    /**
     * JSON schema url
     */
    $schema?: string;
    
    /**
     * Chain id as used in the state connector.
     * immutable
     */
    chainId: integer;

    /**
     * Name of the original asset on the underlying chain.
     */
    assetName: string;

    /**
     * Symbol for the original asset on the underlying chain.
     * Must match the FTSO contract symbol for the asset.
     */
    assetSymbol: string;

    /**
     * The number of decimals
     */
    assetDecimals: integer;

    /**
     * The name of the f-asset.
     */
    fAssetName: string;

    /**
     * The symbol for the f-asset.
     */
    fAssetSymbol: string;

    /**
     * Collateral reservation fee that must be paid by the minter.
     * Payment is in NAT, but is proportional to the value of assets to be minted.
     */
    collateralReservationFeeBIPS: integer;

    /**
     * Lot size in base unit of underlying asset (e.g. wei or satoshi). 
     * May change, which affects subsequent mintings and redemptions.
     * rate-limited
     */
    lotSize: string;

    /**
     * The value of AMG (asset minting granularity) in underlying base units (UBA).
     * Lot size and redemption ticket sizes will always be rounded down to a whole number of AMG
     * (the same holds for the amounts in self-close and liquidate, which are not limited to whole number of lots).
     * Can only be changed via redeploy of AssetManager.
     * AMG is used internally instead of UBA so that minted quantities fit into 64bits to reduce storage.
     * So assetMintingGranularityUBA should be set so that the max supply in AMG of this currency
     * in foreseeable time (say 100yr) cannot overflow 64 bits.
     * Wiil be 1 for most non-smart contract chains, but may be more for e.g. Ethereum, which has 18 decimals.
     */
    assetMintingGranularityUBA: string;

    /**
     * Maximum age that trusted price feed is valid.
     * Otherwise (if there were no trusted votes for that long) just use generic ftso price feed.
     * rate-limited
     */
    maxTrustedPriceAgeSeconds: integer;

    /**
     * For some chains (e.g. Ethereum) we require that agent proves that underlying address is an EOA address.
     * This must be done by presenting a payment proof from that address.
     * immutable
     */
    requireEOAAddressProof: boolean;

    /**
     * Minimum collateral ratio for healthy agents.
     * timelocked
     */
    minCollateralRatioBIPS: integer;

    /**
     * Minimum collateral ratio for agent in CCB (Collateral call band).
     * A bit smaller than minCollateralRatioBIPS.
     * timelocked
     */
    ccbMinCollateralRatioBIPS: integer;

    /**
     * Minimum collateral ratio required to get agent out of liquidation.
     * If the agent's collateral ratio is less than this, skip the CCB and go straight to liquidation.
     * Wiil always be greater than minCollateralRatioBIPS.
     * timelocked
     */
    safetyMinCollateralRatioBIPS: integer;

    /**
     * Number of underlying blocks that the minter or agent is allowed to pay underlying value.
     * If payment not reported in that time, minting/redemption can be challenged and default action triggered.
     * CAREFUL: Count starts from the current proved block height, so the minters and agents should 
     * make sure that current block height is fresh, otherwise they might not have enough time for payment.
     * timelocked
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
     * timelocked
     */
    underlyingSecondsForPayment: integer;

    /**
     * Redemption fee as percentage of the redemption amount.
     * rate-limited
     */
    redemptionFeeBIPS: integer;

    /**
     * On redemption underlying payment failure, redeemer is compensated with
     * redemption value recalculated in flare/sgb times redemption failure factor.
     * Expressed in BIPS, e.g. 12000 for factor of 1.2.
     * rate-limited
     * @minimum 10000
     */
    redemptionDefaultFactorBIPS: integer;

    /**
     * If the agent or redeemer becomes unresponsive, we still need payment or non-payment confirmations
     * to be presented eventually to properly track agent's underlying balance.
     * Therefore we allow anybody to confirm payments/non-payments this many seconds after request was made.
     * rate-limited
     */
    confirmationByOthersAfterSeconds: integer;

    /**
     * The user who makes abandoned redemption confirmations gets rewarded by the following amount.
     * rate-limited
     */
    confirmationByOthersRewardNATWei: string;

    /**
     * To prevent unbounded work, the number of tickets redeemed in a single request is limited.
     * rate-limited
     * @minimum 1
     */
    maxRedeemedTickets: integer;

    /**
     * Challenge reward can be composed of two part - fixed and proportional (any of them can be zero).
     * This is the proportional part (in BIPS).
     * rate-limited
     */
    paymentChallengeRewardBIPS: integer;

    /**
     * Challenge reward can be composed of two part - fixed and proportional (any of them can be zero).
     * This is the fixed part (in underlying AMG, so that we can easily set it as some percent of lot size).
     * rate-limited
     */
    paymentChallengeRewardNATWei: string;

    /**
     * Agent has to announce any collateral withdrawal ar vault destroy and then wait for at least 
     * withdrawalWaitMinSeconds. This prevents challenged agent to remove all collateral before 
     * challenge can be proved.
     * rate-limited
     */
    withdrawalWaitMinSeconds: integer;

    /**
     * Factor with which to multiply the asset price in native currency to obtain the payment
     * to the liquidator.
     * Expressed in BIPS, e.g. [12000, 16000, 20000] means that the liquidator will be paid 1.2, 1.6 and 2.0
     * times the market price of the liquidated assets.
     * Values in array must increase and be greater than 100%.
     * rate-limited
     */
    liquidationCollateralFactorBIPS: integer[];

    /**
     * Agent can remain in CCB for this much time, after that liquidation starts automatically.
     * rate-limited
     */
    ccbTimeSeconds: integer;

    /**
     * If there was no liquidator for the current liquidation offer, 
     * go to the next step of liquidation after a certain period of time.
     * rate-limited
     */
    liquidationStepSeconds: integer;

    /**
     * Maximum time for which it is possible to obtain payment or non-payment proofs.
     * rate-limited
     */
    attestationWindowSeconds: integer;

    /**
     * Minimum time after an update of a setting before the same setting can be updated again.
     * immutable
     */
    minUpdateRepeatTimeSeconds: integer;

    /**
     * Ratio at which the agents can buy back their collateral when f-asset is terminated.
     * Typically a bit more than 1 to incentivise agents to buy f-assets and self-close instead.
     * immutable
     */
    buybackCollateralFactorBIPS: integer;

    /**
     * Minimum time that has to pass between underlying withdrawal announcement and the confirmation.
     * Any value is ok, but higher values give more security agains multiple announcement attack by a miner.
     * Shouldn't be much bigger than state connector response time, so that payments can be confirmed without 
     * extra wait. Should be smaller than confirmationByOthersAfterSeconds (e.g. less than 1 hour).
     */
    announcedUnderlyingConfirmationMinSeconds: integer;
}
