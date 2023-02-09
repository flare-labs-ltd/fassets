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


library UnderlyingWithdrawalAnnouncements {
    using PaymentConfirmations for PaymentConfirmations.State;
    
    function announceUnderlyingWithdrawal(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.announcedUnderlyingWithdrawalId == 0, "announced underlying withdrawal active");
        _state.newPaymentAnnouncementId += PaymentReference.randomizedIdSkip();
        uint64 announcementId = _state.newPaymentAnnouncementId;
        agent.announcedUnderlyingWithdrawalId = announcementId;
        agent.underlyingWithdrawalAnnouncedAt = SafeCast.toUint64(block.timestamp);
        bytes32 paymentReference = PaymentReference.announcedWithdrawal(announcementId);
        emit AMEvents.UnderlyingWithdrawalAnnounced(_agentVault, announcementId, paymentReference);
    }
    
    function confirmUnderlyingWithdrawal(
        AssetManagerState.State storage _state,
        IAttestationClient.Payment calldata _payment,
        address _agentVault
    )
        external
    {
        TransactionAttestation.verifyPayment(_state.settings, _payment);
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        bool isAgent = msg.sender == Agents.vaultOwner(_agentVault);
        uint64 announcementId = agent.announcedUnderlyingWithdrawalId;
        require(announcementId != 0, "no active announcement");
        bytes32 paymentReference = PaymentReference.announcedWithdrawal(announcementId);
        require(_payment.paymentReference == paymentReference, "wrong announced pmt reference");
        require(_payment.sourceAddressHash == agent.underlyingAddressHash,
            "wrong announced pmt source");
        require(isAgent || block.timestamp > 
                agent.underlyingWithdrawalAnnouncedAt + _state.settings.confirmationByOthersAfterSeconds,
            "only agent vault owner");
        require(block.timestamp > 
            agent.underlyingWithdrawalAnnouncedAt + _state.settings.announcedUnderlyingConfirmationMinSeconds,
            "confirmation too soon");
        // make sure withdrawal cannot be challenged as invalid
        _state.paymentConfirmations.confirmSourceDecreasingTransaction(_payment);
        // clear active withdrawal announcement
        agent.announcedUnderlyingWithdrawalId = 0;
        // update free underlying balance and trigger liquidation if negative
        UnderlyingFreeBalance.updateFreeBalance(_state, _agentVault, -_payment.spentAmount);
        // if the confirmation was done by someone else than agent, pay some reward from agent's vault
        if (!isAgent) {
            Agents.payoutClass1(_state, _agentVault, msg.sender, _state.settings.confirmationByOthersRewardC1Wei);
        }
        // send event
        emit AMEvents.UnderlyingWithdrawalConfirmed(_agentVault, _payment.spentAmount, 
            _payment.transactionHash, announcementId);
    }

    function cancelUnderlyingWithdrawal(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        uint64 announcementId = agent.announcedUnderlyingWithdrawalId;
        require(announcementId != 0, "no active announcement");
        require(block.timestamp > 
            agent.underlyingWithdrawalAnnouncedAt + _state.settings.announcedUnderlyingConfirmationMinSeconds,
            "cancel too soon");
        // clear active withdrawal announcement
        agent.announcedUnderlyingWithdrawalId = 0;
        // send event
        emit AMEvents.UnderlyingWithdrawalCancelled(_agentVault, announcementId);
    }
}
