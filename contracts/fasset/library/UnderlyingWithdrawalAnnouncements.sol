// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../generated/interface/IAttestationClient.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./UnderlyingBalance.sol";
import "./TransactionAttestation.sol";


library UnderlyingWithdrawalAnnouncements {
    using SafeCast for uint256;
    using PaymentConfirmations for PaymentConfirmations.State;

    function announceUnderlyingWithdrawal(
        address _agentVault
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agents.requireAgentVaultOwner(_agentVault);
        Agent.State storage agent = Agent.get(_agentVault);
        require(agent.announcedUnderlyingWithdrawalId == 0, "announced underlying withdrawal active");
        state.newPaymentAnnouncementId += PaymentReference.randomizedIdSkip();
        uint64 announcementId = state.newPaymentAnnouncementId;
        agent.announcedUnderlyingWithdrawalId = announcementId;
        agent.underlyingWithdrawalAnnouncedAt = block.timestamp.toUint64();
        bytes32 paymentReference = PaymentReference.announcedWithdrawal(announcementId);
        emit AMEvents.UnderlyingWithdrawalAnnounced(_agentVault, announcementId, paymentReference);
    }

    function confirmUnderlyingWithdrawal(
        IAttestationClient.Payment calldata _payment,
        address _agentVault
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        TransactionAttestation.verifyPayment(_payment);
        Agent.State storage agent = Agent.get(_agentVault);
        bool isAgent = Agents.isOwner(agent, msg.sender);
        uint64 announcementId = agent.announcedUnderlyingWithdrawalId;
        require(announcementId != 0, "no active announcement");
        bytes32 paymentReference = PaymentReference.announcedWithdrawal(announcementId);
        require(_payment.paymentReference == paymentReference, "wrong announced pmt reference");
        require(_payment.sourceAddressHash == agent.underlyingAddressHash,
            "wrong announced pmt source");
        require(isAgent || block.timestamp >
                agent.underlyingWithdrawalAnnouncedAt + state.settings.confirmationByOthersAfterSeconds,
            "only agent vault owner");
        require(block.timestamp >
            agent.underlyingWithdrawalAnnouncedAt + state.settings.announcedUnderlyingConfirmationMinSeconds,
            "confirmation too soon");
        // make sure withdrawal cannot be challenged as invalid
        state.paymentConfirmations.confirmSourceDecreasingTransaction(_payment);
        // clear active withdrawal announcement
        agent.announcedUnderlyingWithdrawalId = 0;
        // update free underlying balance and trigger liquidation if negative
        UnderlyingBalance.updateBalance(agent, -_payment.spentAmount);
        // if the confirmation was done by someone else than agent, pay some reward from agent's vault
        if (!isAgent) {
            Agents.payoutClass1(agent, msg.sender,
                Agents.convertUSD5ToClass1Wei(agent, state.settings.confirmationByOthersRewardUSD5));
        }
        // send event
        emit AMEvents.UnderlyingWithdrawalConfirmed(_agentVault, _payment.spentAmount,
            _payment.transactionHash, announcementId);
    }

    function cancelUnderlyingWithdrawal(
        address _agentVault
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agents.requireAgentVaultOwner(_agentVault);
        Agent.State storage agent = Agent.get(_agentVault);
        uint64 announcementId = agent.announcedUnderlyingWithdrawalId;
        require(announcementId != 0, "no active announcement");
        require(block.timestamp >
            agent.underlyingWithdrawalAnnouncedAt + state.settings.announcedUnderlyingConfirmationMinSeconds,
            "cancel too soon");
        // clear active withdrawal announcement
        agent.announcedUnderlyingWithdrawalId = 0;
        // send event
        emit AMEvents.UnderlyingWithdrawalCancelled(_agentVault, announcementId);
    }
}
