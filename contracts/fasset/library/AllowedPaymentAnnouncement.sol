// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../../utils/lib/SafeMath64.sol";
import "./PaymentVerification.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./IllegalPaymentChallenge.sol";
import "./UnderlyingFreeBalance.sol";
import "./AssetManagerState.sol";


library AllowedPaymentAnnouncement {
    struct PaymentAnnouncement {
        uint128 valueUBA;
        uint64 createdAtBlock;
    }
    
    function announceAllowedPayment(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint256 _valueUBA
    )
        internal
    {
        Agents.requireAgentVaultOwner(_agentVault);
        require(_valueUBA > 0, "invalid value");
        UnderlyingFreeBalance.withdrawFreeFunds(_state, _agentVault, _valueUBA);
        uint64 announcementId = ++_state.newPaymentAnnouncementId;
        bytes32 key = _announcementKey(_agentVault, announcementId);
        _state.paymentAnnouncements[key] = PaymentAnnouncement({
            valueUBA: SafeCast.toUint128(_valueUBA),
            createdAtBlock: SafeCast.toUint64(block.number)
        });
        emit AMEvents.AllowedPaymentAnnounced(_agentVault, _valueUBA, announcementId);
    }
    
    function reportAllowedPayment(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault,
        uint64 _announcementId
    )
        internal
    {
        Agents.requireAgentVaultOwner(_agentVault);
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        bytes32 key = _announcementKey(_agentVault, _announcementId);
        PaymentAnnouncement storage announcement = _state.paymentAnnouncements[key];
        require(announcement.createdAtBlock != 0, "invalid announcement id");
        // if payment is challenged, make sure announcement was made strictly before challenge
        IllegalPaymentChallenge.Challenge storage challenge = IllegalPaymentChallenge.getChallenge(
            _state, _paymentInfo.sourceAddressHash, _paymentInfo.transactionHash);
        require(challenge.agentVault == address(0) || challenge.createdAtBlock > announcement.createdAtBlock,
            "challenged before announcement");
        // verify that details match announcement
        PaymentVerification.validatePaymentDetails(_paymentInfo, 
            agent.underlyingAddressHash, 0 /* target not needed for allowed payments */, announcement.valueUBA);
        // once the transaction has been proved, reporting it is pointless
        require(!PaymentVerification.transactionConfirmed(_state.paymentVerifications, key),
            "payment report after confirm");
        // create the report
        PaymentReport.createReport(_state.paymentReports, _paymentInfo);
        // deduct gas from free balance (don't report multiple times or gas will be deducted every time)
        UnderlyingFreeBalance.updateFreeBalance(_state, _agentVault, 0, PaymentVerification.usedGas(_paymentInfo),
            _paymentInfo.underlyingBlock);
        emit AMEvents.AllowedPaymentReported(_agentVault, _paymentInfo.deliveredUBA, _paymentInfo.spentUBA, 
            _paymentInfo.underlyingBlock, _announcementId);
        delete _state.paymentAnnouncements[key];
    }
    
    function _announcementKey(address _agentVault, uint64 _id) private pure returns (bytes32) {
        return bytes32(uint256(_agentVault) | (uint256(_id) << 160));
    }
}
