// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../generated/interface/IAttestationClient.sol";


/**
 * Redemption, self close and dust management.
 */
interface IAssetManagerRedemption {
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
}
