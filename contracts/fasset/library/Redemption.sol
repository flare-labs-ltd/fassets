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
import "./UnderlyingFreeBalance.sol";
import "./AssetManagerState.sol";


library Redemption {
    using SafeMath for uint256;
    using SafeBips for uint256;
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentVerification for PaymentVerification.State;
    
    struct RedemptionRequest {
        bytes32 agentUnderlyingAddress;
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
        uint64 underlyingBlock,
        uint64 requestId);

    event RedemptionFailed(
        address indexed agentVault,
        address indexed redeemer,
        uint256 redeemedCollateralWei,
        uint256 freedBalanceUBA,
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
        require(ticket.valueAMG != 0, "invalid redemption id");
        uint64 requestId = ++_state.newRedemptionRequestId;
        uint64 maxRedeemLots = SafeMath64.div64(ticket.valueAMG, _state.settings.lotSizeAMG);
        _redeemedLots = _lots <= maxRedeemLots ? _lots : maxRedeemLots;
        uint64 redeemedAMG = SafeMath64.div64(_redeemedLots, _state.settings.lotSizeAMG);
        uint128 redeemedValueUBA = uint128(redeemedAMG) * uint128(_state.settings.assetMintingGranularityUBA);
        uint64 lastUnderlyingBlock = 
            SafeMath64.add64(_currentUnderlyingBlock, _state.settings.underlyingBlocksForPayment);
        _state.redemptionRequests[requestId] = RedemptionRequest({
            agentUnderlyingAddress: ticket.underlyingAddress,
            redeemerUnderlyingAddress: _redeemerUnderlyingAddress,
            underlyingValueUBA: redeemedValueUBA,
            firstUnderlyingBlock: _currentUnderlyingBlock,
            underlyingFeeUBA: _state.settings.redemptionFeeUBA,
            lastUnderlyingBlock: lastUnderlyingBlock,
            redeemer: _redeemer,
            agentVault: ticket.agentVault,
            valueAMG: redeemedAMG
        });
        uint256 paymentValueUBA = SafeMath128.sub128(redeemedValueUBA, _state.settings.redemptionFeeUBA, "?");
        emit RedemptionRequested(ticket.agentVault, ticket.underlyingAddress, 
            paymentValueUBA, _currentUnderlyingBlock, lastUnderlyingBlock, requestId);
        _removeFromTicket(_state, _redemptionTicketId, redeemedAMG);
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
        uint256 paymentValueUBA = uint256(request.underlyingValueUBA).sub(request.underlyingFeeUBA);
        _state.paymentVerifications.verifyPaymentDetails(_paymentInfo, 
            request.agentUnderlyingAddress, request.redeemerUnderlyingAddress,
            paymentValueUBA, request.firstUnderlyingBlock, request.lastUnderlyingBlock);
        Agents.releaseMintedAssets(_state, request.agentVault, request.agentUnderlyingAddress, request.valueAMG);
        // TODO: remove pending challenge
        UnderlyingFreeBalance.updateFreeBalance(_state, request.agentVault, _paymentInfo.sourceAddress, 
            request.underlyingFeeUBA, _paymentInfo.gasUBA, _currentUnderlyingBlock);
        emit RedemptionPerformed(request.agentVault, request.redeemer,
            _paymentInfo.valueUBA, _paymentInfo.gasUBA, request.underlyingFeeUBA,
            _paymentInfo.underlyingBlock, _redemptionRequestId);
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
        require(msg.sender == request.redeemer, "only redeemer");
        // pay redeemer in native currency
        uint256 amountWei = Conversion.convertAmgToNATWei(request.valueAMG, _amgToNATWeiPrice);
        // TODO: move out of library?
        IAgentVault(request.agentVault).liquidate(request.redeemer, amountWei);
        // release agent collateral and underlying collateral
        Agents.releaseMintedAssets(_state, request.agentVault, request.agentUnderlyingAddress, request.valueAMG);
        uint256 liquidatedUBA = uint256(request.valueAMG).mul(_state.settings.assetMintingGranularityUBA);
        UnderlyingFreeBalance.increaseFreeBalance(_state, request.agentVault, request.agentUnderlyingAddress, 
            liquidatedUBA);
        emit RedemptionFailed(request.agentVault, request.redeemer, 
            amountWei, liquidatedUBA, _redemptionRequestId);
        delete _state.redemptionRequests[_redemptionRequestId];
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
            Agents.increaseDust(_state, ticket.agentVault, ticket.underlyingAddress, remainingAMG);
            _state.redemptionQueue.deleteRedemptionTicket(_redemptionTicketId);
        } else {
            ticket.valueAMG = remainingAMG;
        }
    }
}
