// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../utils/lib/SafeMath64.sol";
import "./PaymentVerification.sol";
import "./Agents.sol";
import "./AssetManagerState.sol";


library AllowedPaymentAnnouncement {
    using PaymentVerification for PaymentVerification.State;
    
    struct PaymentAnnouncement {
        bytes32 underlyingAddress;
        uint256 valueUBA;
        uint64 firstUnderlyingBlock;
        uint64 lastUnderlyingBlock;
        uint64 createdAtBlock;
    }
    
    event AllowedPaymentAnnounced(
        bytes32 underlyingAddress,
        uint256 valueUBA,
        uint64 firstUnderlyingBlock,
        uint64 lastUnderlyingBlock,
        uint64 announcementId);
        
    function announceAllowedPayment(
        AssetManagerState.State storage _state,
        address _agentVault,
        bytes32 _underlyingAddress,
        uint256 _valueUBA,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        Agents.Agent storage agent = _state.agents[_agentVault];
        require(_valueUBA > 0, "invalid value");
        require(agent.allowedUnderlyingPayments[_underlyingAddress] >= _valueUBA,
            "payment larger than allowed");
        agent.allowedUnderlyingPayments[_underlyingAddress] -= _valueUBA;   // guarded by require
        uint64 lastUnderlyingBlock = SafeMath64.add64(_currentUnderlyingBlock, 
            _state.underlyingBlocksForAllowedPayment);
        uint64 announcementId = ++_state.newPaymentAnnouncementId;
        bytes32 key = _announcementKey(_agentVault, announcementId);
        _state.paymentAnnouncements[key] = PaymentAnnouncement({
            underlyingAddress: _underlyingAddress,
            valueUBA: _valueUBA,
            firstUnderlyingBlock: _currentUnderlyingBlock,
            lastUnderlyingBlock: lastUnderlyingBlock,
            createdAtBlock: SafeMath64.toUint64(block.number)
        });
        emit AllowedPaymentAnnounced(_underlyingAddress, _valueUBA, 
            _currentUnderlyingBlock, lastUnderlyingBlock, announcementId);
    }
    
    function reportAllowedPayment(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault,
        uint64 _announcementId
    )
        internal
    {
        bytes32 key = _announcementKey(_agentVault, _announcementId);
        PaymentAnnouncement storage announcement = _state.paymentAnnouncements[key];
        require(announcement.underlyingAddress != 0, "invalid announcement id");
        _state.paymentVerifications.verifyPayment(_paymentInfo, 
            announcement.underlyingAddress, 0 /* target not needed for allowed payments */,
            announcement.valueUBA, announcement.firstUnderlyingBlock, announcement.lastUnderlyingBlock);
        // TODO: check and remove pending challenge
        // TODO: possible topup for gas
    }
    
    function _announcementKey(address _agentVault, uint64 _id) private pure returns (bytes32) {
        return bytes32(uint256(_agentVault) | (uint256(_id) << 160));
    }
}
