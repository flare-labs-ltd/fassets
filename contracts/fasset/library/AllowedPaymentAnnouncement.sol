// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../utils/lib/SafeMath64.sol";
import "./PaymentVerification.sol";
import "./Agents.sol";
import "./IllegalPaymentChallenge.sol";
import "./UnderlyingFreeBalance.sol";
import "./AssetManagerState.sol";


library AllowedPaymentAnnouncement {
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
        Agents.requireAgent(_agentVault);
        require(_valueUBA > 0, "invalid value");
        UnderlyingFreeBalance.withdrawFreeFunds(_state, _agentVault, _underlyingAddress, _valueUBA);
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
        Agents.requireAgent(_agentVault);
        bytes32 key = _announcementKey(_agentVault, _announcementId);
        PaymentAnnouncement storage announcement = _state.paymentAnnouncements[key];
        require(announcement.underlyingAddress != 0, "invalid announcement id");
        // if payment is challenged, make sure announcement was made strictly before challenge
        IllegalPaymentChallenge.Challenge storage challenge = 
            IllegalPaymentChallenge.getChallenge(_state, _paymentInfo.sourceAddress, _paymentInfo.transactionHash);
        require(challenge.agentVault == address(0) || challenge.createdAtBlock > announcement.createdAtBlock,
            "challenged before announcement");
        // verify that details match announcement
        PaymentVerification.validatePaymentDetails(_paymentInfo, 
            announcement.underlyingAddress, 0, /* target not needed for allowed payments */
            announcement.valueUBA, announcement.firstUnderlyingBlock, announcement.lastUnderlyingBlock);
        // once the transaction has been proved, reporting it is pointless
        require(!PaymentVerification.paymentConfirmed(_state.paymentVerifications, _paymentInfo),
            "payment report after confirm");
        // create the report
        PaymentReport.createReport(_state.paymentReports, _paymentInfo);
        // deduct gas from free balance (don't report multiple times or gas will be deducted every time)
        UnderlyingFreeBalance.updateFreeBalance(_state, _agentVault, _paymentInfo.sourceAddress, 
            0, _paymentInfo.gasUBA, _currentUnderlyingBlock);
        emit AllowedPaymentReported(_paymentInfo.sourceAddress, _paymentInfo.valueUBA, _paymentInfo.gasUBA, 
            _paymentInfo.underlyingBlock, _announcementId);
        delete _state.paymentAnnouncements[key];
    }
    
    function _announcementKey(address _agentVault, uint64 _id) private pure returns (bytes32) {
        return bytes32(uint256(_agentVault) | (uint256(_id) << 160));
    }
}
