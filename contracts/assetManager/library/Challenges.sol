// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "flare-smart-contracts-v2/contracts/userInterfaces/IFdcVerification.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";
import "./Conversion.sol";
import "./Agents.sol";
import "./Liquidation.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";
import "./UnderlyingBalance.sol";


library Challenges {
    using SafeCast for *;
    using SafePct for *;
    using PaymentConfirmations for PaymentConfirmations.State;

    function illegalPaymentChallenge(
        IBalanceDecreasingTransaction.Proof calldata _payment,
        address _agentVault
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        Agent.State storage agent = Agent.get(_agentVault);
        // if the agent is already being fully liquidated, no need for more challenges
        // this also prevents double challenges
        require(agent.status != Agent.Status.FULL_LIQUIDATION, "chlg: already liquidating");
        // verify transaction
        TransactionAttestation.verifyBalanceDecreasingTransaction(_payment);
        // check the payment originates from agent's address
        require(_payment.data.responseBody.sourceAddressHash == agent.underlyingAddressHash,
            "chlg: not agent's address");
        // check that proof of this tx wasn't used before - otherwise we could
        // trigger liquidation for already proved redemption payments
        require(!state.paymentConfirmations.transactionConfirmed(_payment), "chlg: transaction confirmed");
        // check that payment reference is invalid (paymentReference == 0 is always invalid payment)
        bytes32 paymentReference = _payment.data.responseBody.standardPaymentReference;
        if (paymentReference != 0) {
            if (PaymentReference.isValid(paymentReference, PaymentReference.REDEMPTION)) {
                uint256 redemptionId = PaymentReference.decodeId(paymentReference);
                Redemption.Request storage redemption = state.redemptionRequests[redemptionId];
                // Redemption must be for the correct agent and
                // only statuses ACTIVE and DEFAULTED mean that redemption is still missing a payment proof.
                // Also, payment can be a bit late, but must not be later than twice the time for successful
                // redemption payment (therefore we use lastBlock + maxBlocks and likewise for timestamp).
                bool redemptionActive = redemption.agentVault == _agentVault
                    && (redemption.status == Redemption.Status.ACTIVE ||
                        redemption.status == Redemption.Status.DEFAULTED)
                    && (_payment.data.responseBody.blockNumber <=
                            redemption.lastUnderlyingBlock + settings.underlyingBlocksForPayment ||
                        _payment.data.responseBody.blockTimestamp <=
                            redemption.lastUnderlyingTimestamp + settings.underlyingSecondsForPayment);
                require(!redemptionActive, "matching redemption active");
            }
            if (PaymentReference.isValid(paymentReference, PaymentReference.ANNOUNCED_WITHDRAWAL)) {
                uint256 announcementId = PaymentReference.decodeId(paymentReference);
                // valid announced withdrawal cannot have announcementId == 0 and must match the agent's announced id
                // but PaymentReference.isValid already checks that id in the reference != 0, so no extra check needed
                require(announcementId != agent.announcedUnderlyingWithdrawalId, "matching ongoing announced pmt");
            }
        }
        // start liquidation and reward challengers
        _liquidateAndRewardChallenger(agent, msg.sender, agent.mintedAMG);
        // emit events
        emit IAssetManagerEvents.IllegalPaymentConfirmed(_agentVault, _payment.data.requestBody.transactionId);
    }

    function doublePaymentChallenge(
        IBalanceDecreasingTransaction.Proof calldata _payment1,
        IBalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault
    )
        internal
    {
        Agent.State storage agent = Agent.get(_agentVault);
        // if the agent is already being fully liquidated, no need for more challenges
        // this also prevents double challenges
        require(agent.status != Agent.Status.FULL_LIQUIDATION, "chlg dbl: already liquidating");
        // verify transactions
        TransactionAttestation.verifyBalanceDecreasingTransaction(_payment1);
        TransactionAttestation.verifyBalanceDecreasingTransaction(_payment2);
        // check the payments are unique and originate from agent's address
        require(_payment1.data.requestBody.transactionId != _payment2.data.requestBody.transactionId,
            "chlg dbl: same transaction");
        require(_payment1.data.responseBody.sourceAddressHash == agent.underlyingAddressHash,
            "chlg 1: not agent's address");
        require(_payment2.data.responseBody.sourceAddressHash == agent.underlyingAddressHash,
            "chlg 2: not agent's address");
        // payment references must be equal
        require(_payment1.data.responseBody.standardPaymentReference ==
            _payment2.data.responseBody.standardPaymentReference, "challenge: not duplicate");
        // ! no need to check that transaction wasn't confirmed - this is always illegal
        // start liquidation and reward challengers
        _liquidateAndRewardChallenger(agent, msg.sender, agent.mintedAMG);
        // emit events
        emit IAssetManagerEvents.DuplicatePaymentConfirmed(_agentVault, _payment1.data.requestBody.transactionId,
            _payment2.data.requestBody.transactionId);
    }

    function paymentsMakeFreeBalanceNegative(
        IBalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(_agentVault);
        // if the agent is already being fully liquidated, no need for more challenges
        // this also prevents double challenges
        require(agent.status != Agent.Status.FULL_LIQUIDATION, "mult chlg: already liquidating");
        // check the payments originates from agent's address, are not confirmed already and calculate total
        int256 total = 0;
        for (uint256 i = 0; i < _payments.length; i++) {
            IBalanceDecreasingTransaction.Proof calldata pmi = _payments[i];
            TransactionAttestation.verifyBalanceDecreasingTransaction(pmi);
            // check there are no duplicate transactions
            for (uint256 j = 0; j < i; j++) {
                require(_payments[j].data.requestBody.transactionId != pmi.data.requestBody.transactionId,
                    "mult chlg: repeated transaction");
            }
            require(pmi.data.responseBody.sourceAddressHash == agent.underlyingAddressHash,
                "mult chlg: not agent's address");
            if (state.paymentConfirmations.transactionConfirmed(pmi)) {
                continue;   // ignore payments that have already been confirmed
            }
            bytes32 paymentReference = pmi.data.responseBody.standardPaymentReference;
            if (PaymentReference.isValid(paymentReference, PaymentReference.REDEMPTION)) {
                // for redemption, we don't count the value that should be paid to free balance deduction
                uint256 redemptionId = PaymentReference.decodeId(pmi.data.responseBody.standardPaymentReference);
                Redemption.Request storage request = state.redemptionRequests[redemptionId];
                total += pmi.data.responseBody.spentAmount - SafeCast.toInt256(request.underlyingValueUBA);
            } else {
                // for other payment types (announced withdrawal), everything is paid from free balance
                total += pmi.data.responseBody.spentAmount;
            }
        }
        // check that total spent free balance is more than actual free underlying balance
        int256 balanceAfterPayments = agent.underlyingBalanceUBA - total;
        uint256 requiredBalance = UnderlyingBalance.requiredUnderlyingUBA(agent);
        require(balanceAfterPayments < requiredBalance.toInt256(), "mult chlg: enough balance");
        // start liquidation and reward challengers
        _liquidateAndRewardChallenger(agent, msg.sender, agent.mintedAMG);
        // emit events
        emit IAssetManagerEvents.UnderlyingBalanceTooLow(_agentVault, balanceAfterPayments, requiredBalance);
    }

    function _liquidateAndRewardChallenger(
        Agent.State storage _agent,
        address _challenger,
        uint64 _backingAMGAtChallenge
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // start full liquidation
        Liquidation.startFullLiquidation(_agent);
        // calculate the reward
        Collateral.Data memory collateralData =
            AgentCollateral.agentVaultCollateralData(_agent);
        uint256 rewardAMG = _backingAMGAtChallenge.mulBips(settings.paymentChallengeRewardBIPS);
        uint256 rewardC1Wei = Conversion.convertAmgToTokenWei(rewardAMG, collateralData.amgToTokenWeiPrice)
            + Agents.convertUSD5ToVaultCollateralWei(_agent, settings.paymentChallengeRewardUSD5);
        Agents.payoutFromVault(_agent, _challenger, rewardC1Wei);
    }
}
