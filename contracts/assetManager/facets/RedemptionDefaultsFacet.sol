// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../library/RedemptionFailures.sol";
import "./AssetManagerBase.sol";


contract RedemptionDefaultsFacet is AssetManagerBase {
    using SafeCast for uint256;

    /**
     * If the agent doesn't transfer the redeemed underlying assets in time (until the last allowed block on
     * the underlying chain), the redeemer calls this method and receives payment in collateral (with some extra).
     * The agent can also call default if the redeemer is unresponsive, to payout the redeemer and free the
     * remaining collateral.
     * NOTE: The attestation request must be done with `checkSourceAddresses=false`.
     * NOTE: may only be called by the redeemer (= creator of the redemption request),
     *   the executor appointed by the redeemer,
     *   or the agent owner (= owner of the agent vault in the redemption request)
     * @param _proof proof that the agent didn't pay with correct payment reference on the underlying chain
     * @param _redemptionRequestId id of an existing redemption request
     */
    function redemptionPaymentDefault(
        IReferencedPaymentNonexistence.Proof calldata _proof,
        uint256 _redemptionRequestId
    )
        external
    {
        RedemptionFailures.redemptionPaymentDefault(_proof, _redemptionRequestId.toUint64());
    }

    /**
     * If the agent rejected the redemption request and no other agent took over the redemption,
     * the redeemer calls this method and receives payment in collateral (with some extra).
     * The agent can also call default if the redeemer is unresponsive, to payout the redeemer and free the
     * remaining collateral.
     * NOTE: may only be called by the redeemer (= creator of the redemption request),
     *   the executor appointed by the redeemer,
     *   or the agent owner (= owner of the agent vault in the redemption request)
     * @param _redemptionRequestId id of an existing redemption request
     */
    function rejectedRedemptionPaymentDefault(
        uint256 _redemptionRequestId
    )
        external
    {
        RedemptionFailures.rejectedRedemptionPaymentDefault(_redemptionRequestId.toUint64());
    }

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
        IConfirmedBlockHeightExists.Proof calldata _proof,
        uint256 _redemptionRequestId
    )
        external
    {
        RedemptionFailures.finishRedemptionWithoutPayment(_proof, _redemptionRequestId.toUint64());
    }
}
