// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../generated/interface/IAttestationClient.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
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
        IAttestationClient.BalanceDecreasingTransaction calldata _payment,
        address _agentVault
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(_agentVault);
        // if the agent is already being fully liquidated, no need for more challenges
        // this also prevents double challenges
        require(agent.status != Agent.Status.FULL_LIQUIDATION, "chlg: already liquidating");
        // verify transaction
        TransactionAttestation.verifyBalanceDecreasingTransaction(_payment);
        // check the payment originates from agent's address
        require(_payment.sourceAddressHash == agent.underlyingAddressHash, "chlg: not agent's address");
        // check that proof of this tx wasn't used before - otherwise we could
        // trigger liquidation for already proved redemption payments
        require(!state.paymentConfirmations.transactionConfirmed(_payment), "chlg: transaction confirmed");
        // check that payment reference is invalid (paymentReference == 0 is always invalid payment)
        if (_payment.paymentReference != 0) {
            if (PaymentReference.isValid(_payment.paymentReference, PaymentReference.REDEMPTION)) {
                uint256 redemptionId = PaymentReference.decodeId(_payment.paymentReference);
                Redemption.Request storage redemption = state.redemptionRequests[redemptionId];
                // Redemption must be for the correct agent and
                // only statuses ACTIVE and DEFAULTED mean that redemption is still missing a payment proof.
                // Also, payment can be a bit late, but must not be later than twice the time for successful
                // redemption payment (therefore we use lastBlock + maxBlocks and likewise for timestamp).
                bool redemptionActive = redemption.agentVault == _agentVault
                    && (redemption.status == Redemption.Status.ACTIVE ||
                        redemption.status == Redemption.Status.DEFAULTED)
                    && (_payment.blockNumber <=
                            redemption.lastUnderlyingBlock + state.settings.underlyingBlocksForPayment ||
                        _payment.blockTimestamp <=
                            redemption.lastUnderlyingTimestamp + state.settings.underlyingSecondsForPayment);
                require(!redemptionActive, "matching redemption active");
            }
            if (PaymentReference.isValid(_payment.paymentReference, PaymentReference.ANNOUNCED_WITHDRAWAL)) {
                uint256 announcementId = PaymentReference.decodeId(_payment.paymentReference);
                // valid announced withdrawal cannot have announcementId == 0 and must match the agent's announced id
                require(announcementId == 0 || announcementId != agent.announcedUnderlyingWithdrawalId,
                    "matching ongoing announced pmt");
            }
        }
        // start liquidation and reward challengers
        _liquidateAndRewardChallenger(agent, msg.sender, agent.mintedAMG);
        // emit events
        emit AMEvents.IllegalPaymentConfirmed(_agentVault, _payment.transactionHash);
    }

    function doublePaymentChallenge(
        IAttestationClient.BalanceDecreasingTransaction calldata _payment1,
        IAttestationClient.BalanceDecreasingTransaction calldata _payment2,
        address _agentVault
    )
        external
    {
        Agent.State storage agent = Agent.get(_agentVault);
        // if the agent is already being fully liquidated, no need for more challenges
        // this also prevents double challenges
        require(agent.status != Agent.Status.FULL_LIQUIDATION, "chlg dbl: already liquidating");
        // verify transactions
        TransactionAttestation.verifyBalanceDecreasingTransaction(_payment1);
        TransactionAttestation.verifyBalanceDecreasingTransaction(_payment2);
        // check the payments are unique and originate from agent's address
        require(_payment1.transactionHash != _payment2.transactionHash, "chlg dbl: same transaction");
        require(_payment1.sourceAddressHash == agent.underlyingAddressHash, "chlg 1: not agent's address");
        require(_payment2.sourceAddressHash == agent.underlyingAddressHash, "chlg 2: not agent's address");
        // payment references must be equal
        require(_payment1.paymentReference == _payment2.paymentReference, "challenge: not duplicate");
        // ! no need to check that transaction wasn't confirmed - this is always illegal
        // start liquidation and reward challengers
        _liquidateAndRewardChallenger(agent, msg.sender, agent.mintedAMG);
        // emit events
        emit AMEvents.DuplicatePaymentConfirmed(_agentVault, _payment1.transactionHash, _payment2.transactionHash);
    }

    function paymentsMakeFreeBalanceNegative(
        IAttestationClient.BalanceDecreasingTransaction[] calldata _payments,
        address _agentVault
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(_agentVault);
        // if the agent is already being fully liquidated, no need for more challenges
        // this also prevents double challenges
        require(agent.status != Agent.Status.FULL_LIQUIDATION, "mult chlg: already liquidating");
        // check the payments originates from agent's address, are not confirmed already and calculate total
        int256 total = 0;
        for (uint256 i = 0; i < _payments.length; i++) {
            IAttestationClient.BalanceDecreasingTransaction calldata pmi = _payments[i];
            TransactionAttestation.verifyBalanceDecreasingTransaction(pmi);
            // check there are no duplicate transactions
            for (uint256 j = 0; j < i; j++) {
                require(_payments[j].transactionHash != pmi.transactionHash, "mult chlg: repeated transaction");
            }
            require(pmi.sourceAddressHash == agent.underlyingAddressHash, "mult chlg: not agent's address");
            if (state.paymentConfirmations.transactionConfirmed(pmi)) {
                continue;   // ignore payments that have already been confirmed
            }
            if (PaymentReference.isValid(pmi.paymentReference, PaymentReference.REDEMPTION)) {
                // for redemption, we don't count the value that should be paid to free balance deduction
                uint256 redemptionId = PaymentReference.decodeId(pmi.paymentReference);
                Redemption.Request storage request = state.redemptionRequests[redemptionId];
                total += pmi.spentAmount - SafeCast.toInt256(request.underlyingValueUBA);
            } else {
                // for other payment types (announced withdrawal), everything is paid from free balance
                total += pmi.spentAmount;
            }
        }
        // check that total spent free balance is more than actual free underlying balance
        int256 balanceAfterPayments = agent.underlyingBalanceUBA - total;
        uint256 requiredBalance = UnderlyingBalance.requiredUnderlyingUBA(agent);
        require(balanceAfterPayments < requiredBalance.toInt256(), "mult chlg: enough balance");
        // start liquidation and reward challengers
        _liquidateAndRewardChallenger(agent, msg.sender, agent.mintedAMG);
        // emit events
        emit AMEvents.UnderlyingBalanceTooLow(_agentVault, balanceAfterPayments, requiredBalance);
    }

    function _liquidateAndRewardChallenger(
        Agent.State storage _agent,
        address _challenger,
        uint64 _backingAMGAtChallenge
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        // start full liquidation
        Liquidation.startFullLiquidation(_agent);
        // calculate the reward
        Collateral.Data memory collateralData =
            AgentCollateral.agentClass1CollateralData(_agent);
        uint256 rewardAMG = _backingAMGAtChallenge.mulBips(settings.paymentChallengeRewardBIPS);
        uint256 rewardC1Wei = Conversion.convertAmgToTokenWei(rewardAMG, collateralData.amgToTokenWeiPrice)
            + Agents.convertUSD5ToClass1Wei(_agent, settings.paymentChallengeRewardUSD5);
        Agents.payoutClass1(_agent, _challenger, rewardC1Wei);
    }
}
