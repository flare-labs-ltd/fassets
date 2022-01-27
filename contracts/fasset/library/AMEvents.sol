// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

library AMEvents {

    /**
     * Agent was added to the list of available agents and can accept collateral reservation requests.
     */ 
    event AgentAvailable(
        address agentVault, 
        uint256 feeBIPS, 
        uint256 agentMinCollateralRatioBIPS,
        uint256 freeCollateralLots);
        
    /**
     * Agent exited from available agents list.
     */ 
    event AgentExited(address agentVault);

    /**
     * Minter reserved collateral, paid the reservation fee, and is expected to pay the underlying funds.
     * Agent's collateral was reserved.
     */ 
    event CollateralReserved(
        address indexed agentVault,
        address indexed minter,
        uint256 collateralReservationId,
        uint64 reservedLots,
        uint256 underlyingValueUBA, 
        uint256 underlyingFeeUBA,
        uint256 lastUnderlyingBlock);

    /**
     * Minter failed to pay underlying funds in time. Collateral reservation fee was paid to the agent.
     * Reserved collateral was released.
     */ 
    event CollateralReservationTimeout(
        address indexed agentVault,
        address indexed minter,
        uint256 collateralReservationId);
        
    /**
     * Agent challenged the current underlying block number provided by the minter.
     * Minter is expected to provide proof of existence of this or later block on the underlying chain.
     */ 
    event CRUnderlyingBlockChallenged(
        address indexed minter,
        uint256 collateralReservationId);
        
    /**
     * Agent challenged the current underlying block number provided by the minter
     * and the minter failed to provide proof of existence of this or later block in time.
     */ 
    event CRUnderlyingBlockChallengeTimeout(
        address indexed agentVault,
        address indexed minter,
        uint256 collateralReservationId);

    /**
     * Minter paid underlying funds in time and received the fassets.
     * Agents collateral is locked.
     */ 
    event MintingExecuted(
        address indexed agentVault,
        uint256 collateralReservationId,
        uint256 redemptionTicketId,
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
        uint256 valueUBA,
        uint256 requestUnderlyingBlock,
        uint256 lastUnderlyingBlock,
        uint256 requestId);

    /**
     * In case there were not enough tickets or more than allowed number would have to be redeemed,
     * only partial redemption is done and the `remainingLots` lots of the fassets are returned to
     * the redeemer.
     */ 
    event RedemptionRequestIncomplete(
        address indexed redeemer,
        uint256 remainingLots);

    /**
     * Agent complained against the current underlying block stated by the redeemer, by providing
     * proof of a later existing block. As a result, agent obtained more time for the 
     * completion of the redemption payment.
     */ 
    event RedemptionUnderlyingBlockChanged(
        address indexed agentVault,
        uint256 requestUnderlyingBlock,
        uint256 lastUnderlyingBlock,
        uint256 requestId);
        
    /**
     * Agent reported redemption payment, before obtaining proof from the state connector.
     * Report should be made immediately after creating transaction on the underlying chain
     * and is only used for preventing illegal payment challenge.
     * Reported data should be exactly correct, otherwise it can itself be challenged.
     */ 
    event RedemptionPaymentReported(
        address indexed agentVault,
        address indexed redeemer,
        uint256 valueUBA,
        uint256 gasUBA,
        uint256 feeUBA,
        uint64 underlyingBlock,
        uint64 requestId);

    /**
     * Agent provided proof of redemption payment.
     * Agent's collateral is released.
     */ 
    event RedemptionPerformed(
        address indexed agentVault,
        address indexed redeemer,
        uint256 valueUBA,
        uint256 gasUBA,
        uint256 feeUBA,
        uint64 underlyingBlock,
        uint64 requestId);

    /**
     * The time for redemption payment is over and payment proof was not provided.
     * Redeemer was paid in the collateral (with extra). 
     * The rest of the agent's collateral is released.
     * The corresponding amount of underlying currency, held by the agent, is released
     * and the agent can withdraw it (after allowed payment announcement).
     */ 
    event RedemptionFailed(
        address indexed agentVault,
        address indexed redeemer,
        uint256 redeemedCollateralWei,
        uint256 freedBalanceUBA,
        uint64 requestId);

    /**
     * Agent provided the proff that redemption payment was attempted, but failed due to
     * redeemer's address being blocked (or burning more than allowed amount of gas).
     * Redeemer is not paid and all of the agent's collateral is released.
     * The underlying currency is also released to the agent.
     */ 
    event RedemptionBlocked(
        address indexed agentVault,
        address indexed redeemer,
        uint256 freedBalanceUBA,
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
     * However, withdrawal has to be first announced and then reported, otherwise it can be challenged
     * as illegal payment.
     */
    event AllowedPaymentAnnounced(
        address agentVault,
        uint256 valueUBA,
        uint64 announcementId);
        
    /**
     * After announcing legal undelrying withdrawal and creating transaction,
     * the agent must report the transaction details, otherwise it can be challenged as illegal payment.
     * Reported data should be exactly correct, otherwise it can itself be challenged.
     */
    event AllowedPaymentReported(
        address agentVault,
        uint256 valueUBA,
        uint256 gasUBA,
        uint64 underlyingBlock,
        uint64 announcementId);
        
    /**
     * Agent's free balance on the underlying address has decreased below zero 
     * (usually due to underlying gas payment).
     * Agent has until `lastUnderlyingBlock` to topup the underlying balance, otherwise
     * the agent's position gets fully liquidated.
     * Please not that the agent can topup underlying balance any time, even if this event doesn't occur.
     */
    event TopupRequired(
        address indexed agentVault,
        uint256 valueUBA,
        uint64 lastUnderlyingBlock);

    /**
     * An unexpected transaction was detected outgoing from the agent's underlying address.
     * Agent can still provide a report justifying the transaction as redemption payment 
     * or previously announced allowed withdrawal (but it is too late to announce).
     */
    event IllegalPaymentChallenged(
        address indexed agentVault,
        bytes32 transactionHash);
    
    /**
     * An unexpected transaction from the agent's underlying address was proved.
     * Whole agent's position goes into liquidation.
     * Original challenger and prover are paid reward from the agent's collateral.
     */
    event IllegalPaymentConfirmed(
        address indexed agentVault,
        bytes32 transactionHash);
        
    /**
     * Payment report (for redemption or allowed withdrawal) contains incorrect fields.
     * To show this, the challenger provided proof of the same transaction, but with different data.
     * Whole agent's position goes into liquidation.
     * The challenger is paid reward from the agent's collateral.
     */
    event WrongPaymentReportConfirmed(
        address indexed agentVault,
        bytes32 transactionHash);
}
