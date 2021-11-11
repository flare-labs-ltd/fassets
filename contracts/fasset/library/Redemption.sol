// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/lib/SafePctX.sol";
import "../interface/IAgentVault.sol";
import "../../utils/lib/SafeMath64.sol";
import "./AssetManagerState.sol";
import "./CollateralReservations.sol";
import "./UnderlyingTopup.sol";


library Redemption {
    using SafeMath for uint256;
    using SafePctX for uint256;
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentVerification for PaymentVerification.State;
    
    event RedemptionRequested(
        address indexed vaultAddress,
        bytes32 underlyingAddress,
        uint256 valueUBA,
        uint64 firstUnderlyingBlock,
        uint64 lastUnderlyingBlock,
        uint64 requestId);
        
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
        require(ticket.lots != 0, "invalid redemption id");
        uint64 requestId = ++_state.newRedemptionRequestId;
        _redeemedLots = _lots <= ticket.lots ? _lots : ticket.lots;
        uint256 redeemedValueUBA = SafeMath.mul(_redeemedLots, _state.lotSizeUBA);
        uint64 lastUnderlyingBlock = SafeMath64.add64(_currentUnderlyingBlock, _state.underlyingBlocksForPayment);
        _state.redemptionRequests[requestId] = AssetManagerState.RedemptionRequest({
            agentUnderlyingAddress: ticket.underlyingAddress,
            redeemerUnderlyingAddress: _redeemerUnderlyingAddress,
            underlyingValueUBA: SafeMathX.toUint192(redeemedValueUBA),
            firstUnderlyingBlock: _currentUnderlyingBlock,
            underlyingFeeUBA: SafeMathX.toUint192(_state.redemptionFeeUBA),
            lastUnderlyingBlock: lastUnderlyingBlock,
            redeemer: _redeemer,
            agentVault: ticket.agentVault,
            lots: ticket.lots
        });
        uint256 paymentValueUBA = redeemedValueUBA.sub(_state.redemptionFeeUBA);
        emit RedemptionRequested(ticket.agentVault, ticket.underlyingAddress, 
            paymentValueUBA, _currentUnderlyingBlock, lastUnderlyingBlock, requestId);
        if (_redeemedLots == ticket.lots) {
            _state.redemptionQueue.deleteRedemptionTicket(_redemptionTicketId);
        } else {
            ticket.lots -= _redeemedLots;   // safe, _redeemedLots = min(_lots, ticket.lots)
        }
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
        AssetManagerState.RedemptionRequest storage request = _state.redemptionRequests[_redemptionRequestId];
        require(request.lots != 0, "invalid request id");
        uint256 paymentValueUBA = uint256(request.underlyingValueUBA).sub(request.underlyingFeeUBA);
        _state.paymentVerifications.verifyPayment(_paymentInfo, 
            request.agentUnderlyingAddress, request.redeemerUnderlyingAddress,
            paymentValueUBA, request.firstUnderlyingBlock, request.lastUnderlyingBlock);
        AssetManagerState.Agent storage agent = _state.agents[request.agentVault];
        agent.mintedLots = SafeMath64.sub64(agent.mintedLots, request.lots, "ERROR: not enough minted lots");
        // TODO: remove pending challenge
        if (request.underlyingFeeUBA >= _paymentInfo.gasUBA) {
            agent.allowedUnderlyingPayments[request.agentUnderlyingAddress] +=
                request.underlyingFeeUBA - _paymentInfo.gasUBA;     // += cannot overflow - both are uint192
        } else {
            uint256 requiredTopup = _paymentInfo.gasUBA - request.underlyingFeeUBA;
            UnderlyingTopup.requireUnderlyingTopup(_state, request.agentVault, request.agentUnderlyingAddress, 
                requiredTopup, _currentUnderlyingBlock);
        }
        delete _state.redemptionRequests[_redemptionRequestId];
    }
    
    function redemptionPaymentFailure(
        AssetManagerState.State storage _state,
        uint256 _lotSizeWei,
        uint64 _redemptionRequestId,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        require(_redemptionRequestId != 0, "invalid request id");
        AssetManagerState.RedemptionRequest storage request = _state.redemptionRequests[_redemptionRequestId];
        require(request.lots != 0, "invalid request id");
        require(request.lastUnderlyingBlock <= _currentUnderlyingBlock, "too soon for default");
        require(msg.sender == request.redeemer, "only redeemer");
        // pay redeemer in native currency
        uint256 amount = _lotSizeWei.mul(request.lots).mulBips(_state.redemptionFailureFactorBIPS);
        // TODO: move out of library?
        IAgentVault(request.agentVault).liquidate(request.redeemer, amount);
        // release agent collateral and underlying collateral
        AssetManagerState.Agent storage agent = _state.agents[request.agentVault];
        agent.mintedLots = SafeMath64.sub64(agent.mintedLots, request.lots, "ERROR: not enough minted lots");
        agent.allowedUnderlyingPayments[request.agentUnderlyingAddress] +=
                uint256(request.lots).mul(_state.lotSizeUBA);
        delete _state.redemptionRequests[_redemptionRequestId];
    }
}
