**assetManagerController** - Get the asset manager controller, the only address that can change settings. Asset manager must be attached to the asset manager controller in the system contract registry.

**fAsset** - Get the f-asset contract managed by this asset manager instance.

**lotSize** - Return lot size in UBA (underlying base amount - smallest amount on underlying chain, e.g. satoshi).

**getSettings** - Get complete current settings.

**getLiquidationSettings** - Get settings for current liquidation strategy. Format depends on the liquidation strategy implementation.

**controllerAttached** - When `controllerAttached` is true, asset manager has been added to the asset manager controller. This is required for the asset manager to be operational (create agent and minting don't work otherwise).

**paused** - True if the asset manager is paused. In the paused state, minting is disabled, but all other operations (e.g. redemptions, liquidation) still work. Paused asset manager can be later unpaused.

**terminated** - True if the asset manager is terminated. In terminated state almost all operations (minting, redeeming, liquidation) are disabled and f-assets are not transferable any more. The only operation still permitted is for agents to release the locked collateral by calling `buybackAgentCollateral`. An asset manager can be terminated after being paused for at least a month (to redeem as many f-assets as possible). The terminated asset manager can not be revived anymore.

**updateCurrentBlock** - Prove that a block with given number and timestamp exists and update the current underlying block info if the provided data is higher. This method should be called by minters before minting and by agent's regularly to prevent current block being too outdated, which gives too short time for minting or redemption payment.
NOTE: anybody can call.

**currentUnderlyingBlock** - Get block number and timestamp of the current underlying block known to the f-asset system.

**getCollateralType** - Get collateral  information about a token.

**getCollateralTypes** - Get the list of all available and deprecated tokens used for collateral.

**setOwnerHotAddress** - Associate a hot wallet address with the agent owner's cold owner address. Every owner (cold address) can have only one hot address, so as soon as the new one is set, the old one stops working.
NOTE: May only be called by an agent on the allowed agent list and only from the cold wallet address.

**proveUnderlyingAddressEOA** - This method fixes the underlying address to be used by given agent owner. A proof of payment (can be minimal or to itself) from this address must be provided, with payment reference being equal to this method caller's address.
NOTE: calling this method before `createAgent()` is optional on most chains, but is required on smart contract chains to make sure the agent is using EOA address (depends on setting `requireEOAAddressProof`). NOTE: may only be called by a whitelisted agent (cold or hot owner address).

**createAgent** - Create an agent. The agent will always be identified by `_agentVault` address. (Externally, one account may own several agent vaults,  but in fasset system, each agent vault acts as an independent agent.)
NOTE: may only be called by an agent on the allowed agent list. Can be called from the cold or the hot agent wallet address.

**announceDestroyAgent** - Announce that the agent is going to be destroyed. At this time, the agent must not have any mintings or collateral reservations and must not be on the available agents list.
NOTE: may only be called by the agent vault owner.

**destroyAgent** - Delete all agent data, self destruct agent vault and send remaining collateral to the `_recipient`. Procedure for destroying agent: - exit available agents list - wait until all assets are redeemed or perform self-close - announce destroy (and wait the required time) - call destroyAgent()
NOTE: may only be called by the agent vault owner. NOTE: the remaining funds from the vault will be transferred to the provided recipient.

**announceAgentSettingUpdate** - Due to the effect on the pool, all agent settings are timelocked. This method announces a setting change. The change can be executed after the timelock expires.
NOTE: may only be called by the agent vault owner.

**executeAgentSettingUpdate** - Due to the effect on the pool, all agent settings are timelocked. This method executes a setting change after the timelock expires.
NOTE: may only be called by the agent vault owner.

**upgradeWNatContract** - When current pool collateral token contract (WNat) is replaced by the method setPoolCollateralType, pools don't switch automatically. Instead, the agent must call this method that swaps old WNat tokens for new ones and sets it for use by the pool.
NOTE: may only be called by the agent vault owner.

**announceVaultCollateralWithdrawal** - The agent is going to withdraw `_valueNATWei` amount of collateral from the agent vault. This has to be announced and the agent must then wait `withdrawalWaitMinSeconds` time. After that time, the agent can call `withdrawCollateral(_vaultCollateralToken, _valueNATWei)` on the agent vault.
NOTE: may only be called by the agent vault owner.

**announceAgentPoolTokenRedemption** - The agent is going to redeem `_valueWei` collateral pool tokens in the agent vault. This has to be announced and the agent must then wait `withdrawalWaitMinSeconds` time. After that time, the agent can call `redeemContingencyPoolTokens(_valueNATWei)` on the agent vault.
NOTE: may only be called by the agent vault owner.

**confirmTopupPayment** - When the agent tops up his underlying address, it has to be confirmed by calling this method, which updates the underlying free balance value.
NOTE: may only be called by the agent vault owner.

**announceUnderlyingWithdrawal** - Announce withdrawal of underlying currency. In the event UnderlyingWithdrawalAnnounced the agent receives payment reference, which must be added to the payment, otherwise it can be challenged as illegal. Until the announced withdrawal is performed and confirmed or canceled, no other withdrawal can be announced.
NOTE: may only be called by the agent vault owner.

**confirmUnderlyingWithdrawal** - Agent must provide confirmation of performed underlying withdrawal, which updates free balance with used gas and releases announcement so that a new one can be made. If the agent doesn't call this method, anyone can call it after a time (`confirmationByOthersAfterSeconds`).
NOTE: may only be called by the owner of the agent vault   except if enough time has passed without confirmation - then it can be called by anybody.

**cancelUnderlyingWithdrawal** - Cancel ongoing withdrawal of underlying currency. Needed in order to reset announcement timestamp, so that others cannot front-run the agent at `confirmUnderlyingWithdrawal` call. This could happen if withdrawal would be performed more than `confirmationByOthersAfterSeconds` seconds after announcement.
NOTE: may only be called by the agent vault owner.

**buybackAgentCollateral** - When f-asset is terminated, an agent can burn the market price of backed f-assets with his collateral, to release the remaining collateral (and, formally, underlying assets). This method ONLY works when f-asset is terminated, which will only be done when the asset manager is already paused at least for a month and most f-assets are already burned and the only ones remaining are unrecoverable.
NOTE: may only be called by the agent vault owner. NOTE: the agent (cold address) receives the vault collateral and NAT is burned instead. Therefore      this method is `payable` and the caller must provide enough NAT to cover the received vault collateral amount      multiplied by `vaultCollateralBuyForFlareFactorBIPS`.

**getAllAgents** - Get (a part of) the list of all agents. The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.

**getAgentInfo** - Return detailed info about an agent, typically needed by a minter.

**getContingencyPool** - Returns the collateral pool address of the agent identified by `_agentVault`.

**getAgentVaultOwner** - Return the hot and the cold address of the owner of the agent identified by `_agentVault`.

**makeAgentAvailable** - Add the agent to the list of publicly available agents. Other agents can only self-mint.
NOTE: may only be called by the agent vault owner.

**announceExitAvailableAgentList** - Announce exit from the publicly available agents list.
NOTE: may only be called by the agent vault owner.

**exitAvailableAgentList** - Exit the publicly available agents list.
NOTE: may only be called by the agent vault owner and after announcement.

**getAvailableAgentsList** - Get (a part of) the list of available agents. The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.

**getAvailableAgentsDetailedList** - Get (a part of) the list of available agents with extra information about agents' fee, min collateral ratio and available collateral (in lots). The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
NOTE: agent's available collateral can change anytime due to price changes, minting, or changes in agent's min collateral ratio, so it is only to be used as an estimate.

**reserveCollateral** - Before paying underlying assets for minting, minter has to reserve collateral and pay collateral reservation fee. Collateral is reserved at ratio of agent's agentMinCollateralRatio to requested lots NAT market price. On success the minter receives instructions for underlying payment (value, fee and payment reference) in event `CollateralReserved`. Then the minter has to pay `value + fee` on the underlying chain. If the minter pays the underlying amount, the collateral reservation fee is burned and the minter obtains f-assets. Otherwise the agent collects the collateral reservation fee.
NOTE: may only be called by a whitelisted caller when whitelisting is enabled. NOTE: the owner of the agent vault must be on the allowed agent list.

**collateralReservationFee** - Return the collateral reservation fee amount that has to be passed to the `reserveCollateral` method.

**executeMinting** - After obtaining proof of underlying payment, the minter calls this method to finish the minting and collect the minted f-assets.
NOTE: may only be called by the minter (= creator of CR, the collateral reservation request)   or the agent owner (= owner of the agent vault in CR).

**mintingPaymentDefault** - When the time for the minter to pay the underlying amount is over (i.e. the last underlying block has passed), the agent can declare payment default. Then the agent collects the collateral reservation fee (it goes directly to the vault), and the reserved collateral is unlocked.
NOTE: may only be called by the owner of the agent vault in the collateral reservation request.

**unstickMinting** - If a collateral reservation request exists for more than 24 hours, payment or non-payment proof are no longer available. In this case the agent can call this method, which burns reserved collateral at market price and releases the remaining collateral (CRF is also burned).
NOTE: may only be called by the owner of the agent vault in the collateral reservation request. NOTE: the agent (cold address) receives the vault collateral and NAT is burned instead. Therefore      this method is `payable` and the caller must provide enough NAT to cover the received vault collateral amount      multiplied by `vaultCollateralBuyForFlareFactorBIPS`.

**selfMint** - Agent can mint against himself. In that case, this is a one-step process, skipping collateral reservation and no collateral reservation fee payment. Moreover, the agent doesn't have to be on the publicly available agents list to self-mint.
NOTE: may only be called by the agent vault owner. NOTE: the caller must be a whitelisted agent.

**redeem** - Redeem (up to) `_lots` lots of f-assets. The corresponding amount of the f-assets belonging to the redeemer will be burned and the redeemer will get paid by the agent in underlying currency (or, in case of agent's payment default, by agent's collateral with a premium).
NOTE: in some cases not all sent f-assets can be redeemed (either there are not enough tickets or more than a fixed limit of tickets should be redeemed). In this case only part of the approved assets are burned and redeemed and the redeemer can execute this method again for the remaining lots. In such a case the `RedemptionRequestIncomplete` event will be emitted, indicating the number of remaining lots. Agent receives redemption request id and instructions for underlying payment in RedemptionRequested event and has to pay `value - fee` and use the provided payment reference. NOTE: may only be called by a whitelisted caller when whitelisting is enabled.

**confirmRedemptionPayment** - After paying to the redeemer, the agent must call this method to unlock the collateral and to make sure that the redeemer cannot demand payment in collateral on timeout. The same method must be called for any payment status (SUCCESS, FAILED, BLOCKED). In case of FAILED, it just releases the agent's underlying funds and the redeemer gets paid in collateral after calling redemptionPaymentDefault. In case of SUCCESS or BLOCKED, remaining underlying funds and collateral are released to the agent. If the agent doesn't confirm payment in enough time (several hours, setting `confirmationByOthersAfterSeconds`), anybody can do it and get rewarded from the agent's vault.
NOTE: may only be called by the owner of the agent vault in the redemption request   except if enough time has passed without confirmation - then it can be called by anybody

**redemptionPaymentDefault** - If the agent doesn't transfer the redeemed underlying assets in time (until the last allowed block on the underlying chain), the redeemer calls this method and receives payment in collateral (with some extra). The agent can also call default if the redeemer is unresponsive, to payout the redeemer and free the remaining collateral.
NOTE: may only be called by the redeemer (= creator of the redemption request)   or the agent owner (= owner of the agent vault in the redemption request)

**finishRedemptionWithoutPayment** - If the agent hasn't performed the payment, the agent can close the redemption request to free underlying funds. It can be done immediately after the redeemer or agent calls `redemptionPaymentDefault`, or this method can trigger the default payment without proof, but only after enough time has passed so that attestation proof of non-payment is not available any more.
NOTE: may only be called by the owner of the agent vault in the redemption request.

**selfClose** - Agent can "redeem against himself" by calling `selfClose`, which burns agent's own f-assets and unlocks agent's collateral. The underlying funds backing the f-assets are released as agent's free underlying funds and can be later withdrawn after announcement.
NOTE: may only be called by the agent vault owner.

**convertDustToTicket** - Due to the minting pool fees or after a lot size change by the governance, it may happen that less than one lot remains on a redemption ticket. This is named "dust" and can be self closed or liquidated, but not redeemed. However, after several additions, the total dust can amount to more than one lot. Using this method, the amount, rounded down to a whole number of lots, can be converted to a new redemption ticket.
NOTE: we do NOT check that the caller is the agent vault owner, since we want to allow anyone to convert dust to tickets to increase asset fungibility. NOTE: dust above 1 lot is actually added to ticket at every minting, so this function need only be called when the agent doesn't have any minting.

**startLiquidation** - Checks that the agent's collateral is too low and if true, starts the agent's liquidation.
NOTE: may only be called by a whitelisted caller when whitelisting is enabled.

**liquidate** - Burns up to `_amountUBA` f-assets owned by the caller and pays the caller the corresponding amount of native currency with premium (premium depends on the liquidation state). If the agent isn't in liquidation yet, but satisfies conditions, automatically puts the agent in liquidation status.
NOTE: may only be called by a whitelisted caller when whitelisting is enabled.

**endLiquidation** - When the agent's collateral reaches the safe level during liquidation, the liquidation process can be stopped by calling this method. Full liquidation (i.e. the liquidation triggered by illegal underlying payment) cannot be stopped.
NOTE: anybody can call.

**illegalPaymentChallenge** - Called with a proof of payment made from the agent's underlying address, for which no valid payment reference exists (valid payment references are from redemption and underlying withdrawal announcement calls). On success, immediately triggers full agent liquidation and rewards the caller.
NOTE: may only be called by a whitelisted caller when whitelisting is enabled.

**doublePaymentChallenge** - Called with proofs of two payments made from the agent's underlying address with the same payment reference (each payment reference is valid for only one payment). On success, immediately triggers full agent liquidation and rewards the caller.
NOTE: may only be called by a whitelisted caller when whitelisting is enabled.

**freeBalanceNegativeChallenge** - Called with proofs of several (otherwise legal) payments, which together make the agent's underlying free balance negative (i.e. the underlying address balance is less than the total amount of backed f-assets). On success, immediately triggers full agent liquidation and rewards the caller.
NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
