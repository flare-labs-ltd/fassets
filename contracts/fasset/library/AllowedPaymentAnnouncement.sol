// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../generated/interface/IAttestationClient.sol";
import "./PaymentConfirmations.sol";
import "./PaymentReference.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./UnderlyingFreeBalance.sol";
import "./AssetManagerState.sol";
import "./TransactionAttestation.sol";


library AllowedPaymentAnnouncement {
    using PaymentConfirmations for PaymentConfirmations.State;
    
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
        agent.ongoingAnnouncedPaymentTimestamp = SafeCast.toUint64(block.timestamp);
        bytes32 paymentReference = PaymentReference.announcedWithdrawal(announcementId);
        emit AMEvents.AllowedPaymentAnnounced(_agentVault, announcementId, paymentReference);
    }
    
    function confirmAllowedPayment(
        AssetManagerState.State storage _state,
        IAttestationClient.Payment calldata _payment,
        address _agentVault,
        uint64 _announcementId
    )
        external
    {
        TransactionAttestation.verifyPayment(_state.settings, _payment);
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        bool isAgent = msg.sender == Agents.vaultOwner(_agentVault);
        require(agent.ongoingAnnouncedPaymentId != 0, "no active announcement");
        bytes32 paymentReference = PaymentReference.announcedWithdrawal(agent.ongoingAnnouncedPaymentId);
        require(_payment.paymentReference == paymentReference, "wrong announced pmt reference");
        require(_payment.sourceAddress == agent.underlyingAddressHash,
            "wrong announced pmt source");
        require(isAgent || block.timestamp > 
                agent.ongoingAnnouncedPaymentTimestamp + _state.settings.confirmationByOthersAfterSeconds,
            "only agent vault owner");
        // make sure payment cannot be challenged as invalid
        _state.paymentConfirmations.confirmSourceDecreasingTransaction(_payment);
        // clear active payment announcement
        agent.ongoingAnnouncedPaymentId = 0;
        // update free underlying balance and trigger liquidation if negative
        UnderlyingFreeBalance.updateFreeBalance(_state, _agentVault, -_payment.spentAmount);
        // if the confirmation was done by someone else than agent, pay some reward from agent's vault
        if (!isAgent) {
            Agents.payout(_state, _agentVault, msg.sender, _state.settings.confirmationByOthersRewardNATWei);
        }
        // send event
        emit AMEvents.AllowedPaymentConfirmed(_agentVault, _payment.spentAmount, 
            _payment.blockNumber, _announcementId);
    }
}
