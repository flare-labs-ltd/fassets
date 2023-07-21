**AgentVaultCreated** - A new agent vault was created.

**AgentDestroyAnnounced** - Agent has announced destroy (close) of agent vault and will be able to perform destroy after the timestamp `destroyAllowedAt`.

**AgentDestroyed** - Agent has destroyed (closed) the agent vault.

**VaultCollateralWithdrawalAnnounced** - Agent has announced a withdrawal of collateral and will be able to withdraw the announced amount after timestamp `withdrawalAllowedAt`. If withdrawal was canceled (announced with amount 0), amountWei and withdrawalAllowedAt are zero.

**PoolTokenRedemptionAnnounced** - Agent has announced a withdrawal of collateral and will be able to redeem the announced amount of pool tokens after the timestamp `withdrawalAllowedAt`. If withdrawal was canceled (announced with amount 0), amountWei and withdrawalAllowedAt are zero.

**AgentAvailable** - Agent was added to the list of available agents and can accept collateral reservation requests.

**AvailableAgentExitAnnounced** - Agent exited from available agents list. The agent can exit the available list after the timestamp `exitAllowedAt`.

**AvailableAgentExited** - Agent exited from available agents list.

**AgentSettingChangeAnnounced** - Agent has initiated setting change (fee or some agent collateral ratio change). The setting change can be executed after the timestamp `validAt`.

**AgentSettingChanged** - Agent has executed setting change (fee or some agent collateral ratio change).

**AgentCollateralTypeChanged** - Agent or agent's contingency pool has changed token contract.

**CollateralReserved** - Minter reserved collateral, paid the reservation fee, and is expected to pay the underlying funds. Agent's collateral was reserved.

**MintingExecuted** - Minter paid underlying funds in time and received the fassets. The agent's collateral is locked. This event is also emitted for self-minting. In this case, `collateralReservationId` is 0.

**MintingPaymentDefault** - Minter failed to pay underlying funds in time. Collateral reservation fee was paid to the agent. Reserved collateral was released.

**CollateralReservationDeleted** - Both minter and agent failed to present any proof within attestation time window, so the agent called `unstickMinting` to release reserved collateral.

**RedemptionRequested** - Redeemer started the redemption process and provided fassets. The amount of fassets corresponding to valueUBA was burned. Several RedemptionRequested events are emitted, one for every agent redeemed against (but multiple tickets for the same agent are combined). The agent's collateral is still locked.

**RedemptionRequestIncomplete** - In case there were not enough tickets or more than allowed number would have to be redeemed, only partial redemption is done and the `remainingLots` lots of the fassets are returned to the redeemer.

**RedemptionPerformed** - Agent provided proof of redemption payment. Agent's collateral is released.

**RedemptionDefault** - The time for redemption payment is over and payment proof was not provided. Redeemer was paid in the collateral (with extra). The rest of the agent's collateral is released. The corresponding amount of underlying currency, held by the agent, is released and the agent can withdraw it (after underlying withdrawal announcement).

**RedemptionPaymentBlocked** - Agent provided the proof that redemption payment was attempted, but failed due to the redeemer's address being blocked (or burning more than allowed amount of gas). Redeemer is not paid and all of the agent's collateral is released. The underlying currency is also released to the agent.

**RedemptionPaymentFailed** - Agent provided the proof that redemption payment was attempted, but failed due to his own error. Also triggers payment default, unless the redeemer has done it already.

**SelfClose** - Agent self-closed valueUBA of backing fassets.

**DustChanged** - Due to lot size change, some dust was created for this agent during redemption. Value `dustUBA` is the new amount of dust. Dust cannot be directly redeemed, but it can be self-closed or liquidated and if it accumulates to more than 1 lot, it can be converted to a new redemption ticket.

**DustConvertedToTicket** - The amount of dust was more than one lot, and the whole lot part of it was converted to a redemption ticket.

**AgentInCCB** - Agent entered CCB (collateral call band) due to being on the border of unhealthy. Agent has limited time to topup the collateral, otherwise liquidation starts.

**LiquidationStarted** - Agent entered liquidation state due to unhealthy position. The liquidation ends when the agent is again healthy or the agent's position is fully liquidated.

**FullLiquidationStarted** - Agent entered liquidation state due to illegal payment. Full liquidation will always liquidate the whole agent's position and the agent can never use the same vault and underlying address for minting again.

**LiquidationPerformed** - Some of the agent's position was liquidated, by burning liquidator's fassets. Liquidator was paid in collateral with extra. The corresponding amount of underlying currency, held by the agent, is released and the agent can withdraw it (after underlying withdrawal announcement).

**LiquidationEnded** - Agent exited liquidation state as agent's position was healthy again and not in full liquidation.

**UnderlyingWithdrawalAnnounced** - Part of the balance in the agent's underlying address is "free balance" that the agent can withdraw. It is obtained from minting / redemption fees and self-closed fassets. Some of this amount should be left for paying redemption (and withdrawal) gas fees, and the rest can be withdrawn by the agent. However, withdrawal has to be announced, otherwise it can be challenged as illegal payment. Only one announcement can exist per agent - agent has to present payment proof for withdrawal before starting a new one.

**UnderlyingWithdrawalConfirmed** - After announcing legal underlying withdrawal and creating transaction, the agent must confirm the transaction. This frees the announcement so the agent can create another one. If the agent doesn't confirm in time, anybody can confirm the transaction after several hours. Failed payments must also be confirmed.

**UnderlyingWithdrawalCancelled** - After announcing legal underlying withdrawal agent can cancel ongoing withdrawal. The reason for doing that would be in resetting announcement timestamp due to any problems with underlying withdrawal - in order to prevent others to confirm withdrawal before agent and get some of his collateral.

**UnderlyingBalanceToppedUp** - Emitted when the agent tops up the underlying address balance.

**UnderlyingBalanceChanged** - Emitted whenever the tracked underlying balance changes.

**IllegalPaymentConfirmed** - An unexpected transaction from the agent's underlying address was proved. Whole agent's position goes into liquidation. The challenger is rewarded from the agent's collateral.

**DuplicatePaymentConfirmed** - Two transactions with the same payment reference, both from the agent's underlying address, were proved. Whole agent's position goes into liquidation. The challenger is rewarded from the agent's collateral.

**UnderlyingBalanceTooLow** - Agent's underlying balance became lower than required for backing f-assets (either through payment or via a challenge. Agent goes to a full liquidation. The challenger is rewarded from the agent's collateral.

**SettingChanged** - A setting has changed.

**SettingArrayChanged** - A setting has changed.

**ContractChanged** - A contract in the settings has changed.

**CollateralTypeAdded** - New collateral token has been added.

**CollateralRatiosChanged** - System defined collateral ratios for the token have changed (minimal, CCB and safety collateral ratio).

**CollateralTypeDeprecated** - Collateral token has been marked as deprecated. After the timestamp `validUntil` passes, it will be considered invalid and the agents who haven't switched their collateral before will be liquidated.
