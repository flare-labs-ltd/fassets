// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * All asset manager events.
 */
interface IAssetManagerEvents {
    struct AgentVaultCreationData {
        address collateralPool;
        address collateralPoolToken;
        string underlyingAddress;
        address vaultCollateralToken;
        address poolWNatToken;
        uint256 feeBIPS;
        uint256 poolFeeShareBIPS;
        uint256 mintingVaultCollateralRatioBIPS;
        uint256 mintingPoolCollateralRatioBIPS;
        uint256 buyFAssetByAgentFactorBIPS;
        uint256 poolExitCollateralRatioBIPS;
        uint256 poolTopupCollateralRatioBIPS;
        uint256 poolTopupTokenPriceFactorBIPS;
        uint256 handshakeType;
    }

    /**
     * A new agent vault was created.
     */
    event AgentVaultCreated(
        address indexed owner,
        address indexed agentVault,
        AgentVaultCreationData creationData);

    /**
     * Agent has announced destroy (close) of agent vault and will be able to
     * perform destroy after the timestamp `destroyAllowedAt`.
     */
    event AgentDestroyAnnounced(
        address indexed agentVault,
        uint256 destroyAllowedAt);

    /**
     * Agent has destroyed (closed) the agent vault.
     */
    event AgentDestroyed(
        address indexed agentVault);

    /**
     * Agent has announced a withdrawal of collateral and will be able to
     * withdraw the announced amount after timestamp `withdrawalAllowedAt`.
     * If withdrawal was canceled (announced with amount 0), amountWei and withdrawalAllowedAt are zero.
     */
    event VaultCollateralWithdrawalAnnounced(
        address indexed agentVault,
        uint256 amountWei,
        uint256 withdrawalAllowedAt);

    /**
     * Agent has announced a withdrawal of collateral and will be able to
     * redeem the announced amount of pool tokens after the timestamp `withdrawalAllowedAt`.
     * If withdrawal was canceled (announced with amount 0), amountWei and withdrawalAllowedAt are zero.
     */
    event PoolTokenRedemptionAnnounced(
        address indexed agentVault,
        uint256 amountWei,
        uint256 withdrawalAllowedAt);

    /**
     * Agent was added to the list of available agents and can accept collateral reservation requests.
     */
    event AgentAvailable(
        address indexed agentVault,
        uint256 feeBIPS,
        uint256 mintingVaultCollateralRatioBIPS,
        uint256 mintingPoolCollateralRatioBIPS,
        uint256 freeCollateralLots);

    /**
     * Agent exited from available agents list.
     * The agent can exit the available list after the timestamp `exitAllowedAt`.
     */
    event AvailableAgentExitAnnounced(
        address indexed agentVault,
        uint256 exitAllowedAt);

    /**
     * Agent exited from available agents list.
     */
    event AvailableAgentExited(
        address indexed agentVault);

    /**
     * Agent has initiated setting change (fee or some agent collateral ratio change).
     * The setting change can be executed after the timestamp `validAt`.
     */
    event AgentSettingChangeAnnounced(
        address indexed agentVault,
        string name,
        uint256 value,
        uint256 validAt);

    /**
     * Agent has executed setting change (fee or some agent collateral ratio change).
     */
    event AgentSettingChanged(
        address indexed agentVault,
        string name,
        uint256 value);

    /**
     * Agent or agent's collateral pool has changed token contract.
     */
    event AgentCollateralTypeChanged(
        address indexed agentVault,
        uint8 collateralClass,
        address token);

    /**
     * Minter reserved collateral, paid the reservation fee. Agent's collateral was reserved.
     * Agent needs to approve or reject the reservation according to the minter's identity.
     */
    event HandshakeRequired(
        address indexed agentVault,
        address indexed minter,
        uint256 indexed collateralReservationId,
        string[] minterUnderlyingAddresses,
        uint256 valueUBA,
        uint256 feeUBA);

    /**
     * Minter reserved collateral, paid the reservation fee, and is expected to pay the underlying funds.
     * Agent's collateral was reserved.
     */
    event CollateralReserved(
        address indexed agentVault,
        address indexed minter,
        uint256 indexed collateralReservationId,
        uint256 valueUBA,
        uint256 feeUBA,
        uint256 firstUnderlyingBlock,
        uint256 lastUnderlyingBlock,
        uint256 lastUnderlyingTimestamp,
        string paymentAddress,
        bytes32 paymentReference,
        address executor,
        uint256 executorFeeNatWei);

    /**
     * Agent rejected the collateral reservation request because of the minter's identity.
     * Reserved collateral was released.
     */
    event CollateralReservationRejected(
        address indexed agentVault,
        address indexed minter,
        uint256 indexed collateralReservationId);

    /**
     * Minter cancelled the collateral reservation request because of the agent's inactivity.
     * Reserved collateral was released.
     */
    event CollateralReservationCancelled(
        address indexed agentVault,
        address indexed minter,
        uint256 indexed collateralReservationId);

    /**
     * Minter paid underlying funds in time and received the fassets.
     * The agent's collateral is locked.
     */
    event MintingExecuted(
        address indexed agentVault,
        uint256 indexed collateralReservationId,
        uint256 mintedAmountUBA,
        uint256 agentFeeUBA,
        uint256 poolFeeUBA);

    /**
     * Minter failed to pay underlying funds in time. Collateral reservation fee was paid to the agent.
     * Reserved collateral was released.
     */
    event MintingPaymentDefault(
        address indexed agentVault,
        address indexed minter,
        uint256 indexed collateralReservationId,
        uint256 reservedAmountUBA);

    /**
     * Both minter and agent failed to present any proof within attestation time window, so
     * the agent called `unstickMinting` to release reserved collateral.
     */
    event CollateralReservationDeleted(
        address indexed agentVault,
        address indexed minter,
        uint256 indexed collateralReservationId,
        uint256 reservedAmountUBA);

    /**
     * Agent performed self minting, either by executing selfMint with underlying deposit or
     * by executing mintFromFreeUnderlying (in this case, `mintFromFreeUnderlying` is true and
     * `depositedAmountUBA` is zero).
     */
    event SelfMint(
        address indexed agentVault,
        bool mintFromFreeUnderlying,
        uint256 mintedAmountUBA,
        uint256 depositedAmountUBA,
        uint256 poolFeeUBA);

    /**
     * Redeemer started the redemption process and provided fassets.
     * The amount of fassets corresponding to valueUBA was burned.
     * Several RedemptionRequested events are emitted, one for every agent redeemed against
     * (but multiple tickets for the same agent are combined).
     * The agent's collateral is still locked.
     */
    event RedemptionRequested(
        address indexed agentVault,
        address indexed redeemer,
        uint256 indexed requestId,
        string paymentAddress,
        uint256 valueUBA,
        uint256 feeUBA,
        uint256 firstUnderlyingBlock,
        uint256 lastUnderlyingBlock,
        uint256 lastUnderlyingTimestamp,
        bytes32 paymentReference,
        address executor,
        uint256 executorFeeNatWei);

    /**
     * Agent rejected the redemption request because of the redeemer's identity.
     */
    event RedemptionRequestRejected(
        address indexed agentVault,
        address indexed redeemer,
        uint64 indexed requestId,
        string paymentAddress,
        uint256 valueUBA);

    /**
     * Agent's rejected redemption request was taken over by another agent.
     */
    event RedemptionRequestTakenOver(
        address indexed agentVault,
        address indexed redeemer,
        uint64 indexed requestId,
        uint256 valueTakenOverUBA,
        address newAgentVault,
        uint64 newRequestId);

    /**
     * Agent rejected the redemption payment because the redeemer's address is invalid.
     */
    event RedemptionRejected(
        address indexed agentVault,
        address indexed redeemer,
        uint64 indexed requestId,
        uint256 redemptionAmountUBA);

    /**
     * In case there were not enough tickets or more than allowed number would have to be redeemed,
     * only partial redemption is done and the `remainingLots` lots of the fassets are returned to
     * the redeemer.
     */
    event RedemptionRequestIncomplete(
        address indexed redeemer,
        uint256 remainingLots);

    /**
     * Agent provided proof of redemption payment.
     * Agent's collateral is released.
     */
    event RedemptionPerformed(
        address indexed agentVault,
        address indexed redeemer,
        uint64 indexed requestId,
        bytes32 transactionHash,
        uint256 redemptionAmountUBA,
        int256 spentUnderlyingUBA);

    /**
     * The time for redemption payment is over and payment proof was not provided.
     * Redeemer was paid in the collateral (with extra).
     * The rest of the agent's collateral is released.
     * The corresponding amount of underlying currency, held by the agent, is released
     * and the agent can withdraw it (after underlying withdrawal announcement).
     */
    event RedemptionDefault(
        address indexed agentVault,
        address indexed redeemer,
        uint64 indexed requestId,
        uint256 redemptionAmountUBA,
        uint256 redeemedVaultCollateralWei,
        uint256 redeemedPoolCollateralWei);

    /**
     * Agent provided the proof that redemption payment was attempted, but failed due to
     * the redeemer's address being blocked (or burning more than allowed amount of gas).
     * Redeemer is not paid and all of the agent's collateral is released.
     * The underlying currency is also released to the agent.
     */
    event RedemptionPaymentBlocked(
        address indexed agentVault,
        address indexed redeemer,
        uint64 indexed requestId,
        bytes32 transactionHash,
        uint256 redemptionAmountUBA,
        int256 spentUnderlyingUBA);

    /**
     * Agent provided the proof that redemption payment was attempted, but failed due to
     * his own error. Also triggers payment default, unless the redeemer has done it already.
     */
    event RedemptionPaymentFailed(
        address indexed agentVault,
        address indexed redeemer,
        uint64 indexed requestId,
        bytes32 transactionHash,
        int256 spentUnderlyingUBA,
        string failureReason);

    /**
     * Due to self-close exit, some of the agent's backed fAssets were redeemed,
     * but the redemption was immediately paid in collateral so no redemption process is started.
     */
    event RedeemedInCollateral(
        address indexed agentVault,
        address indexed redeemer,
        uint256 redemptionAmountUBA,
        uint256 paidVaultCollateralWei);

    /**
     * Agent self-closed valueUBA of backing fassets.
     */
    event SelfClose(
        address indexed agentVault,
        uint256 valueUBA);

    /**
     * Redemption ticket with given value was created (when minting was executed).
     */
    event RedemptionTicketCreated(
        address indexed agentVault,
        uint256 indexed redemptionTicketId,
        uint256 ticketValueUBA);

    /**
     * Redemption ticket value was changed (partially redeemed).
     * @param ticketValueUBA the ticket value after update
     */
    event RedemptionTicketUpdated(
        address indexed agentVault,
        uint256 indexed redemptionTicketId,
        uint256 ticketValueUBA);

    /**
     * Redemption ticket was deleted.
     */
    event RedemptionTicketDeleted(
        address indexed agentVault,
        uint256 indexed redemptionTicketId);

    /**
     * Due to lot size change, some dust was created for this agent during
     * redemption. Value `dustUBA` is the new amount of dust. Dust cannot be directly redeemed,
     * but it can be self-closed or liquidated and if it accumulates to more than 1 lot,
     * it can be converted to a new redemption ticket.
     */
    event DustChanged(
        address indexed agentVault,
        uint256 dustUBA);

    /**
     * Agent entered CCB (collateral call band) due to being on the border of unhealthy.
     * Agent has limited time to topup the collateral, otherwise liquidation starts.
     */
    event AgentInCCB(
        address indexed agentVault,
        uint256 timestamp);

    /**
     * Agent entered liquidation state due to unhealthy position.
     * The liquidation ends when the agent is again healthy or the agent's position is fully liquidated.
     */
    event LiquidationStarted(
        address indexed agentVault,
        uint256 timestamp);

    /**
     * Agent entered liquidation state due to illegal payment.
     * Full liquidation will always liquidate the whole agent's position and
     * the agent can never use the same vault and underlying address for minting again.
     */
    event FullLiquidationStarted(
        address indexed agentVault,
        uint256 timestamp);

    /**
     * Some of the agent's position was liquidated, by burning liquidator's fassets.
     * Liquidator was paid in collateral with extra.
     * The corresponding amount of underlying currency, held by the agent, is released
     * and the agent can withdraw it (after underlying withdrawal announcement).
     */
    event LiquidationPerformed(
        address indexed agentVault,
        address indexed liquidator,
        uint256 valueUBA,
        uint256 paidVaultCollateralWei,
        uint256 paidPoolCollateralWei);

    /**
     * Agent exited liquidation state as agent's position was healthy again and not in full liquidation.
     */
    event LiquidationEnded(
        address indexed agentVault);

    /**
     * Part of the balance in the agent's underlying address is "free balance" that the agent can withdraw.
     * It is obtained from minting / redemption fees and self-closed fassets.
     * Some of this amount should be left for paying redemption (and withdrawal) gas fees,
     * and the rest can be withdrawn by the agent.
     * However, withdrawal has to be announced, otherwise it can be challenged as illegal payment.
     * Only one announcement can exist per agent - agent has to present payment proof for withdrawal
     * before starting a new one.
     */
    event UnderlyingWithdrawalAnnounced(
        address indexed agentVault,
        uint64 indexed announcementId,
        bytes32 paymentReference);

    /**
     * After announcing legal underlying withdrawal and creating transaction,
     * the agent must confirm the transaction. This frees the announcement so the agent can create another one.
     * If the agent doesn't confirm in time, anybody can confirm the transaction after several hours.
     * Failed payments must also be confirmed.
     */
    event UnderlyingWithdrawalConfirmed(
        address indexed agentVault,
        uint64 indexed announcementId,
        int256 spentUBA,
        bytes32 transactionHash);

    /**
     * After announcing legal underlying withdrawal agent can cancel ongoing withdrawal.
     * The reason for doing that would be in resetting announcement timestamp due to any problems with underlying
     * withdrawal - in order to prevent others to confirm withdrawal before agent and get some of his collateral.
     */
    event UnderlyingWithdrawalCancelled(
        address indexed agentVault,
        uint64 indexed announcementId);

    /**
     * Emitted when the agent tops up the underlying address balance.
     */
    event UnderlyingBalanceToppedUp(
        address indexed agentVault,
        bytes32 transactionHash,
        uint256 depositedUBA);

    /**
     * Emitted whenever the tracked underlying balance changes.
     */
    event UnderlyingBalanceChanged(
        address indexed agentVault,
        int256 underlyingBalanceUBA);

    /**
     * An unexpected transaction from the agent's underlying address was proved.
     * Whole agent's position goes into liquidation.
     * The challenger is rewarded from the agent's collateral.
     */
    event IllegalPaymentConfirmed(
        address indexed agentVault,
        bytes32 transactionHash);

    /**
     * Two transactions with the same payment reference, both from the agent's underlying address, were proved.
     * Whole agent's position goes into liquidation.
     * The challenger is rewarded from the agent's collateral.
     */
    event DuplicatePaymentConfirmed(
        address indexed agentVault,
        bytes32 transactionHash1,
        bytes32 transactionHash2);

    /**
     * Agent's underlying balance became lower than required for backing f-assets (either through payment or via
     * a challenge. Agent goes to a full liquidation.
     * The challenger is rewarded from the agent's collateral.
     */
    event UnderlyingBalanceTooLow(
        address indexed agentVault,
        int256 balance,
        uint256 requiredBalance);

    /**
     * A setting has changed.
     */
    event SettingChanged(
        string name,
        uint256 value);

    /**
     * A setting has changed.
     */
    event SettingArrayChanged(
        string name,
        uint256[] value);

    /**
     * A contract in the settings has changed.
     */
    event ContractChanged(
        string name,
        address value);

    /**
     * Current underlying block number or timestamp has been updated.
     */
    event CurrentUnderlyingBlockUpdated(
        uint256 underlyingBlockNumber,
        uint256 underlyingBlockTimestamp,
        uint256 updatedAt);

    /**
     * New collateral token has been added.
     */
    event CollateralTypeAdded(
        uint8 collateralClass,
        address token,
        uint256 decimals,
        bool directPricePair,
        string assetFtsoSymbol,
        string tokenFtsoSymbol,
        uint256 minCollateralRatioBIPS,
        uint256 ccbMinCollateralRatioBIPS,
        uint256 safetyMinCollateralRatioBIPS);

    /**
     * System defined collateral ratios for the token have changed (minimal, CCB and safety collateral ratio).
     */
    event CollateralRatiosChanged(
        uint8 collateralClass,
        address collateralToken,
        uint256 minCollateralRatioBIPS,
        uint256 ccbMinCollateralRatioBIPS,
        uint256 safetyMinCollateralRatioBIPS);

    /**
     * Collateral token has been marked as deprecated. After the timestamp `validUntil` passes, it will be
     * considered invalid and the agents who haven't switched their collateral before will be liquidated.
     */
    event CollateralTypeDeprecated(
        uint8 collateralClass,
        address collateralToken,
        uint256 validUntil);

    /**
     * Emergency pause was triggered.
     */
    event EmergencyPauseTriggered(
        uint256 pausedUntil);

    /**
     * Emergency pause was canceled.
     */
    event EmergencyPauseCanceled();

    /**
     * Emergency pause transfers was triggered.
     */
    event EmergencyPauseTransfersTriggered(
        uint256 pausedUntil);

    /**
     * Emergency pause transfers was canceled.
     */
    event EmergencyPauseTransfersCanceled();
}
