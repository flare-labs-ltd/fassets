// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interface/IAttestationClient.sol";
import "./PaymentVerification.sol";
import "./PaymentReference.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./UnderlyingFreeBalance.sol";
import "./AssetManagerState.sol";


library AllowedPaymentAnnouncement {
    using PaymentVerification for PaymentVerification.State;
    
    function announceAllowedPayment(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.ongoingAnnouncedPaymentId == 0, "announced payment active");
        uint64 announcementId = ++_state.newPaymentAnnouncementId;
        agent.ongoingAnnouncedPaymentId = announcementId;
        uint256 paymentReference = PaymentReference.announcedWithdrawal(announcementId);
        emit AMEvents.AllowedPaymentAnnounced(_agentVault, announcementId, paymentReference);
    }
    
    function confirmAllowedPayment(
        AssetManagerState.State storage _state,
        IAttestationClient.PaymentProof calldata _payment,
        address _agentVault,
        uint64 _announcementId
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.ongoingAnnouncedPaymentId != 0, "no active announcement");
        uint256 paymentReference = PaymentReference.announcedWithdrawal(agent.ongoingAnnouncedPaymentId);
        require(_payment.paymentReference == paymentReference, "wrong announced pmt reference");
        require(_payment.sourceAddress == agent.underlyingAddressHash,
            "wrong announced pmt source");
        // make sure payment cannot be challenged as invalid
        _state.paymentVerifications.confirmSourceDecreasingTransaction(_payment);
        // clear active payment announcement
        agent.ongoingAnnouncedPaymentId = 0;
        // update free underlying balance and trigger liquidation if negative
        UnderlyingFreeBalance.updateFreeBalance(_state, _agentVault, -_payment.spentAmount);
        // send event
        emit AMEvents.AllowedPaymentConfirmed(_agentVault, _payment.spentAmount, 
            _payment.blockNumber, _announcementId);
    }
}
