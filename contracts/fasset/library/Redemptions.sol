// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../generated/interface/IAttestationClient.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeBips.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./Agents.sol";
import "./UnderlyingFreeBalance.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";
import "./Liquidation.sol";


library Redemptions {
    using SafeBips for uint256;
    using SafePct for uint64;
    using SafeCast for uint256;
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentConfirmations for PaymentConfirmations.State;
    using AgentCollateral for Collateral.Data;
    
    struct AgentRedemptionData {
        address agentVault;
        uint64 valueAMG;
    }

    struct AgentRedemptionList {
        AgentRedemptionData[] items;
        uint256 length;
    }

    function redeem(
        address _redeemer,
        uint64 _lots,
        string memory _redeemerUnderlyingAddress
    )
        external
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 maxRedeemedTickets = settings.maxRedeemedTickets;
        AgentRedemptionList memory redemptionList = AgentRedemptionList({ 
            length: 0, 
            items: new AgentRedemptionData[](maxRedeemedTickets)
        });
        uint64 redeemedLots = 0;
        for (uint256 i = 0; i < maxRedeemedTickets && redeemedLots < _lots; i++) {
            // each loop, firstTicketId will change since we delete the first ticket
            uint64 redeemedForTicket = _redeemFirstTicket(_lots - redeemedLots, redemptionList);
            if (redeemedForTicket == 0) {
                break;   // queue empty
            }
            redeemedLots += redeemedForTicket;
        }
        require(redeemedLots != 0, "redeem 0 lots");
        for (uint256 i = 0; i < redemptionList.length; i++) {
            _createRemptionRequest(redemptionList.items[i], _redeemer, _redeemerUnderlyingAddress);
        }
        // notify redeemer of incomplete requests
        if (redeemedLots < _lots) {
            emit AMEvents.RedemptionRequestIncomplete(_redeemer, _lots - redeemedLots);
        }
        // burn the redeemed value of fassets
        uint256 redeemedUBA = Conversion.convertLotsToUBA(redeemedLots);
        settings.fAsset.burn(_redeemer, redeemedUBA);
    }

    function _redeemFirstTicket(
        uint64 _lots,
        AgentRedemptionList memory _list
    )
        private
        returns (uint64 _redeemedLots)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint64 ticketId = state.redemptionQueue.firstTicketId;
        if (ticketId == 0) {
            return 0;    // empty redemption queue
        }
        RedemptionQueue.Ticket storage ticket = state.redemptionQueue.getTicket(ticketId);
        uint64 maxRedeemLots = ticket.valueAMG / state.settings.lotSizeAMG;
        _redeemedLots = SafeMath64.min64(_lots, maxRedeemLots);
        uint64 redeemedAMG = _redeemedLots * state.settings.lotSizeAMG;
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
        _removeFromTicket(ticketId, redeemedAMG);
    }
    
    function _createRemptionRequest(
        AgentRedemptionData memory _data,
        address _redeemer,
        string memory _redeemerUnderlyingAddressString
    )
        private 
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint128 redeemedValueUBA = Conversion.convertAmgToUBA(_data.valueAMG).toUint128();
        state.newRedemptionRequestId += PaymentReference.randomizedIdSkip();
        uint64 requestId = state.newRedemptionRequestId;
        (uint64 lastUnderlyingBlock, uint64 lastUnderlyingTimestamp) = _lastPaymentBlock();
        uint128 redemptionFeeUBA = SafeBips.mulBips(redeemedValueUBA, state.settings.redemptionFeeBIPS).toUint128();
        state.redemptionRequests[requestId] = Redemption.Request({
            redeemerUnderlyingAddressHash: keccak256(bytes(_redeemerUnderlyingAddressString)),
            underlyingValueUBA: redeemedValueUBA,
            firstUnderlyingBlock: state.currentUnderlyingBlock,
            lastUnderlyingBlock: lastUnderlyingBlock,
            lastUnderlyingTimestamp: lastUnderlyingTimestamp,
            timestamp: block.timestamp.toUint64(),
            underlyingFeeUBA: redemptionFeeUBA,
            redeemer: _redeemer,
            agentVault: _data.agentVault,
            valueAMG: _data.valueAMG,
            status: Redemption.Status.ACTIVE
        });
        // decrease mintedAMG and mark it to redeemingAMG
        // do not add it to freeBalance yet (only after failed redemption payment)
        Agents.startRedeemingAssets(_data.agentVault, _data.valueAMG);
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
        IAttestationClient.Payment calldata _payment,
        uint64 _redemptionRequestId
    )
        external
    {
        Redemption.Request storage request = _getRedemptionRequest(_redemptionRequestId);
        Agent.State storage agent = Agent.get(request.agentVault);
        // Usually, we require the agent to trigger confirmation.
        // But if the agent doesn't respond for long enough, 
        // we allow anybody and that user gets rewarded from agent's vault.
        bool isAgent = msg.sender == Agents.vaultOwner(request.agentVault);
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
                Agents.endRedeemingAssets(request.agentVault, request.valueAMG);
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
                _executeDefaultPayment(request, _redemptionRequestId);
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
            Agents.payoutClass1(agent, request.agentVault, msg.sender,
                state.settings.confirmationByOthersRewardC1Wei);
        }
        // redemption can make agent healthy, so check and pull out of liquidation
        Liquidation.endLiquidationIfHealthy(request.agentVault);
        // delete redemption request at end
        delete state.redemptionRequests[_redemptionRequestId];
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
        //   source, which would delete redemption request but not mark source decresing transaction as used;
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
        UnderlyingFreeBalance.updateFreeBalance(_request.agentVault, _freeBalanceChangeUBA);
    }
    
    function redemptionPaymentDefault(
        IAttestationClient.ReferencedPaymentNonexistence calldata _nonPayment,
        uint64 _redemptionRequestId
    )
        external
    {
        Redemption.Request storage request = _getRedemptionRequest(_redemptionRequestId);
        require(request.status == Redemption.Status.ACTIVE, "invalid redemption status");
        // verify transaction
        TransactionAttestation.verifyReferencedPaymentNonexistence(_nonPayment);
        // check non-payment proof
        require(_nonPayment.paymentReference == PaymentReference.redemption(_redemptionRequestId) &&
            _nonPayment.destinationAddressHash == request.redeemerUnderlyingAddressHash &&
            _nonPayment.amount == request.underlyingValueUBA - request.underlyingFeeUBA,
            "redemption non-payment mismatch");
        require(_nonPayment.firstOverflowBlockNumber > request.lastUnderlyingBlock && 
            _nonPayment.firstOverflowBlockTimestamp > request.lastUnderlyingTimestamp, 
            "redemption default too early");
        require(_nonPayment.lowerBoundaryBlockNumber <= request.firstUnderlyingBlock,
            "redemption request too old");
        // We allow only redeemers or agents to trigger redemption default, since they may want
        // to do it at some particular time. (Agent might want to call default to unstick redemption when 
        // the redeemer is unresponsive.)
        address agentOwner = Agents.vaultOwner(request.agentVault);
        require(msg.sender == request.redeemer || msg.sender == agentOwner,
            "only redeemer or agent");
        // pay redeemer in native currency and mark as defaulted
        _executeDefaultPayment(request, _redemptionRequestId);
        // don't delete redemption request at end - the agent might still confirm failed payment
        request.status = Redemption.Status.DEFAULTED;
    }
    
    function finishRedemptionWithoutPayment(
        IAttestationClient.ConfirmedBlockHeightExists calldata _proof,
        uint64 _redemptionRequestId
    )
        external
    {
        Redemption.Request storage request = _getRedemptionRequest(_redemptionRequestId);
        Agents.requireAgentVaultOwner(request.agentVault);
        // the request should have been defaulted by providing a non-payment proof to redemptionPaymentDefault(),
        // except in very rare case when both agent and redeemer cannot perform confirmation while the attestation
        // is still available (~ 1 day) - in this case the agent can perform default without proof
        if (request.status == Redemption.Status.ACTIVE) {
            // verify proof
            TransactionAttestation.verifyConfirmedBlockHeightExists(_proof);
            // if non-payment proof is stil available, should use redemptionPaymentDefault() instead
            require(_proof.lowestQueryWindowBlockNumber > request.lastUnderlyingBlock
                && _proof.lowestQueryWindowBlockTimestamp > request.lastUnderlyingTimestamp,
                "should default first");
            _executeDefaultPayment(request, _redemptionRequestId);
        }
        // request is in defaulted state, but underlying balance is not freed, since we are
        // still waiting for the agent to possibly present late or failed payment
        // with this method, the agent asserts there was no payment and frees underlying balance
        int256 freeBalanceChangeUBA = SafeCast.toInt256(request.underlyingValueUBA);
        UnderlyingFreeBalance.updateFreeBalance(request.agentVault, freeBalanceChangeUBA);
        emit AMEvents.RedemptionFinished(request.agentVault, freeBalanceChangeUBA, _redemptionRequestId);
        // delete redemption request - not needed any more
        AssetManagerState.State storage state = AssetManagerState.get();
        delete state.redemptionRequests[_redemptionRequestId];
    }
    
    function _executeDefaultPayment(
        Redemption.Request storage _request,
        uint64 _redemptionRequestId
    )
        private
    {
        Agent.State storage agent = Agent.get(_request.agentVault);
        // pay redeemer in one or both collaterals
        (uint256 paidC1Wei, uint256 paidPoolWei) = 
            _collateralAmountForRedemption(agent, _request.agentVault, _request.valueAMG);
        Agents.payoutClass1(agent, _request.agentVault, _request.redeemer, paidC1Wei);
        if (paidPoolWei > 0) {
            Agents.payoutFromPool(agent, _request.redeemer, paidPoolWei, paidPoolWei);
        }
        // release remaining agent collateral
        Agents.endRedeemingAssets(_request.agentVault, _request.valueAMG);
        // underlying balance is not added to free balance yet, because we don't know if there was a late payment
        // it will be (or was already) updated in call to finishRedemptionWithoutPayment (or confirmRedemptionPayment)
        emit AMEvents.RedemptionDefault(_request.agentVault, _request.redeemer, _request.underlyingValueUBA, 
            paidC1Wei, paidPoolWei, _redemptionRequestId);
    }
    
    // payment calculation: pay redemptionDefaultFactorAgentC1BIPS (>= 1) from agent vault class 1 collateral and 
    // redemptionDefaultFactorPoolBIPS from pool; however, if there is not enough in agent's vault, pay more from pool
    // assured: _agentC1Wei <= fullCollateralC1, _poolWei <= fullPoolCollateral
    function _collateralAmountForRedemption(
        Agent.State storage _agent,
        address _agentVault,
        uint64 _requestValueAMG
    )
        internal view
        returns (uint256 _agentC1Wei, uint256 _poolWei)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        // calculate paid amount and max available amount from agent class1 collateral
        Collateral.Data memory cdAgent = 
            AgentCollateral.agentClass1CollateralData(_agent, _agentVault);
        _agentC1Wei = Conversion.convertAmgToTokenWei(_requestValueAMG, cdAgent.amgToTokenWeiPrice)
            .mulBips(settings.redemptionDefaultFactorAgentC1BIPS);
        uint256 maxAgentC1Wei = cdAgent.maxRedemptionCollateral(_agent, _requestValueAMG);
        // calculate paid amount and max available amount from the pool
        Collateral.Data memory cdPool = AgentCollateral.poolCollateralData(_agent);
        _poolWei = Conversion.convertAmgToTokenWei(_requestValueAMG, cdPool.amgToTokenWeiPrice)
            .mulBips(settings.redemptionDefaultFactorPoolBIPS);
        uint256 maxPoolWei = cdPool.maxRedemptionCollateral(_agent, _requestValueAMG);
        // if there is not enough collateral held by agent, pay more from the pool
        if (_agentC1Wei > maxAgentC1Wei) {
            uint256 extraPoolAmg = _requestValueAMG.mulDivRoundUp(_agentC1Wei - maxAgentC1Wei, _agentC1Wei);
            _poolWei += Conversion.convertAmgToTokenWei(extraPoolAmg, cdPool.amgToTokenWeiPrice);
            _agentC1Wei = maxAgentC1Wei;
        }
        // if there is not enough collateral in the pool, just reduce the payment - however this is not likely, since
        // redemptionDefaultFactorPoolBIPS is small or zero, while pool CR is much higher that agent CR
        _poolWei = Math.min(_poolWei, maxPoolWei);
    }

    function selfClose(
        address _agentVault,
        uint256 _amountUBA
    ) 
        external 
    {
        Agents.requireAgentVaultOwner(_agentVault);
        require(_amountUBA != 0, "self close of 0");
        uint64 amountAMG = Conversion.convertUBAToAmg(_amountUBA);
        (, uint256 closedUBA) = selfCloseOrLiquidate(_agentVault, amountAMG);
        // burn the self-closed assets
        AssetManagerState.getSettings().fAsset.burn(msg.sender, closedUBA);
        // try to pull agent out of liquidation
        Liquidation.endLiquidationIfHealthy(_agentVault);
        // send event
        emit AMEvents.SelfClose(_agentVault, closedUBA);
    }

    function selfCloseOrLiquidate(
        address _agentVault,
        uint64 _amountAMG
    )
        internal
        returns (uint64 _valueAMG, uint256 _valueUBA)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        // dust first
        Agent.State storage agent = Agent.get(_agentVault);
        _valueAMG = SafeMath64.min64(_amountAMG, agent.dustAMG);
        if (_valueAMG > 0) {
            Agents.decreaseDust(_agentVault, _valueAMG);
        }
        // redemption tickets
        uint256 maxRedeemedTickets = state.settings.maxRedeemedTickets;
        for (uint256 i = 0; i < maxRedeemedTickets && _valueAMG < _amountAMG; i++) {
            // each loop, firstTicketId will change since we delete the first ticket
            uint64 ticketId = state.redemptionQueue.agents[_agentVault].firstTicketId;
            if (ticketId == 0) {
                break;  // no more tickets for this agent
            }
            RedemptionQueue.Ticket storage ticket = state.redemptionQueue.getTicket(ticketId);
            uint64 ticketValueAMG = SafeMath64.min64(_amountAMG - _valueAMG, ticket.valueAMG);
            // only remove from tickets and add to total, do everything else after the loop
            _removeFromTicket(ticketId, ticketValueAMG);
            _valueAMG += ticketValueAMG;
        }
        // self-close or liquidation is one step, so we can release minted assets without redeeming step
        Agents.releaseMintedAssets(_agentVault, _valueAMG);
        // all the redeemed amount is added to free balance
        _valueUBA = Conversion.convertAmgToUBA(_valueAMG);
        UnderlyingFreeBalance.increaseFreeBalance(_agentVault, _valueUBA);
    }
    
    function _removeFromTicket(
        uint64 _redemptionTicketId,
        uint64 _redeemedAMG
    ) 
        private
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        RedemptionQueue.Ticket storage ticket = state.redemptionQueue.getTicket(_redemptionTicketId);
        uint64 remainingAMG = ticket.valueAMG - _redeemedAMG;
        if (remainingAMG == 0) {
            state.redemptionQueue.deleteRedemptionTicket(_redemptionTicketId);
        } else if (remainingAMG < state.settings.lotSizeAMG) {   // dust created
            Agents.increaseDust(ticket.agentVault, remainingAMG);
            state.redemptionQueue.deleteRedemptionTicket(_redemptionTicketId);
        } else {
            ticket.valueAMG = remainingAMG;
        }
    }

    function _lastPaymentBlock()
        private view
        returns (uint64 _lastUnderlyingBlock, uint64 _lastUnderlyingTimestamp)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        // timeshift amortizes for the time that passed from the last underlying block update
        uint64 timeshift = block.timestamp.toUint64() - state.currentUnderlyingBlockUpdatedAt;
        _lastUnderlyingBlock =
            state.currentUnderlyingBlock + state.settings.underlyingBlocksForPayment;
        _lastUnderlyingTimestamp = 
            state.currentUnderlyingBlockTimestamp + timeshift + state.settings.underlyingSecondsForPayment;
    }

    function _getRedemptionRequest(uint64 _redemptionRequestId)
        private view
        returns (Redemption.Request storage _request)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(_redemptionRequestId != 0, "invalid request id");
        _request = state.redemptionRequests[_redemptionRequestId];
        require(_request.status != Redemption.Status.EMPTY, "invalid request id");
    }
}