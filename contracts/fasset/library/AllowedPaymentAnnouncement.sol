// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./PaymentVerification.sol";
import "./PaymentReference.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./UnderlyingFreeBalance.sol";
import "./AssetManagerState.sol";


library AllowedPaymentAnnouncement {
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
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault,
        uint64 _announcementId
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.ongoingAnnouncedPaymentId != 0, "no active announcement");
        uint256 paymentReference = PaymentReference.announcedWithdrawal(agent.ongoingAnnouncedPaymentId);
        require(_paymentInfo.paymentReference == paymentReference, "wrong announced pmt reference");
        require(_paymentInfo.sourceAddressHash == agent.underlyingAddressHash,
            "wrong announced pmt source");
        require(!PaymentVerification.transactionConfirmed(_state.paymentVerifications, _paymentInfo),
            "announced pmt confirmed");
        // clear active payment announcement
        agent.ongoingAnnouncedPaymentId = 0;
        // update free underlying balance and trigger liquidation if negative
        UnderlyingFreeBalance.updateFreeBalance(_state, _agentVault, -_paymentInfo.spentUBA);
        // send event
        emit AMEvents.AllowedPaymentConfirmed(_agentVault, _paymentInfo.spentUBA, 
            _paymentInfo.underlyingBlock, _announcementId);
    }
}
