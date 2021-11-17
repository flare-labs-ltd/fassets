// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";

library PaymentVerification {
    using SafeMath for uint256;
    
    struct UnderlyingPaymentInfo {
        bytes32 sourceAddress;
        bytes32 targetAddress;
        bytes32 transactionHash;
        uint256 valueUBA;
        uint192 gasUBA;
        uint64 underlyingBlock;
    }

    struct State {
        // a store of payment hashes to prevent payment being used / challenged twice
        // structure: map of hash to the next hash in that day
        mapping(bytes32 => bytes32) verifiedPayments;
        // a linked list of payment hashes (one list per day) used for cleanup
        mapping(uint256 => bytes32) verifiedPaymentsForDay;
        // first day number for which we are tracking verifications
        uint256 verifiedPaymentsForDayStart;
    }
    
    uint256 internal constant VERIFICATION_CLEANUP_DAYS = 5;
    
    function verifyPaymentDetails(
        State storage _state,
        UnderlyingPaymentInfo memory _paymentInfo,
        bytes32 _expectedSource,
        bytes32 _expectedTarget,
        uint256 _expectedValueUBA,
        uint256 _firstExpectedBlock,
        uint256 _lastExpectedBlock
    )
        internal
    {
        // _expectedSource is zero for topups and non-zero otherwise
        if (_expectedSource != 0) {
            require(_paymentInfo.sourceAddress == _expectedSource, "invalid payment source");
        }
        // _expectedTarget is zero for allowed payments and non-zero for required payments
        if (_expectedTarget != 0) {
            require(_paymentInfo.targetAddress == _expectedTarget, "invalid payment target");
        }
        require(_paymentInfo.valueUBA == _expectedValueUBA, "invalid payment value");
        require(_paymentInfo.underlyingBlock >= _firstExpectedBlock, "payment too old");
        require(_paymentInfo.underlyingBlock <= _lastExpectedBlock, "payment too late");
        verifyPayment(_state, _paymentInfo);
    }

    function verifyPayment(
        State storage _state,
        UnderlyingPaymentInfo memory _paymentInfo
    )
        internal
    {
        require(_state.verifiedPayments[_paymentInfo.transactionHash] == 0, "payment already verified");
        markPaymentVerified(_state, _paymentInfo.transactionHash);
    }
    
    function markPaymentVerified(
        State storage _state, 
        bytes32 _transactionHash
    ) 
        internal 
    {
        uint256 day = block.timestamp / 86400;
        bytes32 first = _state.verifiedPaymentsForDay[day];
        // set next linked list element - last in list points to itself
        _state.verifiedPayments[_transactionHash] = first != 0 ? first : _transactionHash;
        // set first linked list element
        _state.verifiedPaymentsForDay[day] = _transactionHash;
        if (_state.verifiedPaymentsForDayStart == 0) {
            _state.verifiedPaymentsForDayStart = day;
        }
        // cleanup one old payment hash (> 5 days) for each new payment hash
        _cleanupPaymentVerification(_state);
    }
    
    function paymentVerified(
        State storage _state, 
        bytes32 _transactionHash
    ) 
        internal view 
        returns (bool) 
    {
        return _state.verifiedPayments[_transactionHash] != 0;
    }
    
    function _cleanupPaymentVerification(State storage _state) private {
        uint256 startDay = _state.verifiedPaymentsForDayStart;
        if (startDay == 0 || startDay > block.timestamp / 86400 - VERIFICATION_CLEANUP_DAYS) return;
        bytes32 first = _state.verifiedPaymentsForDay[startDay];
        if (first != 0) {
            bytes32 next = _state.verifiedPayments[first];
            _state.verifiedPayments[first] = 0;
            if (next == first) {    // last one in the list points to itself
                _state.verifiedPaymentsForDay[startDay] = 0;
                _state.verifiedPaymentsForDayStart = startDay + 1;
            } else {
                _state.verifiedPaymentsForDay[startDay] = next;
            }
        } else {
            _state.verifiedPaymentsForDayStart = startDay + 1;
        }
    }
}
