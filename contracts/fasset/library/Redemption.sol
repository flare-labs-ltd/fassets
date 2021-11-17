// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafePctX.sol";
import "../../utils/lib/SafeMathX.sol";
import "../interface/IAgentVault.sol";
import "./RedemptionQueue.sol";
import "./PaymentVerification.sol";
import "./Agents.sol";
import "./UnderlyingFreeBalance.sol";
import "./AssetManagerState.sol";


library Redemption {
    using SafeMath for uint256;
    using SafePctX for uint256;
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentVerification for PaymentVerification.State;
    
    struct RedemptionRequest {
        bytes32 agentUnderlyingAddress;
        bytes32 redeemerUnderlyingAddress;
        uint192 underlyingValueUBA;
        uint64 firstUnderlyingBlock;
        uint192 underlyingFeeUBA;
        uint64 lastUnderlyingBlock;
        address agentVault;
        uint64 lots;
        address redeemer;
    }

    event RedemptionRequested(
        address indexed agentVault,
        bytes32 underlyingAddress,
        uint256 valueUBA,
        uint64 firstUnderlyingBlock,
        uint64 lastUnderlyingBlock,
        uint64 requestId);

    event RedemptionPerformed(
        address indexed agentVault,
        address indexed redeemer,
        uint256 valueUBA,
        uint256 gasUBA,
        uint256 feeUBA,
        uint64 redeemedLots,
        uint64 underlyingBlock,
        uint64 requestId);

    event RedemptionFailed(
        address indexed agentVault,
        address indexed redeemer,
        uint256 redeemedCollateralWei,
        uint256 freedBalanceUBA,
        uint64 freedLots,
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
        uint256 redeemedValueUBA = SafeMath.mul(_redeemedLots, _state.settings.lotSizeUBA);
        uint64 lastUnderlyingBlock = 
            SafeMath64.add64(_currentUnderlyingBlock, _state.settings.underlyingBlocksForPayment);
        _state.redemptionRequests[requestId] = RedemptionRequest({
            agentUnderlyingAddress: ticket.underlyingAddress,
            redeemerUnderlyingAddress: _redeemerUnderlyingAddress,
            underlyingValueUBA: SafeMathX.toUint192(redeemedValueUBA),
            firstUnderlyingBlock: _currentUnderlyingBlock,
            underlyingFeeUBA: SafeMathX.toUint192(_state.settings.redemptionFeeUBA),
            lastUnderlyingBlock: lastUnderlyingBlock,
            redeemer: _redeemer,
            agentVault: ticket.agentVault,
            lots: ticket.lots
        });
        uint256 paymentValueUBA = redeemedValueUBA.sub(_state.settings.redemptionFeeUBA);
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
        RedemptionRequest storage request = _state.redemptionRequests[_redemptionRequestId];
        require(request.lots != 0, "invalid request id");
        uint256 paymentValueUBA = uint256(request.underlyingValueUBA).sub(request.underlyingFeeUBA);
        _state.paymentVerifications.verifyPaymentDetails(_paymentInfo, 
            request.agentUnderlyingAddress, request.redeemerUnderlyingAddress,
            paymentValueUBA, request.firstUnderlyingBlock, request.lastUnderlyingBlock);
        Agents.Agent storage agent = _state.agents[request.agentVault];
        Agents.releaseMintedLots(agent, request.agentUnderlyingAddress, request.lots);
        // TODO: remove pending challenge
        UnderlyingFreeBalance.updateFreeBalance(_state, request.agentVault, _paymentInfo.sourceAddress, 
            request.underlyingFeeUBA, _paymentInfo.gasUBA, _currentUnderlyingBlock);
        emit RedemptionPerformed(request.agentVault, request.redeemer,
            _paymentInfo.valueUBA, _paymentInfo.gasUBA, request.underlyingFeeUBA,
            request.lots, _paymentInfo.underlyingBlock, _redemptionRequestId);
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
        RedemptionRequest storage request = _state.redemptionRequests[_redemptionRequestId];
        require(request.lots != 0, "invalid request id");
        require(request.lastUnderlyingBlock <= _currentUnderlyingBlock, "too soon for default");
        require(msg.sender == request.redeemer, "only redeemer");
        // pay redeemer in native currency
        uint256 amountWei = _lotSizeWei.mul(request.lots).mulBips(_state.settings.redemptionFailureFactorBIPS);
        // TODO: move out of library?
        IAgentVault(request.agentVault).liquidate(request.redeemer, amountWei);
        // release agent collateral and underlying collateral
        Agents.Agent storage agent = _state.agents[request.agentVault];
        Agents.releaseMintedLots(agent, request.agentUnderlyingAddress, request.lots);
        uint256 liquidatedUBA = uint256(request.lots).mul(_state.settings.lotSizeUBA);
        UnderlyingFreeBalance.increaseFreeBalance(_state, request.agentVault, request.agentUnderlyingAddress, 
            liquidatedUBA);
        emit RedemptionFailed(request.agentVault, request.redeemer, 
            amountWei, liquidatedUBA, request.lots, _redemptionRequestId);
        delete _state.redemptionRequests[_redemptionRequestId];
    }
}
