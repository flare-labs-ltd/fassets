// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../generated/interface/IAttestationClient.sol";
import "./data/AssetManagerSettings.sol";
import "./data/CollateralType.sol";
import "./data/AgentInfo.sol";
import "./data/AgentSettings.sol";
import "./data/AvailableAgentInfo.sol";
import "./IAssetManagerEvents.sol";


/**
 * Asset manager publicly callable methods.
 */
interface IAssetManager is IAssetManagerEvents {
    ////////////////////////////////////////////////////////////////////////////////////
    // Basic system information

    /**
     * Get the asset manager controller, the only address that can change settings.
     * Asset manager must be attached to the asset manager controller in the system contract registry.
     */
    function assetManagerController()
        external view
        returns (address);

    /**
     * Get the f-asset contract managed by this asset manager instance.
     */
    function fAsset()
        external view
        returns (IERC20);

    /**
     * Return lot size in UBA (underlying base amount - smallest amount on underlying chain, e.g. satoshi).
     */
    function lotSize()
        external view
        returns (uint256 _lotSizeUBA);


    ////////////////////////////////////////////////////////////////////////////////////
    // System settings

    /**
     * Get complete current settings.
     * @return the current settings
     */
    function getSettings()
        external view
        returns (AssetManagerSettings.Data memory);

    /**
     * Get settings for current liquidation strategy. Format depends on the liquidation strategy implementation.
     * @return the current settings
     */
    function getLiquidationSettings()
        external view
        returns (bytes memory);

    /**
     * When `controllerAttached` is true, asset manager has been added to the asset manager controller.
     * This is required for the asset manager to be operational (create agent and minting don't work otherwise).
     */
    function controllerAttached()
        external view
        returns (bool);

    ////////////////////////////////////////////////////////////////////////////////////
    // Asset manager upgrading state

    /**
     * True if asset manager is paused.
     * In paused state, minting is disabled, but all other operations (e.g. redemptions, liquidation) still work.
     * Paused asset manager can be later unpaused.
     */
    function paused()
        external view
        returns (bool);

    /**
     * True if asset manager is terminated.
     * In terminated state almost all operations (minting, redeeming, liquidation) are disabled and f-assets are
     * not transferable any more. The only operation still permitted is for agents to release the locked collateral
     * by calling `buybackAgentCollateral`.
     * Asset manager can be terminated after being paused for at least a month
     * (to redeem as many f-assets as possible).
     * Terminated asset manager can not be revived anymore.
     */
    function terminated()
        external view
        returns (bool);

    ////////////////////////////////////////////////////////////////////////////////////
    // Timekeeping for underlying chain

    /**
     * Prove that a block with given number and timestamp exists and
     * update the current underlying block info if the provided data higher.
     * This method should be called by minters before minting and by agent's regularly
     * to prevent current block being too outdated, which gives too short time for
     * minting or redemption payment.
     * NOTE: anybody can call.
     * @param _proof proof that a block with given number and timestamp exists
     */
    function updateCurrentBlock(
        IAttestationClient.ConfirmedBlockHeightExists calldata _proof
    ) external;

    /**
     * Get block number and timestamp of the current underlying block known to the f-asset system.
     * @return _blockNumber current underlying block number tracked by asset manager
     * @return _blockTimestamp current underlying block timestamp tracked by asset manager
     */
    function currentUnderlyingBlock()
        external view
        returns (uint256 _blockNumber, uint256 _blockTimestamp);

    ////////////////////////////////////////////////////////////////////////////////////
    // Available collateral types

    /**
     * Get collateral  information about a token.
     */
    function getCollateralType(CollateralType.Class _collateralClass, IERC20 _token)
        external view
        returns (CollateralType.Data memory);

    /**
     * Get the list of all available and deprecated tokens used for collateral.
     */
    function getCollateralTypes()
        external view
        returns (CollateralType.Data[] memory);

    ////////////////////////////////////////////////////////////////////////////////////
    // Agent owner cold and hot address management

    /**
     * Associate a hot wallet address with agent owner's cold owner address.
     * Every owner (cold address) can have only one hot address, so as soon as the new one is set, the old
     * one stops working.
     * NOTE: May only be called by a whitelisted agent and only from the cold address.
     */
    function setOwnerHotAddress(address _ownerHotAddress) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Agent create / destroy

    /**
     * This method fixes the underlying address to be used by given agent owner.
     * A proof of payment (can be minimal or to itself) from this address must be provided,
     * with payment reference being equal to this method caller's address.
     * NOTE: calling this method before `createAgent()` is optional on most chains,
     * but is required on smart contract chains to make sure the agent is using EOA address
     * (depends on setting `requireEOAAddressProof`).
     * NOTE: may only be called by a whitelisted agent (cold or hot owner address).
     * @param _payment proof of payment on the underlying chain
     */
    function proveUnderlyingAddressEOA(
        IAttestationClient.Payment calldata _payment
    ) external;

    /**
     * Create an agent.
     * Agent will always be identified by `_agentVault` address.
     * (Externally, same account may own several agent vaults,
     *  but in fasset system, each agent vault acts as an independent agent.)
     * NOTE: may only be called by a whitelisted agent (cold or hot owner address).
     */
    function createAgent(
        AgentSettings.Data calldata _settings
    ) external;

    /**
     * Announce that the agent is going to be destroyed. At this time, agent must not have any mintings
     * or collateral reservations and must not be on the available agents list.
     * NOTE: may only be called by the agent vault owner.
     */
    function announceDestroyAgent(
        address _agentVault
    ) external;

    /**
     * Delete all agent data, selfdestruct agent vault and send remaining collateral to the `_recipient`.
     * Procedure for destroying agent:
     * - exit available agents list
     * - wait until all assets are redeemed or perform self-close
     * - announce destroy (and wait the required time)
     * - call destroyAgent()
     * NOTE: may only be called by the agent vault owner.
     * NOTE: the remaining funds from the vault will be transferred to the provided recipient.
     * @param _agentVault address of the agent's vault to destroy
     * @param _recipient address that receives the remaining funds and possible vault balance
     */
    function destroyAgent(
        address _agentVault,
        address payable _recipient
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Agent settings update

    /**
     * Due to effect on the pool, all agent settings are timelocked.
     * This method announces a setting change. The change can be executed after the timelock expires.
     * NOTE: may only be called by the agent vault owner.
     */
    function announceAgentSettingUpdate(
        address _agentVault,
        string memory _name,
        uint256 _value
    ) external;

    /**
     * Due to effect on the pool, all agent settings are timelocked.
     * This method executes a setting change after the timelock expired.
     * NOTE: may only be called by the agent vault owner.
     */
    function executeAgentSettingUpdate(
        address _agentVault,
        string memory _name
    ) external;

    /**
     * When current pool collateral token contract (WNat) is replaced by the method setPoolCollateralType,
     * pools don't switch automatically. Instead, the agent must call this method that swaps old WNat tokens for
     * new ones and sets it for use by the pool.
     * NOTE: may only be called by the agent vault owner.
     */
    function upgradeWNatContract(
        address _agentVault
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Collateral withdrawal announcement

    /**
     * Agent is going to withdraw `_valueNATWei` amount of collateral from agent vault.
     * This has to be announced and agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, agent can call withdraw(_valueNATWei) on agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     */
    function announceClass1CollateralWithdrawal(
        address _agentVault,
        uint256 _valueNATWei
    ) external;

    /**
     * Agent is going to withdraw `_valueNATWei` amount of collateral from agent vault.
     * This has to be announced and agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, agent can call withdraw(_valueNATWei) on agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     */
    function announceAgentPoolTokenRedemption(
        address _agentVault,
        uint256 _valueNATWei
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Underlying balance topup

    /**
     * When the agent tops up his underlying address, it has to be confirmed by calling this method,
     * which updates the underlying free balance value.
     * NOTE: may only be called by the agent vault owner.
     * @param _payment proof of the underlying payment; must include payment
     *      reference of the form `0x4642505266410011000...0<agents_vault_address>`
     * @param _agentVault agent vault address
     */
    function confirmTopupPayment(
        IAttestationClient.Payment calldata _payment,
        address _agentVault
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Underlying withdrawal announcements

    /**
     * Announce withdrawal of underlying currency.
     * In the event UnderlyingWithdrawalAnnounced the agent receives payment reference, which must be
     * added to the payment, otherwise it can be challenged as illegal.
     * Until the announced withdrawal is performed and confirmed or cancelled, no other withdrawal can be announced.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function announceUnderlyingWithdrawal(
        address _agentVault
    ) external;

    /**
     * Agent must provide confirmation of performed underlying withdrawal, which updates free balance with used gas
     * and releases announcement so that a new one can be made.
     * If the agent doesn't call this method, anyone can call it after a time (confirmationByOthersAfterSeconds).
     * NOTE: may only be called by the owner of the agent vault
     *   except if enough time has passed without confirmation - then it can be called by anybody.
     * @param _payment proof of the underlying payment
     * @param _agentVault agent vault address
     */
    function confirmUnderlyingWithdrawal(
        IAttestationClient.Payment calldata _payment,
        address _agentVault
    ) external;

    /**
     * Cancel ongoing withdrawal of underlying currency.
     * Needed in order to reset announcement timestamp, so that others cannot front-run agent at
     * confirmUnderlyingWithdrawal call. This could happen if withdrawal would be performed more
     * than confirmationByOthersAfterSeconds seconds after announcement.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function cancelUnderlyingWithdrawal(
        address _agentVault
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Terminated asset manager support

    /**
     * When f-asset is terminated, agent can burn the market price of backed f-assets with his collateral,
     * to release the remaining collateral (and, formally, underlying assets).
     * This method ONLY works when f-asset is terminated, which will only be done when AssetManager is already paused
     * at least for a month and most f-assets are already burned and the only ones remaining are unrecoverable.
     * NOTE: may only be called by the agent vault owner.
     * NOTE: the agent (cold address) receives the class1 collateral and NAT is burned instead. Therefore
     *      this method is `payable` and the caller must provide enough NAT to cover the received class1 amount
     *      multiplied by `class1BuyForFlareFactorBIPS`.
     */
    function buybackAgentCollateral(
        address _agentVault
    ) external payable;

    ////////////////////////////////////////////////////////////////////////////////////
    // Agent information

    /**
     * Get (a part of) the list of all agents.
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAllAgents(uint256 _start, uint256 _end)
        external view
        returns (address[] memory _agentVaults, uint256 _totalLength);

    /**
     * Return detailed info about an agent, typically needed by a minter.
     * @param _agentVault agent vault address
     * @return structure containing agent's minting fee (BIPS), min collateral ratio (BIPS),
     *      and current free collateral (lots)
     */
    function getAgentInfo(address _agentVault)
        external view
        returns (AgentInfo.Info memory);

    /**
     * Returns the collateral pool address of the agent identified by `_agentVault`.
     */
    function getCollateralPool(address _agentVault)
        external view
        returns (address);

    /**
     * Return hot and cold address of the owner of the agent identified by `_agentVault`.
     */
    function getAgentVaultOwner(address _agentVault)
        external view
        returns (address _ownerColdAddress, address _ownerHotAddress);

    ////////////////////////////////////////////////////////////////////////////////////
    // List of available agents (i.e. publicly available for minting).

    /**
     * Add the agent to the list of publicly available agents.
     * Other agents can only self-mint.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function makeAgentAvailable(
        address _agentVault
    ) external;

    /**
     * Announce exit from the publicly available agents list.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function announceExitAvailableAgentList(
        address _agentVault
    ) external;

    /**
     * Exit the publicly available agents list.
     * NOTE: may only be called by the agent vault owner and after announcement.
     * @param _agentVault agent vault address
     */
    function exitAvailableAgentList(
        address _agentVault
    ) external;

    /**
     * Get (a part of) the list of available agents.
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAvailableAgentsList(uint256 _start, uint256 _end)
        external view
        returns (address[] memory _agentVaults, uint256 _totalLength);

    /**
     * Get (a part of) the list of available agents with extra information about agents' fee, min collateral ratio
     * and available collateral (in lots).
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * NOTE: agent's available collateral can change anytime due to price changes, minting, or changes
     * in agent's min collateral ratio, so it is only to be used as estimate.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAvailableAgentsDetailedList(uint256 _start, uint256 _end)
        external view
        returns (AvailableAgentInfo.Data[] memory _agents, uint256 _totalLength);

    ////////////////////////////////////////////////////////////////////////////////////
    // Minting

    /**
     * Before paying underlying assets for minting, minter has to reserve collateral and
     * pay collateral reservation fee. Collateral is reserved at ratio of agent's agentMinCollateralRatio
     * to requested lots NAT market price.
     * On success the minter receives instructions for underlying payment (value, fee and payment reference)
     * in event CollateralReserved. Then the minter has to pay `value + fee` on the underlying chain.
     * If the minter pays the underlying amount, the collateral reservation fee is burned and minter obtains
     * f-assets. Otherwise the agent collects the collateral reservation fee.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * NOTE: the owner of the agent vault must be whitelisted agent.
     * @param _agentVault agent vault address
     * @param _lots the number of lots for which to reserve collateral
     * @param _maxMintingFeeBIPS maximum minting fee (BIPS) that can be charged by the agent - best is just to
     *      copy current agent's published fee; used to prevent agent from front-running reservation request
     *      and increasing fee (that would mean that the minter would have to pay raised fee or forfeit
     *      collateral reservation fee)
     */
    function reserveCollateral(
        address _agentVault,
        uint256 _lots,
        uint256 _maxMintingFeeBIPS
    ) external payable;

    /**
     * Return the collateral reservation fee amount that has to be passed to the reserveCollateral method.
     * @param _lots the number of lots for which to reserve collateral
     * @return _reservationFeeNATWei the amount of reservation fee in NAT wei
     */
    function collateralReservationFee(uint256 _lots)
        external view
        returns (uint256 _reservationFeeNATWei);

    /**
     * After obtaining proof of underlying payment, the minter calls this method to finish the minting
     * and collect the minted f-assets.
     * NOTE: may only be called by the minter (= creator of CR, the collateral reservation request)
     *   or the agent owner (= owner of the agent vault in CR).
     * @param _payment proof of the underlying payment (must contain exact `value + fee` amount and correct
     *      payment reference)
     * @param _collateralReservationId collateral reservation id
     */
    function executeMinting(
        IAttestationClient.Payment calldata _payment,
        uint256 _collateralReservationId
    ) external;

    /**
     * When the time for minter to pay underlying amount is over (i.e. the last underlying block has passed),
     * the agent can declare payment default. Then the agent collects collateral reservation fee
     * (it goes directly to the vault), and the reserved collateral is unlocked.
     * NOTE: may only be called by the owner of the agent vault in the collateral reservation request.
     * @param _proof proof that the minter didn't pay with correct payment reference on the underlying chain
     * @param _collateralReservationId id of a collateral reservation created by the minter
     */
    function mintingPaymentDefault(
        IAttestationClient.ReferencedPaymentNonexistence calldata _proof,
        uint256 _collateralReservationId
    ) external;

    /**
     * If collateral reservation request exists for more than 24 hours, payment or non-payment proof are no longer
     * available. In this case agent can call this method, which burns reserved collateral at market price
     * and releases the remaining collateral (CRF is also burned).
     * NOTE: may only be called by the owner of the agent vault in the collateral reservation request.
     * NOTE: the agent (cold address) receives the class1 collateral and NAT is burned instead. Therefore
     *      this method is `payable` and the caller must provide enough NAT to cover the received class1 amount
     *      multiplied by `class1BuyForFlareFactorBIPS`.
     * @param _proof proof that the attestation query window can not not contain
     *      the payment/non-payment proof anymore
     * @param _collateralReservationId collateral reservation id
     */
    function unstickMinting(
        IAttestationClient.ConfirmedBlockHeightExists calldata _proof,
        uint256 _collateralReservationId
    ) external payable;

    /**
     * Agent can mint against himself. In that case, this is a one-step process, skipping collateral reservation
     * and no collateral reservation fee payment.
     * Moreover, the agent doesn't have to be on the publicly available agents list to self-mint.
     * NOTE: may only be called by the agent vault owner.
     * NOTE: the caller must be a whitelisted agent.
     * @param _payment proof of the underlying payment; must contain payment reference of the form
     *      `0x4642505266410012000...0<agent_vault_address>`
     * @param _agentVault agent vault address
     * @param _lots number of lots to mint
     */
    function selfMint(
        IAttestationClient.Payment calldata _payment,
        address _agentVault,
        uint256 _lots
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Redemption

    /**
     * Redeem (up to) `_lots` lots of f-assets. The corresponding amount of the f-assets belonging
     * to the redeemer will be burned and the redeemer will get paid by the agent in underlying currency
     * (or, in case of agent's payment default, by agent's collateral with a premium).
     * NOTE: in some cases not all sent f-assets can be redeemed (either there are not enough tickets or
     * more than a fixed limit of tickets should be redeemed). In this case only part of the approved assets
     * are burned and redeemed and the redeemer can execute this method again for the remaining lots.
     * In such case `RedemptionRequestIncomplete` event will be emitted, indicating the number of remaining lots.
     * Agent receives redemption request id and instructions for underlying payment in
     * RedemptionRequested event and has to pay `value - fee` and use the provided payment reference.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _lots number of lots to redeem
     * @param _redeemerUnderlyingAddressString the address to which the agent must transfer underlying amount
     */
    function redeem(
        uint256 _lots,
        string memory _redeemerUnderlyingAddressString
    ) external;

    /**
     * After paying to the redeemer, the agent must call this method to unlock the collateral
     * and to make sure that the redeemer cannot demand payment in collateral on timeout.
     * The same method must be called for any payment status (SUCCESS, FAILED, BLOCKED).
     * In case of FAILED, it just releases agent's underlying funds and the redeemer gets paid in collateral
     * after calling redemptionPaymentDefault.
     * In case of SUCCESS or BLOCKED, remaining underlying funds and collateral are released to the agent.
     * If the agent doesn't confirm payment in enough time (several hours, setting confirmationByOthersAfterSeconds),
     * anybody can do it and get rewarded from agent's vault.
     * NOTE: may only be called by the owner of the agent vault in the redemption request
     *   except if enough time has passed without confirmation - then it can be called by anybody
     * @param _payment proof of the underlying payment (must contain exact `value - fee` amount and correct
     *      payment reference)
     * @param _redemptionRequestId id of an existing redemption request
     */
    function confirmRedemptionPayment(
        IAttestationClient.Payment calldata _payment,
        uint256 _redemptionRequestId
    ) external;

    /**
     * If the agent doesn't transfer the redeemed underlying assets in time (until the last allowed block on
     * the underlying chain), the redeemer calls this method and receives payment in collateral (with some extra).
     * The agent can also call default if the redeemer is unresponsive, to payout the redeemer and free the
     * remaining collateral.
     * NOTE: may only be called by the redeemer (= creator of the redemption request)
     *   or the agent owner (= owner of the agent vault in the redemption request)
     * @param _proof proof that the agent didn't pay with correct payment reference on the underlying chain
     * @param _redemptionRequestId id of an existing redemption request
     */
    function redemptionPaymentDefault(
        IAttestationClient.ReferencedPaymentNonexistence calldata _proof,
        uint256 _redemptionRequestId
    ) external;

    /**
     * If the agent hasn't performed the payment, the agent can close the redemption request to free underlying funds.
     * It can be done immediately after the redeemer or agent calls redemptionPaymentDefault,
     * or this method can trigger the default payment without proof, but only after enough time has passed so that
     * attestation proof of non-payment is not available any more.
     * NOTE: may only be called by the owner of the agent vault in the redemption request.
     * @param _proof proof that the attestation query window can not not contain
     *      the payment/non-payment proof anymore
     * @param _redemptionRequestId id of an existing, but already defaulted, redemption request
     */
    function finishRedemptionWithoutPayment(
        IAttestationClient.ConfirmedBlockHeightExists calldata _proof,
        uint256 _redemptionRequestId
    ) external;

    /**
     * Agent can "redeem against himself" by calling selfClose, which burns agent's own f-assets
     * and unlocks agent's collateral. The underlying funds backing the f-assets are released
     * as agent's free underlying funds and can be later withdrawn after announcement.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _amountUBA amount of f-assets to self-close
     */
    function selfClose(
        address _agentVault,
        uint256 _amountUBA
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Dust

    /**
     * Due to minting pool fees or after a lot size change by the governance,
     * it may happen that less than one lot remains on a redemption ticket. This is named "dust" and
     * can be self closed or liquidated, but not redeemed. However, after several additions,
     * the total dust can amount to more than one lot. Using this method, the amount, rounded down
     * to a whole number of lots, can be converted to a new redemption ticket.
     * NOTE: we do NOT check that the caller is the agent vault owner, since we want to
     * allow anyone to convert dust to tickets to increase asset fungibility.
     * NOTE: dust above 1 lot is actually added to ticket at every minting, so this function need
     * only be called when the agent doesn't have any minting.
     * @param _agentVault agent vault address
     */
    function convertDustToTicket(
        address _agentVault
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Liquidation

    /**
     * Checks that the agent's collateral is too low and if true, starts agent's liquidation.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _agentVault agent vault address
     */
    function startLiquidation(
        address _agentVault
    ) external;

    /**
     * Burns up to `_amountUBA` f-assets owned by the caller and pays
     * the caller the corresponding amount of native currency with premium
     * (premium depends on the liquidation state).
     * If the agent isn't in liquidation yet, but satisfies conditions,
     * automatically puts the agent in liquidation status.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _agentVault agent vault address
     * @param _amountUBA the amount of f-assets to liquidate
     * @return _liquidatedAmountUBA liquidated amount of f-asset
     * @return _amountPaidClass1 amount paid to liquidator (in agents class 1)
     * @return _amountPaidPool amount paid to liquidator (in NAT from pool)
     */
    function liquidate(
        address _agentVault,
        uint256 _amountUBA
    ) external
        returns (uint256 _liquidatedAmountUBA, uint256 _amountPaidClass1, uint256 _amountPaidPool);

    /**
     * When agent's collateral reaches safe level during liquidation, the liquidation
     * process can be stopped by calling this method.
     * Full liquidation (i.e. the liquidation triggered by illegal underlying payment)
     * cannot be stopped.
     * NOTE: anybody can call.
     * @param _agentVault agent vault address
     */
    function endLiquidation(
        address _agentVault
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Challenges

    /**
     * Called with a proof of payment made from agent's underlying address, for which
     * no valid payment reference exists (valid payment references are from redemption and
     * underlying withdrawal announcement calls).
     * On success, immediately triggers full agent liquidation and rewards the caller.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _transaction proof of a transaction from the agent's underlying address
     * @param _agentVault agent vault address
     */
    function illegalPaymentChallenge(
        IAttestationClient.BalanceDecreasingTransaction calldata _transaction,
        address _agentVault
    ) external;

    /**
     * Called with proofs of two payments made from agent's underlying address
     * with the same payment reference (each payment reference is valid for only one payment).
     * On success, immediately triggers full agent liquidation and rewards the caller.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _payment1 proof of first payment from the agent's underlying address
     * @param _payment2 proof of second payment from the agent's underlying address
     * @param _agentVault agent vault address
     */
    function doublePaymentChallenge(
        IAttestationClient.BalanceDecreasingTransaction calldata _payment1,
        IAttestationClient.BalanceDecreasingTransaction calldata _payment2,
        address _agentVault
    ) external;

    /**
     * Called with proofs of several (otherwise legal) payments, which together make agent's
     * underlying free balance negative (i.e. the underlying address balance is less than
     * the total amount of backed f-assets).
     * On success, immediately triggers full agent liquidation and rewards the caller.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _payments proofs of several distinct payments from the agent's underlying address
     * @param _agentVault agent vault address
     */
    function freeBalanceNegativeChallenge(
        IAttestationClient.BalanceDecreasingTransaction[] calldata _payments,
        address _agentVault
    ) external;
}
