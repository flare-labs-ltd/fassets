// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../userInterfaces/assetManager/IRedemptionConfirmations.sol";
import "../library/RedemptionConfirmations.sol";
import "./AssetManagerBase.sol";


contract RedemptionConfirmationsFacet is AssetManagerBase, IRedemptionConfirmations {
    using SafeCast for uint256;

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
        Payment.Proof calldata _payment,
        uint256 _redemptionRequestId
    )
        external override
    {
        RedemptionConfirmations.confirmRedemptionPayment(_payment, _redemptionRequestId.toUint64());
    }
}
