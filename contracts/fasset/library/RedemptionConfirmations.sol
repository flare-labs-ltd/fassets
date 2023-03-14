// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../../generated/interface/IAttestationClient.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Redemptions.sol";
import "./RedemptionFailures.sol";


library RedemptionConfirmations {
    using PaymentConfirmations for PaymentConfirmations.State;

    function confirmRedemptionPayment(
        IAttestationClient.Payment calldata _payment,
        uint64 _redemptionRequestId
    )
        external
    {
        Redemption.Request storage request = Redemptions.getRedemptionRequest(_redemptionRequestId);
        Agent.State storage agent = Agent.get(request.agentVault);
        // Usually, we require the agent to trigger confirmation.
        // But if the agent doesn't respond for long enough,
        // we allow anybody and that user gets rewarded from agent's vault.
        bool isAgent = msg.sender == Agents.vaultOwner(agent);
        require(isAgent || _othersCanConfirmPayment(agent, request, _payment),
            "only agent vault owner");
        // verify transaction
        TransactionAttestation.verifyPayment(_payment);
        // payment reference must match
        require(_payment.paymentReference == PaymentReference.redemption(_redemptionRequestId),
            "invalid redemption reference");
        // we do not allow payments before the underlying block at requests, because the payer should have guessed
        // the payment reference, which is good for nothing except attack attempts
        require(_payment.blockNumber >= request.firstUnderlyingBlock,
            "redemption payment too old");
        // When status is active, agent has either paid in time / was blocked and agent's collateral is released
        // or the payment failed and the default is called.
        // Otherwise, agent has already defaulted on payment and this method is only needed for proper
        // accounting of underlying balance. It still has to be called in time, otherwise it can be
        // called by 3rd party and in this case, the caller gets some reward from agent's vault.
        if (request.status == Redemption.Status.ACTIVE) {
            // Valid payments are to correct destination ands must have value at least the request payment value.
            // If payment is valid, agent's collateral is released, otherwise the collateral payment is done.
            (bool paymentValid, string memory failureReason) = _validatePayment(request, _payment);
            if (paymentValid) {
                // release agent collateral
                Agents.endRedeemingAssets(agent, request.valueAMG, request.poolSelfClose);
                // notify
                if (_payment.status == TransactionAttestation.PAYMENT_SUCCESS) {
                    emit AMEvents.RedemptionPerformed(request.agentVault, request.redeemer,
                        _payment.transactionHash, request.underlyingValueUBA, _redemptionRequestId);
                } else {    // _payment.status == TransactionAttestation.PAYMENT_BLOCKED
                    emit AMEvents.RedemptionPaymentBlocked(request.agentVault, request.redeemer,
                        _payment.transactionHash, request.underlyingValueUBA, _redemptionRequestId);
                }
            } else {
                // we only need failure reports from agent's underlying address, so disallow others to
                // lower the attack surface in case of hijacked agent's address
                require(_payment.sourceAddressHash == agent.underlyingAddressHash,
                    "confirm failed payment only from agent's address");
                // we do not allow retrying failed payments, so just default here
                RedemptionFailures.executeDefaultPayment(agent, request, _redemptionRequestId);
                // notify
                emit AMEvents.RedemptionPaymentFailed(request.agentVault, request.redeemer,
                    _payment.transactionHash, _redemptionRequestId, failureReason);
            }
        }
        // agent has finished with redemption - account for used underlying balance and free the remainder
        int256 freeBalanceChangeUBA = _updateFreeBalanceAfterPayment(agent, _payment, request);
        emit AMEvents.RedemptionFinished(request.agentVault, freeBalanceChangeUBA, _redemptionRequestId);
        // record source decreasing transaction so that it cannot be challenged
        AssetManagerState.State storage state = AssetManagerState.get();
        state.paymentConfirmations.confirmSourceDecreasingTransaction(_payment);
        // if the confirmation was done by someone else than agent, pay some reward from agent's vault
        if (!isAgent) {
            Agents.payoutClass1(agent, msg.sender,
                Agents.convertUSD5ToClass1Wei(agent, state.settings.confirmationByOthersRewardUSD5));
        }
        // redemption can make agent healthy, so check and pull out of liquidation
        Liquidation.endLiquidationIfHealthy(agent);
        // delete redemption request at end
        delete state.redemptionRequests[_redemptionRequestId];
    }

    function _updateFreeBalanceAfterPayment(
        Agent.State storage _agent,
        IAttestationClient.Payment calldata _payment,
        Redemption.Request storage _request
    )
        private
        returns (int256 _freeBalanceChangeUBA)
    {
        _freeBalanceChangeUBA = SafeCast.toInt256(_request.underlyingValueUBA);
        if (_payment.sourceAddressHash == _agent.underlyingAddressHash) {
            _freeBalanceChangeUBA -= _payment.spentAmount;
        }
        UnderlyingFreeBalance.updateFreeBalance(_agent, _freeBalanceChangeUBA);
    }

    function _othersCanConfirmPayment(
        Agent.State storage _agent,
        Redemption.Request storage _request,
        IAttestationClient.Payment calldata _payment
    )
        private view
        returns (bool)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        // others can confirm payments only after several hours
        if (block.timestamp <= _request.timestamp + settings.confirmationByOthersAfterSeconds) return false;
        // others can confirm only payments arriving from agent's underlying address
        // - on utxo chains for multi-source payment, 3rd party might lie about payment not coming from agent's
        //   source, which would delete redemption request but not mark source decreasing transaction as used;
        //   so afterwards there can be an illegal payment challenge for this transaction
        // - we really only need 3rd party confirmations for payments from agent's underlying address,
        //   to properly account for underlying free balance (unless payment is failed, the collateral also gets
        //   unlocked, but that only benefits the agent, so the agent should take care of that)
        return _payment.sourceAddressHash == _agent.underlyingAddressHash;
    }

    function _validatePayment(
        Redemption.Request storage request,
        IAttestationClient.Payment calldata _payment
    )
        private view
        returns (bool _paymentValid, string memory _failureReason)
    {
        uint256 paymentValueUBA = uint256(request.underlyingValueUBA) - request.underlyingFeeUBA;
        if (_payment.status == TransactionAttestation.PAYMENT_FAILED) {
            return (false, "transaction failed");
        } else if (_payment.receivingAddressHash != request.redeemerUnderlyingAddressHash) {
            return (false, "not redeemer's address");
        } else if (_payment.receivedAmount < 0 || uint256(_payment.receivedAmount) < paymentValueUBA) {
            // for blocked payments, receivedAmount == 0, but it's still receiver's fault
            if (_payment.status != TransactionAttestation.PAYMENT_BLOCKED) {
                return (false, "redemption payment too small");
            }
        }
        return (true, "");
    }
}
