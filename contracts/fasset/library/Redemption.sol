// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../generated/interface/IAttestationClient.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeBips.sol";
import "../interface/IAgentVault.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./RedemptionQueue.sol";
import "./PaymentConfirmations.sol";
import "./Agents.sol";
import "./UnderlyingFreeBalance.sol";
import "./AssetManagerState.sol";
import "./AgentCollateral.sol";
import "./PaymentReference.sol";
import "./TransactionAttestation.sol";
import "./Liquidation.sol";


library Redemption {
    using SafeBips for uint256;
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentConfirmations for PaymentConfirmations.State;
    using AgentCollateral for AgentCollateral.Data;
    
    enum RedemptionStatus {
        EMPTY,
        ACTIVE,
        FAILED,
        DEFAULTED
    }
    
    struct RedemptionRequest {
        bytes32 redeemerUnderlyingAddressHash;
        uint128 underlyingValueUBA;
        uint128 underlyingFeeUBA;
        uint64 firstUnderlyingBlock;
        uint64 lastUnderlyingBlock;
        uint64 lastUnderlyingTimestamp;
        uint64 valueAMG;
        address redeemer;
        uint64 timestamp;
        address agentVault;
        RedemptionStatus status;
    }
    
    struct AgentRedemptionData {
        address agentVault;
        uint64 valueAMG;
    }

    struct AgentRedemptionList {
        AgentRedemptionData[] items;
        uint256 length;
    }

    function redeem(
        AssetManagerState.State storage _state,
        address _redeemer,
        uint64 _lots,
        string memory _redeemerUnderlyingAddress
    )
        external
        returns (uint256)
    {
        uint256 maxRedeemedTickets = _state.settings.maxRedeemedTickets;
        AgentRedemptionList memory redemptionList = AgentRedemptionList({ 
            length: 0, 
            items: new AgentRedemptionData[](maxRedeemedTickets)
        });
        uint64 redeemedLots = 0;
        for (uint256 i = 0; i < maxRedeemedTickets && redeemedLots < _lots; i++) {
            // each loop, firstTicketId will change since we delete the first ticket
            uint64 redeemedForTicket = _redeemFirstTicket(_state, _lots - redeemedLots, redemptionList);
            if (redeemedForTicket == 0) {
                break;   // queue empty
            }
            redeemedLots += redeemedForTicket;
        }
        require(redeemedLots != 0, "redeem 0 lots");
        for (uint256 i = 0; i < redemptionList.length; i++) {
            _createRemptionRequest(_state, redemptionList.items[i], _redeemer, _redeemerUnderlyingAddress);
        }
        // notify redeemer of incomplete requests
        if (redeemedLots < _lots) {
            emit AMEvents.RedemptionRequestIncomplete(_redeemer, _lots - redeemedLots);
        }
        // return complete redeemed value
        return Conversion.convertLotsToUBA(_state.settings, redeemedLots);
    }

    function _redeemFirstTicket(
        AssetManagerState.State storage _state,
        uint64 _lots,
        AgentRedemptionList memory _list
    )
        private
        returns (uint64 _redeemedLots)
    {
        uint64 ticketId = _state.redemptionQueue.firstTicketId;
        if (ticketId == 0) {
            return 0;    // empty redemption queue
        }
        RedemptionQueue.Ticket storage ticket = _state.redemptionQueue.getTicket(ticketId);
        uint64 maxRedeemLots = ticket.valueAMG / _state.settings.lotSizeAMG;
        _redeemedLots = SafeMath64.min64(_lots, maxRedeemLots);
        uint64 redeemedAMG = _redeemedLots * _state.settings.lotSizeAMG;
        address agentVault = ticket.agentVault;
        // find list index for ticket's agent
        uint256 index = 0;
        while (index < _list.length && _list.items[index].agentVault != agentVault) {
            ++index;
        }
        // add to list item or create new item
        if (index < _list.length) {
            _list.items[index].valueAMG = _list.items[index].valueAMG + redeemedAMG;
        } else {
            _list.items[_list.length++] = AgentRedemptionData({ agentVault: agentVault, valueAMG: redeemedAMG });
        }
        // _removeFromTicket may delete ticket data, so we call it at end
        _removeFromTicket(_state, ticketId, redeemedAMG);
    }
    
    function _createRemptionRequest(
        AssetManagerState.State storage _state,
        AgentRedemptionData memory _data,
        address _redeemer,
        string memory _redeemerUnderlyingAddressString
    )
        private 
    {
        uint128 redeemedValueUBA = SafeCast.toUint128(Conversion.convertAmgToUBA(_state.settings, _data.valueAMG));
        uint64 requestId = ++_state.newRedemptionRequestId;
        (uint64 lastUnderlyingBlock, uint64 lastUnderlyingTimestamp) = _lastPaymentBlock(_state);
        uint128 redemptionFeeUBA = SafeCast.toUint128(
            SafeBips.mulBips(redeemedValueUBA, _state.settings.redemptionFeeBIPS));
        _state.redemptionRequests[requestId] = RedemptionRequest({
            redeemerUnderlyingAddressHash: keccak256(bytes(_redeemerUnderlyingAddressString)),
            underlyingValueUBA: redeemedValueUBA,
            firstUnderlyingBlock: _state.currentUnderlyingBlock,
            lastUnderlyingBlock: lastUnderlyingBlock,
            lastUnderlyingTimestamp: lastUnderlyingTimestamp,
            timestamp: SafeCast.toUint64(block.timestamp),
            underlyingFeeUBA: redemptionFeeUBA,
            redeemer: _redeemer,
            agentVault: _data.agentVault,
            valueAMG: _data.valueAMG,
            status: RedemptionStatus.ACTIVE
        });
        // decrease mintedAMG and mark it to redeemingAMG
        // do not add it to freeBalance yet (only after failed redemption payment)
        Agents.startRedeemingAssets(_state, _data.agentVault, _data.valueAMG);
        // emit event to remind agent to pay
        emit AMEvents.RedemptionRequested(_data.agentVault,
            requestId,
            _redeemerUnderlyingAddressString, 
            redeemedValueUBA,
            redemptionFeeUBA,
            lastUnderlyingBlock, 
            lastUnderlyingTimestamp,
            PaymentReference.redemption(requestId));
    }

    function confirmRedemptionPayment(
        AssetManagerState.State storage _state,
        IAttestationClient.Payment calldata _payment,
        uint64 _redemptionRequestId
    )
        external
    {
        RedemptionRequest storage request = _getRedemptionRequest(_state, _redemptionRequestId);
        require(request.status == RedemptionStatus.ACTIVE || request.status == RedemptionStatus.DEFAULTED, 
            "invalid redemption status");
        // Usually, we require the agent to trigger confirmation.
        // But if the agent doesn't respond for long enough, 
        // we allow anybody and that user gets rewarded from agent's vault.
        bool isAgent = msg.sender == Agents.vaultOwner(request.agentVault);
        require(isAgent || _othersCanConfirmPayment(_state, request, _payment),
            "only agent vault owner");
        // verify transaction
        TransactionAttestation.verifyPayment(_state.settings, _payment);
        // payment reference must match
        require(_payment.paymentReference == PaymentReference.redemption(_redemptionRequestId), 
            "invalid redemption reference");
        // Valid payments are to correct destination ands must have value at least the request payment value.
        // If payment is valid, agent's collateral is released, otherwise request is marked as failed and
        // awaits the redeemer to call default.
        (bool paymentValid, string memory failureReason) = _validatePayment(request, _payment);
        // When status is active, agent has either paid in time / was blocked and agent's collateral is released
        // or the payment failed and the collateral is held until default is called.
        // Otherwise, agent has already defaulted on payment and this method is only needed for proper 
        // accounting of underlying balance. It still has to be called in time, otherwise it can be
        // called by challenger and in this case, challenger gets some reward from agent's vault.
        if (request.status == RedemptionStatus.ACTIVE) {
            if (paymentValid) {
                // release agent collateral
                Agents.endRedeemingAssets(_state, request.agentVault, request.valueAMG);
                // notify
                if (_payment.status == TransactionAttestation.PAYMENT_SUCCESS) {
                    emit AMEvents.RedemptionPerformed(request.agentVault, request.redeemer,
                        _payment.receivedAmount, _payment.blockNumber, _redemptionRequestId);
                } else {    // _payment.status == TransactionAttestation.PAYMENT_BLOCKED
                    emit AMEvents.RedemptionPaymentBlocked(request.agentVault, request.redeemer, 
                        _redemptionRequestId);
                }
            } else {
                emit AMEvents.RedemptionPaymentFailed(request.agentVault, request.redeemer, 
                    _redemptionRequestId, failureReason);
            }
        }
        // agent has finished with redemption - account for used underlying balance and free the remainder
        // (however, collateral might still be held in case of failed payment)
        int256 freeBalanceChangeUBA = _updateFreeBalanceAfterPayment(_state, _payment, request);
        emit AMEvents.RedemptionFinished(request.agentVault, freeBalanceChangeUBA, _redemptionRequestId);
        // record source decreasing transaction so that it cannot be challenged
        _state.paymentConfirmations.confirmSourceDecreasingTransaction(_payment);
        // if the confirmation was done by someone else than agent, pay some reward from agent's vault
        if (!isAgent) {
            Agents.payout(_state, request.agentVault, msg.sender, _state.settings.confirmationByOthersRewardNATWei);
        }
        // redemption can make agent healthy, so check and pull out of liquidation
        Liquidation.endLiquidationIfHealthy(_state, request.agentVault);
        // delete redemption request at end if we don't need it any more
        // otherwise mark it as FAILED and wait for default
        if (paymentValid || request.status == RedemptionStatus.DEFAULTED) {
            delete _state.redemptionRequests[_redemptionRequestId];
        } else {
            request.status = RedemptionStatus.FAILED;
        }
    }
    
    function _othersCanConfirmPayment(
        AssetManagerState.State storage _state,
        RedemptionRequest storage request,
        IAttestationClient.Payment calldata _payment
    )
        private view
        returns (bool)
    {
        // others can confirm payments only after several hours
        if (block.timestamp <= request.timestamp + _state.settings.confirmationByOthersAfterSeconds) return false;
        // others can confirm only payments arriving from agent's underlying address
        // - on utxo chains for multi-source payment, 3rd party might lie about payment not coming from agent's
        //   source, which would delete redemption request but not mark source decresing transaction as used;
        //   so afterwards there can be an illegal payment challenge for this transaction
        // - we really only need 3rd party confirmations for payments from agent's underlying address,
        //   to properly account for underlying free balance (unless payment is failed, the collateral also gets
        //   unlocked, but that only benefits the agent, so the agent should take care of that)
        Agents.Agent storage agent = Agents.getAgent(_state, request.agentVault);
        return _payment.sourceAddress == agent.underlyingAddressHash;
    }
    
    function _validatePayment(
        RedemptionRequest storage request,
        IAttestationClient.Payment calldata _payment
    )
        private view
        returns (bool _paymentValid, string memory _failureReason)
    {
        uint256 paymentValueUBA = uint256(request.underlyingValueUBA) - request.underlyingFeeUBA;
        if (_payment.status == TransactionAttestation.PAYMENT_FAILED) {
            return (false, "transaction failed");
        } else if (_payment.receivingAddress != request.redeemerUnderlyingAddressHash) {
            return (false, "not redeemer's address");
        } else if (_payment.receivedAmount < paymentValueUBA) {
            // for blocked payments, receivedAmount == 0, but it's still receiver's fault
            if (_payment.status != TransactionAttestation.PAYMENT_BLOCKED) {
                return (false, "redemption payment too small");
            }
        }
        return (true, "");
    }
    
    function _updateFreeBalanceAfterPayment(
        AssetManagerState.State storage _state,
        IAttestationClient.Payment calldata _payment,
        RedemptionRequest storage _request
    )
        private
        returns (int256 _freeBalanceChangeUBA)
    {
        address agentVault = _request.agentVault;
        Agents.Agent storage agent = Agents.getAgent(_state, agentVault);
        _freeBalanceChangeUBA = SafeCast.toInt256(_request.underlyingValueUBA);
        if (_payment.sourceAddress == agent.underlyingAddressHash) {
            _freeBalanceChangeUBA -= _payment.spentAmount;
        }
        UnderlyingFreeBalance.updateFreeBalance(_state, agentVault, _freeBalanceChangeUBA);
    }
    
    function redemptionPaymentDefault(
        AssetManagerState.State storage _state,
        IAttestationClient.ReferencedPaymentNonexistence calldata _nonPayment,
        uint64 _redemptionRequestId
    )
        external
    {
        RedemptionRequest storage request = _getRedemptionRequest(_state, _redemptionRequestId);
        require(request.status == RedemptionStatus.ACTIVE || request.status == RedemptionStatus.FAILED,
            "invalid redemption status");
        // verify transaction
        TransactionAttestation.verifyReferencedPaymentNonexistence(_state.settings, _nonPayment);
        // check non-payment proof
        require(_nonPayment.paymentReference == PaymentReference.redemption(_redemptionRequestId) &&
            _nonPayment.destinationAddress == request.redeemerUnderlyingAddressHash &&
            _nonPayment.amount == request.underlyingValueUBA - request.underlyingFeeUBA,
            "redemption non-payment mismatch");
        require(_nonPayment.firstOverflowBlock > request.lastUnderlyingBlock && 
            _nonPayment.firstOverflowBlockTimestamp > request.lastUnderlyingTimestamp, 
            "redemption default too early");
        require(_nonPayment.firstCheckedBlock <= request.firstUnderlyingBlock,
            "redemption request too old");
        // We allow only redeemers or agents to trigger redemption failures, since they may want
        // to do it at some particular time. (Agent might want to call default to unstick redemption after 
        // failed payment and unresponsive redeemer.)
        address agentOwner = Agents.vaultOwner(request.agentVault);
        require(msg.sender == request.redeemer || msg.sender == agentOwner,
            "only redeemer or agent");
        // pay redeemer in native currency and mark as defaulted
        _executeDefaultPayment(_state, request, _redemptionRequestId);
        // delete redemption request at end (only if failure was already reported)
        if (request.status == RedemptionStatus.FAILED) {
            delete _state.redemptionRequests[_redemptionRequestId];
        } else {
            request.status = RedemptionStatus.DEFAULTED;
        }
    }
    
    function finishRedemptionWithoutPayment(
        AssetManagerState.State storage _state,
        uint64 _redemptionRequestId
    )
        external
    {
        RedemptionRequest storage request = _getRedemptionRequest(_state, _redemptionRequestId);
        Agents.requireAgentVaultOwner(request.agentVault);
        // the request should have been defaulted by providing a non-payment proof to redemptionPaymentDefault(),
        // except in very rare case when both agent and redeemer cannot preform confirmation while the attestation
        // is still available (~ 1 day) - in this case the agent can perform default without proof
        if (request.status != RedemptionStatus.DEFAULTED) {     // ACTIVE or FAILED
            // if non-payment proof is stil available, should use redemptionPaymentDefault() instead
            require(block.timestamp >= request.timestamp + _state.settings.attestationWindowSeconds,
                "should default first");
            _executeDefaultPayment(_state, request, _redemptionRequestId);
            // now the default payment has been done, but status remains ACTIVE or FAILED,
            // so that next step knows whether to free underlying balance
        }
        // request is in defaulted state, but underlying balance is not freed, since we are
        // still waiting for the agent to possibly present late or failed payment
        // with this method, the agent asserts there was no payment and frees underlying balance
        if (request.status != RedemptionStatus.FAILED) {    // ACTIVE or DEFAULTED
            int256 freeBalanceChangeUBA = SafeCast.toInt256(request.underlyingValueUBA);
            UnderlyingFreeBalance.updateFreeBalance(_state, request.agentVault, freeBalanceChangeUBA);
            emit AMEvents.RedemptionFinished(request.agentVault, freeBalanceChangeUBA, _redemptionRequestId);
        }
        // delete redemption request - not needed any more
        delete _state.redemptionRequests[_redemptionRequestId];
    }
    
    function _executeDefaultPayment(
        AssetManagerState.State storage _state,
        RedemptionRequest storage _request,
        uint64 _redemptionRequestId
    )
        private
    {
        // pay redeemer in native currency
        uint256 paidAmountWei = _collateralAmountForRedemption(_state, _request.agentVault, _request.valueAMG);
        Agents.payout(_state, _request.agentVault, _request.redeemer, paidAmountWei);
        // release remaining agent collateral
        Agents.endRedeemingAssets(_state, _request.agentVault, _request.valueAMG);
        // underlying balance is not added to free balance yet, because we don't know if there was a late payment
        // - it will be (or was already) updated in call to confirmRedemption, paymentFailed, or paymentCanceled
        emit AMEvents.RedemptionDefault(_request.agentVault, _request.redeemer, paidAmountWei, _redemptionRequestId);
    }
    
    function _collateralAmountForRedemption(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint64 _requestValueAMG
    )
        internal view
        returns (uint256)
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        AgentCollateral.Data memory collateralData = AgentCollateral.currentData(_state, _agentVault);
        // paid amount is  min(flr_amount * (1 + extra), total collateral share for the amount)
        uint256 amountWei = Conversion.convertAmgToNATWei(_requestValueAMG, collateralData.amgToNATWeiPrice)
            .mulBips(_state.settings.redemptionDefaultFactorBIPS);
        uint256 maxAmountWei = collateralData.maxRedemptionCollateral(agent, _requestValueAMG);
        return amountWei <= maxAmountWei ? amountWei : maxAmountWei;
    }

    function selfClose(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint256 _amountUBA
    ) 
        external 
        returns (uint256 _closedUBA)
    {
        Agents.requireAgentVaultOwner(_agentVault);
        require(_amountUBA != 0, "self close of 0");
        uint64 amountAMG = Conversion.convertUBAToAmg(_state.settings, _amountUBA);
        (, _closedUBA) = selfCloseOrLiquidate(_state, _agentVault, amountAMG);
        // try to pull agent out of liquidation
        Liquidation.endLiquidationIfHealthy(_state, _agentVault);
        // send event
        emit AMEvents.SelfClose(_agentVault, _closedUBA);
    }

    function selfCloseOrLiquidate(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint64 _amountAMG
    )
        internal
        returns (uint64 _valueAMG, uint256 _valueUBA)
    {
        // dust first
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        _valueAMG = SafeMath64.min64(_amountAMG, agent.dustAMG);
        if (_valueAMG > 0) {
            Agents.decreaseDust(_state, _agentVault, _valueAMG);
        }
        // redemption tickets
        uint256 maxRedeemedTickets = _state.settings.maxRedeemedTickets;
        for (uint256 i = 0; i < maxRedeemedTickets && _valueAMG < _amountAMG; i++) {
            // each loop, firstTicketId will change since we delete the first ticket
            uint64 ticketId = _state.redemptionQueue.agents[_agentVault].firstTicketId;
            if (ticketId == 0) {
                break;  // no more tickets for this agent
            }
            RedemptionQueue.Ticket storage ticket = _state.redemptionQueue.getTicket(ticketId);
            uint64 ticketValueAMG = SafeMath64.min64(_amountAMG - _valueAMG, ticket.valueAMG);
            // only remove from tickets and add to total, do everything else after the loop
            _removeFromTicket(_state, ticketId, ticketValueAMG);
            _valueAMG += ticketValueAMG;
        }
        // self-close or liquidation is one step, so we can release minted assets without redeeming step
        Agents.releaseMintedAssets(_state, _agentVault, _valueAMG);
        // all the redeemed amount is added to free balance
        _valueUBA = Conversion.convertAmgToUBA(_state.settings, _valueAMG);
        UnderlyingFreeBalance.increaseFreeBalance(_state, _agentVault, _valueUBA);
    }
    
    function _removeFromTicket(
        AssetManagerState.State storage _state,
        uint64 _redemptionTicketId,
        uint64 _redeemedAMG
    ) 
        private
    {
        RedemptionQueue.Ticket storage ticket = _state.redemptionQueue.getTicket(_redemptionTicketId);
        uint64 remainingAMG = ticket.valueAMG - _redeemedAMG;
        if (remainingAMG == 0) {
            _state.redemptionQueue.deleteRedemptionTicket(_redemptionTicketId);
        } else if (remainingAMG < _state.settings.lotSizeAMG) {   // dust created
            Agents.increaseDust(_state, ticket.agentVault, remainingAMG);
            _state.redemptionQueue.deleteRedemptionTicket(_redemptionTicketId);
        } else {
            ticket.valueAMG = remainingAMG;
        }
    }

    function _lastPaymentBlock(AssetManagerState.State storage _state)
        private view
        returns (uint64 _lastUnderlyingBlock, uint64 _lastUnderlyingTimestamp)
    {
        // timeshift amortizes for the time that passed from the last underlying block update
        uint64 timeshift = 
            SafeCast.toUint64(block.timestamp) - _state.currentUnderlyingBlockUpdatedAt;
        _lastUnderlyingBlock =
            _state.currentUnderlyingBlock + _state.settings.underlyingBlocksForPayment;
        _lastUnderlyingTimestamp = 
            _state.currentUnderlyingBlockTimestamp + timeshift + _state.settings.underlyingSecondsForPayment;
    }

    function _getRedemptionRequest(
        AssetManagerState.State storage _state,
        uint64 _redemptionRequestId
    )
        private view
        returns (RedemptionRequest storage _request)
    {
        require(_redemptionRequestId != 0, "invalid request id");
        _request = _state.redemptionRequests[_redemptionRequestId];
        require(_request.status != RedemptionStatus.EMPTY, "invalid request id");
    }
}
