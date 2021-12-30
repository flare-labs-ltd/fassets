// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeMath128.sol";
import "../../utils/lib/SafeBips.sol";
import "../interface/IAgentVault.sol";
import "./Conversion.sol";
import "./RedemptionQueue.sol";
import "./PaymentVerification.sol";
import "./Agents.sol";
import "./PaymentReport.sol";
import "./IllegalPaymentChallenge.sol";
import "./UnderlyingFreeBalance.sol";
import "./AssetManagerState.sol";


library Redemption {
    using SafeMath for uint256;
    using SafeBips for uint256;
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentVerification for PaymentVerification.State;
    
    struct RedemptionRequest {
        bytes32 redeemerUnderlyingAddress;
        uint128 underlyingValueUBA;
        uint64 firstUnderlyingBlock;
        uint128 underlyingFeeUBA;
        uint64 lastUnderlyingBlock;
        uint64 valueAMG;
        address agentVault;
        address redeemer;
    }

    event RedemptionRequested(
        address indexed agentVault,
        uint256 valueUBA,
        uint64 firstUnderlyingBlock,
        uint64 lastUnderlyingBlock,
        uint64 requestId);

    event RedemptionPaymentReported(
        address indexed agentVault,
        address indexed redeemer,
        uint256 valueUBA,
        uint256 gasUBA,
        uint256 feeUBA,
        uint64 underlyingBlock,
        uint64 requestId);

    event RedemptionPerformed(
        address indexed agentVault,
        address indexed redeemer,
        uint256 valueUBA,
        uint256 gasUBA,
        uint256 feeUBA,
        uint64 underlyingBlock,
        uint64 requestId);

    event RedemptionFailed(
        address indexed agentVault,
        address indexed redeemer,
        uint256 redeemedCollateralWei,
        uint256 freedBalanceUBA,
        uint64 requestId);

    event SelfClose(
        address indexed agentVault,
        uint256 valueUBA);

    event LiquidationPerformed(
        address indexed agentVault,
        address indexed liquidator,
        uint256 valueUBA);
        
    function redeemAgainstTicket(
        AssetManagerState.State storage _state,
        uint64 _redemptionTicketId,
        address _redeemer,
        uint64 _lots,
        bytes32 _redeemerUnderlyingAddress,
        uint64 _currentUnderlyingBlock
    ) 
        internal 
        returns (uint64 _redeemedLots)
    {
        require(_lots != 0, "cannot redeem 0 lots");
        require(_redemptionTicketId != 0, "invalid redemption id");
        RedemptionQueue.Ticket storage ticket = _state.redemptionQueue.getTicket(_redemptionTicketId);
        require(ticket.valueAMG != 0, "invalid redemption id");
        uint64 requestId = ++_state.newRedemptionRequestId;
        uint64 maxRedeemLots = SafeMath64.div64(ticket.valueAMG, _state.settings.lotSizeAMG);
        _redeemedLots = _lots <= maxRedeemLots ? _lots : maxRedeemLots;
        uint64 redeemedAMG = SafeMath64.mul64(_redeemedLots, _state.settings.lotSizeAMG);
        uint128 redeemedValueUBA = uint128(redeemedAMG) * uint128(_state.settings.assetMintingGranularityUBA);
        uint64 lastUnderlyingBlock = 
            SafeMath64.add64(_currentUnderlyingBlock, _state.settings.underlyingBlocksForPayment);
        _state.redemptionRequests[requestId] = RedemptionRequest({
            redeemerUnderlyingAddress: _redeemerUnderlyingAddress,
            underlyingValueUBA: redeemedValueUBA,
            firstUnderlyingBlock: _currentUnderlyingBlock,
            underlyingFeeUBA: _state.settings.redemptionFeeUBA,
            lastUnderlyingBlock: lastUnderlyingBlock,
            redeemer: _redeemer,
            agentVault: ticket.agentVault,
            valueAMG: redeemedAMG
        });
        // decrease mintedAMG and mark it to redeemingAMG
        // do not add it to freeBalance yet (only after failed redemption payment)
        Agents.startRedeemingAssets(_state, ticket.agentVault, redeemedAMG);
        // emit event to remind agent to pay
        uint256 paymentValueUBA = SafeMath128.sub128(redeemedValueUBA, _state.settings.redemptionFeeUBA, "?");
        emit RedemptionRequested(ticket.agentVault,
            paymentValueUBA, _currentUnderlyingBlock, lastUnderlyingBlock, requestId);
        // _removeFromTicket may delete ticket data, so we call it at end
        _removeFromTicket(_state, _redemptionTicketId, redeemedAMG);
    }

    function reportRedemptionRequestPayment(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        uint64 _redemptionRequestId
    )
        internal
    {
        require(_redemptionRequestId != 0, "invalid request id");
        RedemptionRequest storage request = _state.redemptionRequests[_redemptionRequestId];
        require(request.valueAMG != 0, "invalid request id");
        Agents.requireOwnerAgent(request.agentVault);
        Agents.Agent storage agent = Agents.getAgent(_state, request.agentVault);
        // check details
        uint256 paymentValueUBA = uint256(request.underlyingValueUBA).sub(request.underlyingFeeUBA);
        PaymentVerification.validatePaymentDetails(_paymentInfo, 
            agent.underlyingAddress, request.redeemerUnderlyingAddress,
            paymentValueUBA, request.firstUnderlyingBlock, request.lastUnderlyingBlock);
        // report can be submitted several times (e.g. perhaps the gas price has to be raised for tx to be accepted),
        // but once the transaction has been proved, reporting it is pointless
        require(!PaymentVerification.paymentConfirmed(_state.paymentVerifications, _paymentInfo),
            "payment report after confirm");
        // create the report
        PaymentReport.createReport(_state.paymentReports, _paymentInfo);
        emit RedemptionPaymentReported(request.agentVault, request.redeemer,
            _paymentInfo.valueUBA, _paymentInfo.gasUBA, request.underlyingFeeUBA,
            _paymentInfo.underlyingBlock, _redemptionRequestId);
    }
    
    function confirmRedemptionRequestPayment(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        uint64 _redemptionRequestId,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        require(_redemptionRequestId != 0, "invalid request id");
        RedemptionRequest storage request = _state.redemptionRequests[_redemptionRequestId];
        require(request.valueAMG != 0, "invalid request id");
        require(PaymentReport.reportMatch(_state.paymentReports, _paymentInfo) != PaymentReport.ReportMatch.MISMATCH,
            "mismatching report exists");
        Agents.requireOwnerAgent(request.agentVault);
        Agents.Agent storage agent = Agents.getAgent(_state, request.agentVault);
        // confirm payment proof
        uint256 paymentValueUBA = uint256(request.underlyingValueUBA).sub(request.underlyingFeeUBA);
        _state.paymentVerifications.confirmPaymentDetails(_paymentInfo, 
            agent.underlyingAddress, request.redeemerUnderlyingAddress,
            paymentValueUBA, request.firstUnderlyingBlock, request.lastUnderlyingBlock);
        // release agent collateral
        Agents.endRedeemingAssets(_state, request.agentVault, request.valueAMG);
        // update underlying free balance with fee and gas
        UnderlyingFreeBalance.updateFreeBalance(_state, request.agentVault,
            request.underlyingFeeUBA, _paymentInfo.gasUBA, _currentUnderlyingBlock);
        // delete possible pending challenge
        IllegalPaymentChallenge.deleteChallenge(_state, _paymentInfo);
        emit RedemptionPerformed(request.agentVault, request.redeemer,
            _paymentInfo.valueUBA, _paymentInfo.gasUBA, request.underlyingFeeUBA,
            _paymentInfo.underlyingBlock, _redemptionRequestId);
        // delete redemption request at end when we don't need data any more
        delete _state.redemptionRequests[_redemptionRequestId];
    }
    
    function redemptionPaymentFailure(
        AssetManagerState.State storage _state,
        uint256 _amgToNATWeiPrice,
        uint64 _redemptionRequestId,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        require(_redemptionRequestId != 0, "invalid request id");
        RedemptionRequest storage request = _state.redemptionRequests[_redemptionRequestId];
        require(request.valueAMG != 0, "invalid request id");
        require(request.lastUnderlyingBlock <= _currentUnderlyingBlock, "too soon for default");
        // we allow only redeemers to trigger redemption failures, since they may want
        // to do it at some particular time
        require(msg.sender == request.redeemer, "only redeemer");
        // pay redeemer in native currency
        uint256 amountWei = Conversion.convertAmgToNATWei(request.valueAMG, _amgToNATWeiPrice)
            .mulBips(_state.settings.redemptionFailureFactorBIPS);
        // TODO: move out of library?
        IAgentVault(request.agentVault).liquidate(request.redeemer, amountWei);
        // release remaining agent collateral
        Agents.endRedeemingAssets(_state, request.agentVault, request.valueAMG);
        // underlying backing collateral was removed from mintedAMG accounting at redemption request
        // now we add it to free balance since it wasn't paid to the redeemer
        uint256 liquidatedUBA = uint256(request.valueAMG).mul(_state.settings.assetMintingGranularityUBA);
        UnderlyingFreeBalance.increaseFreeBalance(_state, request.agentVault, liquidatedUBA);
        emit RedemptionFailed(request.agentVault, request.redeemer, 
            amountWei, liquidatedUBA, _redemptionRequestId);
        // delete redemption request at end when we don't need data any more
        delete _state.redemptionRequests[_redemptionRequestId];
    }

    function selfCloseAgainstTicket(
        AssetManagerState.State storage _state,
        uint64 _redemptionTicketId,
        uint64 _lots
    ) 
        internal 
        returns (uint64 _redeemedLots)
    {
        require(_lots != 0, "cannot redeem 0 lots");
        require(_redemptionTicketId != 0, "invalid redemption id");
        RedemptionQueue.Ticket storage ticket = _state.redemptionQueue.getTicket(_redemptionTicketId);
        require(ticket.valueAMG != 0, "invalid redemption id");
        Agents.requireOwnerAgent(ticket.agentVault);
        uint64 maxRedeemLots = SafeMath64.div64(ticket.valueAMG, _state.settings.lotSizeAMG);
        _redeemedLots = _lots <= maxRedeemLots ? _lots : maxRedeemLots;
        uint64 redeemedAMG = SafeMath64.mul64(_redeemedLots, _state.settings.lotSizeAMG);
        // self close is one step, so we can release minted assets without redeeming step
        Agents.releaseMintedAssets(_state, ticket.agentVault, redeemedAMG);
        // all the self-closed amount is added to free balance
        uint256 redeemedUBA = uint256(redeemedAMG).mul(_state.settings.assetMintingGranularityUBA);
        UnderlyingFreeBalance.increaseFreeBalance(_state, ticket.agentVault, redeemedUBA);
        // send event
        emit SelfClose(ticket.agentVault, redeemedUBA);
        // _removeFromTicket may delete ticket data, so we call it at end
        _removeFromTicket(_state, _redemptionTicketId, redeemedAMG);
    }

    function selfCloseDust(
        AssetManagerState.State storage _state,
        address _agentVault
    ) 
        internal 
        returns (uint256 _selfClosedUBA)
    {
        Agents.requireOwnerAgent(_agentVault);
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        uint64 redeemedAMG = agent.dustAMG;
        // clear dust
        agent.dustAMG = 0;
        // self close is one step, so we can release minted assets without redeeming step
        Agents.releaseMintedAssets(_state, _agentVault, redeemedAMG);
        // all the self-closed amount is added to free balance
        _selfClosedUBA = uint256(redeemedAMG).mul(_state.settings.assetMintingGranularityUBA);
        UnderlyingFreeBalance.increaseFreeBalance(_state, _agentVault, _selfClosedUBA);
        // send event
        emit SelfClose(_agentVault, _selfClosedUBA);
    }

    function liquidateAgainstTicket(
        AssetManagerState.State storage _state,
        address liquidator,
        uint64 _redemptionTicketId,
        uint64 _lots
    ) 
        internal 
        returns (uint64 _redeemedLots)
    {
        require(_lots != 0, "cannot redeem 0 lots");
        require(_redemptionTicketId != 0, "invalid redemption id");
        RedemptionQueue.Ticket storage ticket = _state.redemptionQueue.getTicket(_redemptionTicketId);
        require(ticket.valueAMG != 0, "invalid redemption id");
        require(Agents.isAgentInLiquidation(_state, ticket.agentVault),
            "not in liquidation");
        uint64 maxRedeemLots = SafeMath64.div64(ticket.valueAMG, _state.settings.lotSizeAMG);
        _redeemedLots = _lots <= maxRedeemLots ? _lots : maxRedeemLots;
        uint64 redeemedAMG = SafeMath64.mul64(_redeemedLots, _state.settings.lotSizeAMG);
        // liquidation is one step, so we can release minted assets without redeeming step
        Agents.releaseMintedAssets(_state, ticket.agentVault, redeemedAMG);
        // all the liquidated amount is added to free balance
        uint256 redeemedUBA = uint256(redeemedAMG).mul(_state.settings.assetMintingGranularityUBA);
        UnderlyingFreeBalance.increaseFreeBalance(_state, ticket.agentVault, redeemedUBA);
        // send event
        emit LiquidationPerformed(ticket.agentVault, liquidator, redeemedUBA);
        // _removeFromTicket may delete ticket data, so we call it at end
        _removeFromTicket(_state, _redemptionTicketId, redeemedAMG);
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
