// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;


library AMEvents {
    event AgentCreated(
        address indexed owner,
        uint8 agentType,
        address agentVault,
        string underlyingAddress);

    event AgentDestroyed(
        address indexed agentVault);

    /**
     * Agent was added to the list of available agents and can accept collateral reservation requests.
     */ 
    event AgentAvailable(
        address indexed agentVault, 
        uint256 feeBIPS, 
        uint256 agentMinCollateralRatioBIPS,
        uint256 freeCollateralLots);
        
    /**
     * Agent exited from available agents list.
     */ 
    event AvailableAgentExited(
        address indexed agentVault);

    /**
     * Minter reserved collateral, paid the reservation fee, and is expected to pay the underlying funds.
     * Agent's collateral was reserved.
     */ 
    event CollateralReserved(
        address indexed agentVault,
        address indexed minter,
        uint256 collateralReservationId,
        uint256 underlyingValueUBA, 
        uint256 underlyingFeeUBA,
        uint256 lastUnderlyingBlock,
        uint256 lastUnderlyingTimestamp,
        string paymentAddress,
        uint256 paymentReference);

    /**
     * Minter failed to pay underlying funds in time. Collateral reservation fee was paid to the agent.
     * Reserved collateral was released.
     */ 
    event CollateralReservationTimeout(
        address indexed agentVault,
        address indexed minter,
        uint256 collateralReservationId);
        
    /**
     * Minter paid underlying funds in time and received the fassets.
     * Agents collateral is locked.
     * This event is also emitted for self-minting. In this case, `collateralReservationId` is 0.
     */ 
    event MintingExecuted(
        address indexed agentVault,
        uint256 collateralReservationId,
        uint256 redemptionTicketId,
        uint256 mintedAmountUBA,
        uint256 receivedFeeUBA);

    /**
     * Redeemer started redemption process and provided fassets.
     * The amount of fassets corresponding to valueUBA was burned.
     * Several RedemptionRequested events are emitted, one for every agent redeemed against
     * (but multiple tickets for the same agent are combined).
     * Agents collateral is still locked.
     */ 
    event RedemptionRequested(
        address indexed agentVault,
        uint256 requestId,
        string redeemerUnderlyingAddress,
        uint256 valueUBA,
        uint256 lastUnderlyingBlock,
        uint256 lastUnderlyingTimestamp,
        uint256 paymentReference);

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
        uint256 valueUBA,
        uint64 underlyingBlock,
        uint64 requestId);

    /**
     * The time for redemption payment is over and payment proof was not provided.
     * Redeemer was paid in the collateral (with extra). 
     * The rest of the agent's collateral is released.
     * The corresponding amount of underlying currency, held by the agent, is released
     * and the agent can withdraw it (after allowed payment announcement).
     */ 
    event RedemptionDefault(
        address indexed agentVault,
        address indexed redeemer,
        uint256 redeemedCollateralWei,
        uint64 requestId);

    /**
     * Agent provided the proof that redemption payment was attempted, but failed due to
     * redeemer's address being blocked (or burning more than allowed amount of gas).
     * Redeemer is not paid and all of the agent's collateral is released.
     * The underlying currency is also released to the agent.
     */ 
    event RedemptionPaymentBlocked(
        address indexed agentVault,
        address indexed redeemer,
        uint64 requestId);

    /**
     * Agent provided the proof that redemption payment was attempted, but failed due to
     * his own error. We only account for gas here, but the redeemer can later trigger payment default.
     */ 
    event RedemptionPaymentFailed(
        address indexed agentVault,
        address indexed redeemer,
        uint64 requestId,
        string failureReason);

    /**
     * Agent finished the redemption (even if it was defaulted already).
     * Agent's free underlying balance was updated.
     */ 
    event RedemptionFinished(
        address indexed agentVault,
        int256 freedUnderlyingBalanceUBA,
        uint64 requestId);
        
    /**
     * Agent self-closed valueUBA of backing fassets.
     */
    event SelfClose(
        address indexed agentVault,
        uint256 valueUBA);

    /**
     * Due to lot size change, some dust was created for this agent during
     * redemption. Value `dustUBA` is the new amount of dust. Dust cannot be directly redeemed,
     * but if it accumulates to more than 1 lot, it can be converted to redemption tickets.
     */
    event DustChanged(
        address indexed agentVault,
        uint256 dustUBA);

    /**
     * Due to unhealty agent's position or due to illegal payment (full liquidation),
     * agent entered liquidation state.
     */
    event LiquidationStarted(
        address indexed agentVault,
        bool collateralCallBand,
        bool fullLiquidation);
        
    /**
     * Some of agent's position was liquidated, by burning liquidator's fassets.
     * Liquidator was paid in collateral with extra.
     * The corresponding amount of underlying currency, held by the agent, is released
     * and the agent can withdraw it (after allowed payment announcement).
     */
    event LiquidationPerformed(
        address indexed agentVault,
        address indexed liquidator,
        uint256 valueUBA);

    /**
     * Agent exited liquidation state as agent's position was healthy again and not in full liquidation.
     */
    event LiquidationCancelled(
        address indexed agentVault);

    /**
     * Part of balance the agent's underlying address is "free balance" that the agent can withdraw.
     * Its is obtained from minting / redmption fees and self-closed fassets.
     * Some of this amount should be left for paying redemption (and withdrawal) gas fees,
     * and the rest can be withdrawn by the agent.
     * However, withdrawal has to be announced, otherwise it can be challenged as illegal payment.
     * Only one announcement can exists per agent - agent has to present payment proof ofor withdrawal
     * before starting a new one.
     */
    event AllowedPaymentAnnounced(
        address agentVault,
        uint64 announcementId,
        uint256 paymentReference);
        
    /**
     * After announcing legal undelrying withdrawal and creating transaction,
     * the agent must report the transaction details, otherwise it can be challenged as illegal payment.
     * Reported data should be exactly correct, otherwise it can itself be challenged.
     */
    event AllowedPaymentConfirmed(
        address agentVault,
        int256 spentUBA,
        uint64 underlyingBlock,
        uint64 announcementId);
        
    /**
     * An unexpected transaction from the agent's underlying address was proved.
     * Whole agent's position goes into liquidation.
     * Original challenger and prover are paid reward from the agent's collateral.
     */
    event IllegalPaymentConfirmed(
        address indexed agentVault,
        bytes32 transactionHash);

    /**
     * Two transaction with same payment reference, both from the agent's underlying address, were proved.
     * Whole agent's position goes into liquidation.
     * Original challenger and prover are paid reward from the agent's collateral.
     */
    event DuplicatePaymentConfirmed(
        address indexed agentVault,
        bytes32 transactionHash1,
        bytes32 transactionHash2);

    /**
     * Two transaction with same payment reference, both from the agent's underlying address, were proved.
     * Whole agent's position goes into liquidation.
     * Original challenger and prover are paid reward from the agent's collateral.
     */
    event UnderlyingFreeBalanceNegative(
        address indexed agentVault,
        int256 freeBalance);
}
