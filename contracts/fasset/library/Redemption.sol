// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeMath128.sol";
import "../../utils/lib/SafeBips.sol";
import "../interface/IAgentVault.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./RedemptionQueue.sol";
import "./PaymentVerification.sol";
import "./Agents.sol";
import "./PaymentReports.sol";
import "./IllegalPaymentChallenge.sol";
import "./UnderlyingFreeBalance.sol";
import "./AssetManagerState.sol";
import "./AgentCollateral.sol";


library Redemption {
    using SafeMath for uint256;
    using SafeBips for uint256;
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentVerification for PaymentVerification.State;
    using AgentCollateral for AgentCollateral.Data;
    
    struct RedemptionRequest {
        bytes32 redeemerUnderlyingAddressHash;
        uint128 underlyingValueUBA;
        uint64 underlyingBlock;     // underlying block at redemption request time
        uint128 underlyingFeeUBA;
        uint64 valueAMG;
        uint64 timestamp;           // timestamp at redemption request time
        address agentVault;
        address redeemer;
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
        bytes memory _redeemerUnderlyingAddress,
        uint64 _currentUnderlyingBlock
    )
        external
        returns (uint64 _redeemedLots)
    {
        uint256 maxRedeemedTickets = _state.settings.maxRedeemedTickets;
        AgentRedemptionList memory redemptionList = AgentRedemptionList({ 
            length: 0, 
            items: new AgentRedemptionData[](maxRedeemedTickets)
        });
        _redeemedLots = 0;
        for (uint256 i = 0; i < maxRedeemedTickets && _redeemedLots < _lots; i++) {
            // each loop, firstTicketId will change since we delete the first ticket
            uint64 redeemedForTicket = _redeemFirstTicket(_state, _lots - _redeemedLots, redemptionList);
            if (redeemedForTicket == 0) {
                break;   // queue empty
            }
            _redeemedLots = SafeMath64.add64(_redeemedLots, redeemedForTicket);
        }
        require(_redeemedLots != 0, "redeem 0 lots");
        for (uint256 i = 0; i < redemptionList.length; i++) {
            _createRemptionRequest(_state, redemptionList.items[i], 
                _redeemer, _redeemerUnderlyingAddress, _currentUnderlyingBlock);
        }
        // notify redeemer of incomplete requests
        if (_redeemedLots < _lots) {
            emit AMEvents.RedemptionRequestIncomplete(_redeemer, _lots - _redeemedLots);
        }
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
        uint64 maxRedeemLots = SafeMath64.div64(ticket.valueAMG, _state.settings.lotSizeAMG);
        _redeemedLots = SafeMath64.min64(_lots, maxRedeemLots);
        uint64 redeemedAMG = SafeMath64.mul64(_redeemedLots, _state.settings.lotSizeAMG);
        address agentVault = ticket.agentVault;
        // find list index for ticket's agent
        uint256 index = 0;
        while (index < _list.length && _list.items[index].agentVault != agentVault) {
            ++index;
        }
        // add to list item or create new item
        if (index < _list.length) {
            _list.items[index].valueAMG = SafeMath64.add64(_list.items[index].valueAMG, redeemedAMG);
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
        bytes memory _redeemerUnderlyingAddressString,
        uint64 _currentUnderlyingBlock
    )
        private 
    {
        uint128 redeemedValueUBA = SafeCast.toUint128(Conversion.convertAmgToUBA(_state.settings, _data.valueAMG));
        uint64 requestId = ++_state.newRedemptionRequestId;
        uint128 redemptionFeeUBA = SafeCast.toUint128(
            SafeBips.mulBips128(redeemedValueUBA, _state.settings.redemptionFeeBips));
        _state.redemptionRequests[requestId] = RedemptionRequest({
            redeemerUnderlyingAddressHash: keccak256(_redeemerUnderlyingAddressString),
            underlyingValueUBA: redeemedValueUBA,
            underlyingBlock: _currentUnderlyingBlock,
            timestamp: SafeCast.toUint64(block.timestamp),
            underlyingFeeUBA: redemptionFeeUBA,
            redeemer: _redeemer,
            agentVault: _data.agentVault,
            valueAMG: _data.valueAMG
        });
        // decrease mintedAMG and mark it to redeemingAMG
        // do not add it to freeBalance yet (only after failed redemption payment)
        Agents.startRedeemingAssets(_state, _data.agentVault, _data.valueAMG);
        // emit event to remind agent to pay
        uint256 paymentValueUBA = SafeMath128.sub128(redeemedValueUBA, redemptionFeeUBA, "?");
        uint256 lastBlock = uint256(_currentUnderlyingBlock).add(_state.settings.underlyingBlocksForPayment);
        emit AMEvents.RedemptionRequested(_data.agentVault,
            _redeemerUnderlyingAddressString, paymentValueUBA, _currentUnderlyingBlock, lastBlock, requestId);
    }

    function getRedemptionRequest(
        AssetManagerState.State storage _state,
        uint64 _redemptionRequestId
    )
        internal view
        returns (RedemptionRequest storage _request)
    {
        require(_redemptionRequestId != 0, "invalid request id");
        _request = _state.redemptionRequests[_redemptionRequestId];
        require(_request.valueAMG != 0, "invalid request id");
    }
    
    function reportRedemptionPayment(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        uint64 _redemptionRequestId
    )
        external
    {
        RedemptionRequest storage request = getRedemptionRequest(_state, _redemptionRequestId);
        Agents.requireAgentVaultOwner(request.agentVault);
        Agents.Agent storage agent = Agents.getAgent(_state, request.agentVault);
        // check details
        uint256 paymentValueUBA = uint256(request.underlyingValueUBA).sub(request.underlyingFeeUBA);
        PaymentVerification.validatePaymentDetails(_paymentInfo, 
            agent.underlyingAddressHash, request.redeemerUnderlyingAddressHash, paymentValueUBA);
        // report can be submitted several times (e.g. perhaps the gas price has to be raised for tx to be accepted),
        // but once the transaction has been proved, reporting it is pointless
        require(!PaymentVerification.transactionConfirmed(_state.paymentVerifications, _paymentInfo),
            "payment report after confirm");
        // create the report
        PaymentReports.createReport(_state.paymentReports, _paymentInfo);
        emit AMEvents.RedemptionPaymentReported(request.agentVault, request.redeemer,
            _paymentInfo.deliveredUBA, _paymentInfo.spentUBA, request.underlyingFeeUBA,
            _paymentInfo.underlyingBlock, _redemptionRequestId);
    }
    
    function confirmRedemptionPayment(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        uint64 _redemptionRequestId
    )
        external
    {
        RedemptionRequest storage request = getRedemptionRequest(_state, _redemptionRequestId);
        require(PaymentReports.reportMatch(_state.paymentReports, _paymentInfo) != PaymentReports.ReportMatch.MISMATCH,
            "mismatching report exists");
        // we require the agent to trigger confirmation
        Agents.requireAgentVaultOwner(request.agentVault);
        // NOTE: we don't check that confirmation is on time - if it isn't, it's the agent's risk anyway,
        // since the redeemer can demand payment in collateral anytime
        Agents.Agent storage agent = Agents.getAgent(_state, request.agentVault);
        // confirm payment proof
        uint256 paymentValueUBA = uint256(request.underlyingValueUBA).sub(request.underlyingFeeUBA);
        PaymentVerification.validatePaymentDetails(_paymentInfo, 
            agent.underlyingAddressHash, request.redeemerUnderlyingAddressHash, paymentValueUBA);
        // record payment so that it cannot be used twice in redemption
        _state.paymentVerifications.confirmPayment(_paymentInfo);
        // record source decreasing transaction so that it cannot be challenged
        _state.paymentVerifications.confirmSourceDecreasingTransaction(_paymentInfo);
        // release agent collateral
        Agents.endRedeemingAssets(_state, request.agentVault, request.valueAMG);
        // update underlying free balance with fee and gas
        uint64 startBlockForTopup = 
            SafeMath64.add64(_paymentInfo.underlyingBlock, _state.settings.underlyingBlocksForPayment);
        uint256 usedGas = PaymentVerification.usedGas(_paymentInfo);
        UnderlyingFreeBalance.updateFreeBalance(_state, request.agentVault,
            request.underlyingFeeUBA, usedGas, startBlockForTopup);
        // delete possible pending challenge
        IllegalPaymentChallenge.deleteChallenge(_state, _paymentInfo);
        emit AMEvents.RedemptionPerformed(request.agentVault, request.redeemer,
            _paymentInfo.deliveredUBA, usedGas, request.underlyingFeeUBA,
            _paymentInfo.underlyingBlock, _redemptionRequestId);
        // cleanup
        // delete report - not needed anymore since we store confirmation
        PaymentReports.deleteReport(_state.paymentReports, _paymentInfo);
        // delete redemption request at end when we don't need data any more
        delete _state.redemptionRequests[_redemptionRequestId];
    }
    
    function redemptionPaymentTimeout(
        AssetManagerState.State storage _state,
        uint64 _redemptionRequestId,
        uint64 _currentUnderlyingBlock
    )
        external
    {
        RedemptionRequest storage request = getRedemptionRequest(_state, _redemptionRequestId);
        require(!_isPaymentOnTime(_state, request, _currentUnderlyingBlock),
            "to soon for redemption timeout");
        // we allow only redeemers to trigger redemption failures, since they may want
        // to do it at some particular time
        require(msg.sender == request.redeemer, "only redeemer");
        // pay redeemer in native currency
        uint256 paidAmountWei = _collateralAmountForRedemption(_state, request.agentVault, request.valueAMG);
        IAgentVault(request.agentVault).liquidate(request.redeemer, paidAmountWei);
        // release remaining agent collateral
        Agents.endRedeemingAssets(_state, request.agentVault, request.valueAMG);
        // underlying backing collateral was removed from mintedAMG accounting at redemption request
        // now we add it to free balance since it wasn't paid to the redeemer
        uint256 liquidatedUBA = Conversion.convertAmgToUBA(_state.settings, request.valueAMG);
        UnderlyingFreeBalance.increaseFreeBalance(_state, request.agentVault, liquidatedUBA);
        // send events
        emit AMEvents.RedemptionFailed(request.agentVault, request.redeemer, 
            paidAmountWei, liquidatedUBA, _redemptionRequestId);
        // delete redemption request at end when we don't need data any more
        delete _state.redemptionRequests[_redemptionRequestId];
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
            .mulBips(_state.settings.redemptionFailureFactorBIPS);
        uint256 maxAmountWei = collateralData.collateralShare(agent, _requestValueAMG);
        return amountWei <= maxAmountWei ? amountWei : maxAmountWei;
    }

    function _isPaymentOnTime(
        AssetManagerState.State storage _state,
        RedemptionRequest storage request,
        uint256 _underlyingBlock
    ) 
        private view 
        returns (bool)
    {
        // is block number ok?
        uint256 lastBlock = uint256(request.underlyingBlock).add(_state.settings.underlyingBlocksForPayment);
        if (_underlyingBlock <= lastBlock) return true;
        // if block number is too large, it is still ok as long as not too much time has passed
        // (to allow block height challenges)
        uint256 lastTimestamp = uint256(request.timestamp).add(_state.settings.minSecondsForPayment);
        return block.timestamp <= lastTimestamp;
    }
    
    function challengeRedemptionRequestUnderlyingBlock(
        AssetManagerState.State storage _state,
        uint64 _redemptionRequestId,
        uint64 _currentUnderlyingBlock  // must be proved via block height attestation!
    )
        external
    {
        // TODO: should only agent call this?
        RedemptionRequest storage request = getRedemptionRequest(_state, _redemptionRequestId);
        // check that challenge is within minSecondsForPayment from redemption request
        uint256 lastTimestamp = uint256(request.timestamp).add(_state.settings.minSecondsForPayment);
        require(block.timestamp <= lastTimestamp, "block number challenge late");
        // if proved _currentUnderlyingBlock is greater then one in request, increase it
        if (_currentUnderlyingBlock > request.underlyingBlock) {
            request.underlyingBlock = _currentUnderlyingBlock;
            uint256 lastBlock = uint256(_currentUnderlyingBlock).add(_state.settings.underlyingBlocksForPayment);
            emit AMEvents.RedemptionUnderlyingBlockChanged(request.agentVault,
                _currentUnderlyingBlock, lastBlock, _redemptionRequestId);
        }
    }

    function redemptionPaymentBlocked(
        AssetManagerState.State storage _state,
        uint64 _redemptionRequestId
    )
        external
    {
        // blocking proof checked in AssetManager
        RedemptionRequest storage request = getRedemptionRequest(_state, _redemptionRequestId);
        // we allow only agent to trigger blocked payment, since they may want
        // to do it at some particular time
        Agents.requireAgentVaultOwner(request.agentVault);
        // the agent may keep all the underlying backing and redeemer gets nothing
        // underlying backing collateral was removed from mintedAMG accounting at redemption request
        // now we add it to free balance since it couldn't be paid to the redeemer
        Agents.endRedeemingAssets(_state, request.agentVault, request.valueAMG);
        uint256 liquidatedUBA = Conversion.convertAmgToUBA(_state.settings, request.valueAMG);
        UnderlyingFreeBalance.increaseFreeBalance(_state, request.agentVault, liquidatedUBA);
        // notify
        emit AMEvents.RedemptionBlocked(request.agentVault, request.redeemer, liquidatedUBA, _redemptionRequestId);
        // delete redemption request at end when we don't need data any more
        delete _state.redemptionRequests[_redemptionRequestId];
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
        (, _closedUBA) = _selfCloseOrLiquidate(_state, _agentVault, amountAMG);
        // send event
        emit AMEvents.SelfClose(_agentVault, _closedUBA);
    }

    // only use by Liquidation.liquidate
    function liquidate(
        AssetManagerState.State storage _state,
        address _liquidator,
        address _agentVault,
        uint64 _amountAMG
    ) 
        internal 
        returns (uint64 _liquidatedAMG)
    {
        require(_amountAMG != 0, "liquidation of 0");
        uint256 liquidatedUBA;
        (_liquidatedAMG, liquidatedUBA) = _selfCloseOrLiquidate(_state, _agentVault, _amountAMG);
        // send event
        emit AMEvents.LiquidationPerformed(_agentVault, _liquidator, liquidatedUBA);
    }

    function _selfCloseOrLiquidate(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint64 _amountAMG
    )
        private
        returns (uint64 _valueAMG, uint256 _valueUBA)
    {
        // dust first
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        _valueAMG = SafeMath64.min64(_amountAMG, agent.dustAMG);
        Agents.decreaseDust(_state, _agentVault, _valueAMG);
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
            _valueAMG = SafeMath64.add64(_valueAMG, ticketValueAMG);
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
        uint64 remainingAMG = SafeMath64.sub64(ticket.valueAMG, _redeemedAMG, "sub64");
        if (remainingAMG == 0) {
            _state.redemptionQueue.deleteRedemptionTicket(_redemptionTicketId);
        } else if (remainingAMG < _state.settings.lotSizeAMG) {   // dust created
            Agents.increaseDust(_state, ticket.agentVault, remainingAMG);
            _state.redemptionQueue.deleteRedemptionTicket(_redemptionTicketId);
        } else {
            ticket.valueAMG = remainingAMG;
        }
    }
}
