// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../library/UnderlyingBalance.sol";
import "../library/UnderlyingWithdrawalAnnouncements.sol";
import "./AssetManagerBase.sol";


contract UnderlyingBalanceFacet is AssetManagerBase {
    /**
     * When the agent tops up his underlying address, it has to be confirmed by calling this method,
     * which updates the underlying free balance value.
     * NOTE: may only be called by the agent vault owner.
     * @param _payment proof of the underlying payment; must include payment
     *      reference of the form `0x4642505266410011000...0<agents_vault_address>`
     * @param _agentVault agent vault address
     */
    function confirmTopupPayment(
        IPayment.Proof calldata _payment,
        address _agentVault
    )
        external
    {
        UnderlyingBalance.confirmTopupPayment(_payment, _agentVault);
    }

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
    )
        external
    {
        UnderlyingWithdrawalAnnouncements.announceUnderlyingWithdrawal(_agentVault);
    }

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
        IPayment.Proof calldata _payment,
        address _agentVault
    )
        external
    {
        UnderlyingWithdrawalAnnouncements.confirmUnderlyingWithdrawal(_payment, _agentVault);
    }

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
    )
        external
    {
        UnderlyingWithdrawalAnnouncements.cancelUnderlyingWithdrawal(_agentVault);
    }
}
