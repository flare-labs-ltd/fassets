// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";
import "flare-smart-contracts/contracts/token/implementation/WNat.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeMathX.sol";
import "../interface/IAgentVault.sol";


library Agent100Lib {
    using SafeMath for uint256;
    using SafePct for uint256;
    
    
    event TopupRequired(
        address indexed vaultAddress,
        bytes32 underlyingAddress,
        uint256 valueUBA,
        uint64 firstUnderlyingBlock,
        uint64 lastUnderlyingBlock,
        uint64 requestId);

    function _initAgent(AssetManagerState storage _state, address _agentVault) internal {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.status == AgentStatus.EMPTY, "agent already exists");
        agent.status = AgentStatus.NORMAL;
        agent.minCollateralRatioBIPS = _state.initialMinCollateralRatioBIPS;
    }
    
    
    
    function _announceAllowedPayment(
        AssetManagerState storage _state,
        address _agentVault,
        bytes32 _underlyingAddress,
        uint256 _valueUBA,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        require(_valueUBA > 0, "invalid value");
        require(agent.allowedUnderlyingPayments[_underlyingAddress] >= _valueUBA,
            "payment larger than allowed");
        agent.allowedUnderlyingPayments[_underlyingAddress] -= _valueUBA;   // guarded by require
        uint64 lastUnderlyingBlock = SafeMath64.add64(_currentUnderlyingBlock, 
            _state.underlyingBlocksForAllowedPayment);
        uint64 announcementId = _state.allowedPaymentAnnouncements.createAnnouncement(
            _agentVault, _underlyingAddress, _valueUBA, _currentUnderlyingBlock, lastUnderlyingBlock);
        emit AllowedPaymentAnnounced(_underlyingAddress, _valueUBA, 
            _currentUnderlyingBlock, lastUnderlyingBlock, announcementId);
    }
    
    function _reportAllowedPayment(
        AssetManagerState storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault,
        uint64 _announcementId
    )
        internal
    {
        AllowedPaymentAnnouncement.Announcement storage announcement = 
            _state.allowedPaymentAnnouncements.getAnnouncement(_agentVault, _announcementId);
        verifyPayment(_state, _paymentInfo, 
            announcement.underlyingAddress, 0 /* target not needed for allowed payments */,
            announcement.valueUBA, announcement.firstUnderlyingBlock, announcement.lastUnderlyingBlock);
        // TODO: check and remove pending challenge
        // TODO: possible topup for gas
    }
    
    function _getAgent(AssetManagerState storage _state, address _agentVault) internal view returns (Agent storage) {
        return _state.agents[_agentVault];
    }
    
}
