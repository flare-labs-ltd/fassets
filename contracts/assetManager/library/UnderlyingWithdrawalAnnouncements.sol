// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "flare-smart-contracts-v2/contracts/userInterfaces/IFdcVerification.sol";
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
        internal
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
        IPayment.Proof calldata _payment,
        address _agentVault
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        TransactionAttestation.verifyPayment(_payment);
        Agent.State storage agent = Agent.get(_agentVault);
        bool isAgent = Agents.isOwner(agent, msg.sender);
        uint64 announcementId = agent.announcedUnderlyingWithdrawalId;
        require(announcementId != 0, "no active announcement");
        bytes32 paymentReference = PaymentReference.announcedWithdrawal(announcementId);
        require(_payment.data.responseBody.standardPaymentReference == paymentReference,
            "wrong announced pmt reference");
        require(_payment.data.responseBody.sourceAddressHash == agent.underlyingAddressHash,
            "wrong announced pmt source");
        require(isAgent || block.timestamp >
                agent.underlyingWithdrawalAnnouncedAt + settings.confirmationByOthersAfterSeconds,
            "only agent vault owner");
        require(block.timestamp >
            agent.underlyingWithdrawalAnnouncedAt + settings.announcedUnderlyingConfirmationMinSeconds,
            "confirmation too soon");
        // make sure withdrawal cannot be challenged as invalid
        state.paymentConfirmations.confirmSourceDecreasingTransaction(_payment);
        // clear active withdrawal announcement
        agent.announcedUnderlyingWithdrawalId = 0;
        // update free underlying balance and trigger liquidation if negative
        UnderlyingBalance.updateBalance(agent, -_payment.data.responseBody.spentAmount);
        // if the confirmation was done by someone else than agent, pay some reward from agent's vault
        if (!isAgent) {
            Agents.payoutFromVault(agent, msg.sender,
                Agents.convertUSD5ToVaultCollateralWei(agent, settings.confirmationByOthersRewardUSD5));
        }
        // send event
        emit AMEvents.UnderlyingWithdrawalConfirmed(_agentVault, announcementId,
            _payment.data.responseBody.spentAmount, _payment.data.requestBody.transactionId);
    }

    function cancelUnderlyingWithdrawal(
        address _agentVault
    )
        internal
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        Agents.requireAgentVaultOwner(_agentVault);
        Agent.State storage agent = Agent.get(_agentVault);
        uint64 announcementId = agent.announcedUnderlyingWithdrawalId;
        require(announcementId != 0, "no active announcement");
        require(block.timestamp >
            agent.underlyingWithdrawalAnnouncedAt + settings.announcedUnderlyingConfirmationMinSeconds,
            "cancel too soon");
        // clear active withdrawal announcement
        agent.announcedUnderlyingWithdrawalId = 0;
        // send event
        emit AMEvents.UnderlyingWithdrawalCancelled(_agentVault, announcementId);
    }
}
