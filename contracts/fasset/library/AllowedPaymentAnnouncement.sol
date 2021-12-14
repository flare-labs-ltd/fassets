// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../utils/lib/SafeMath64.sol";
import "./PaymentVerification.sol";
import "./Agents.sol";
import "./IllegalPaymentChallenge.sol";
import "./UnderlyingFreeBalance.sol";
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
        
    event AllowedPaymentReported(
        bytes32 underlyingAddress,
        uint256 valueUBA,
        uint256 gasUBA,
        uint64 underlyingBlock,
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
        Agents.UnderlyingFunds storage uaf = agent.perAddressFunds[_underlyingAddress];
        require(uaf.freeBalanceUBA >= 0 && uint256(uaf.freeBalanceUBA) >= _valueUBA, 
            "payment larger than allowed");
        uaf.freeBalanceUBA -= int128(_valueUBA);   // guarded by require
        uint64 lastUnderlyingBlock = 
            SafeMath64.add64(_currentUnderlyingBlock, _state.settings.underlyingBlocksForAllowedPayment);
        uint64 announcementId = ++_state.newPaymentAnnouncementId;
        bytes32 key = _announcementKey(_agentVault, announcementId);
        _state.paymentAnnouncements[key] = PaymentAnnouncement({
            underlyingAddress: _underlyingAddress,
            valueUBA: _valueUBA,
            firstUnderlyingBlock: _currentUnderlyingBlock,
            lastUnderlyingBlock: lastUnderlyingBlock,
            createdAtBlock: SafeCast.toUint64(block.number)
        });
        emit AllowedPaymentAnnounced(_underlyingAddress, _valueUBA, 
            _currentUnderlyingBlock, lastUnderlyingBlock, announcementId);
    }
    
    function reportAllowedPayment(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault,
        uint64 _announcementId,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        bytes32 key = _announcementKey(_agentVault, _announcementId);
        PaymentAnnouncement storage announcement = _state.paymentAnnouncements[key];
        require(announcement.underlyingAddress != 0, "invalid announcement id");
        // verify that it matches announcement and mark verified to prevent challenges
        _state.paymentVerifications.verifyPaymentDetails(_paymentInfo, 
            announcement.underlyingAddress, 0 /* target not needed for allowed payments */,
            announcement.valueUBA, announcement.firstUnderlyingBlock, announcement.lastUnderlyingBlock);
        // deduct gas from free balance
        UnderlyingFreeBalance.updateFreeBalance(_state, _agentVault, _paymentInfo.sourceAddress, 
            0, _paymentInfo.gasUBA, _currentUnderlyingBlock);
        // delete pending challenge
        IllegalPaymentChallenge.deleteChallenge(_state, _paymentInfo.transactionHash);
        emit AllowedPaymentReported(_paymentInfo.sourceAddress, _paymentInfo.valueUBA, _paymentInfo.gasUBA, 
            _paymentInfo.underlyingBlock, _announcementId);
        delete _state.paymentAnnouncements[key];
    }
    
    function _announcementKey(address _agentVault, uint64 _id) private pure returns (bytes32) {
        return bytes32(uint256(_agentVault) | (uint256(_id) << 160));
    }
}
