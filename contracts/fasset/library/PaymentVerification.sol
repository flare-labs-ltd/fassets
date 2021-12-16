// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";

library PaymentVerification {
    using SafeMath for uint256;
    
    // only used in-memory, so no bit optimization is necessary
    struct UnderlyingPaymentInfo {
        bytes32 sourceAddress;
        bytes32 targetAddress;
        bytes32 transactionHash;
        uint256 valueUBA;
        uint256 gasUBA;
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
    
    function confirmPaymentDetails(
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
        validatePaymentDetails(_paymentInfo, 
            _expectedSource, _expectedTarget, _expectedValueUBA, _firstExpectedBlock, _lastExpectedBlock);
        confirmPayment(_state, _paymentInfo);
    }
    
    function confirmPayment(
        State storage _state,
        UnderlyingPaymentInfo memory _paymentInfo
    ) 
        internal 
    {
        bytes32 txKey = transactionKey(_paymentInfo);
        require(_state.verifiedPayments[txKey] == 0, "payment already confirmed");
        // add to cleanup list
        uint256 day = block.timestamp / 86400;
        bytes32 first = _state.verifiedPaymentsForDay[day];
        // set next linked list element - last in list points to itself
        _state.verifiedPayments[txKey] = first != 0 ? first : txKey;
        // set first linked list element
        _state.verifiedPaymentsForDay[day] = txKey;
        if (_state.verifiedPaymentsForDayStart == 0) {
            _state.verifiedPaymentsForDayStart = day;
        }
        // cleanup one old payment hash (> 5 days) for each new payment hash
        _cleanupPaymentVerification(_state);
    }
    
    function paymentConfirmed(
        State storage _state, 
        UnderlyingPaymentInfo memory _paymentInfo
    ) 
        internal view 
        returns (bool) 
    {
        bytes32 txKey = transactionKey(_paymentInfo);
        return _state.verifiedPayments[txKey] != 0;
    }

    function paymentConfirmed(
        State storage _state, 
        bytes32 _transactionKey
    ) 
        internal view 
        returns (bool) 
    {
        return _state.verifiedPayments[_transactionKey] != 0;
    }
    
    function validatePaymentDetails(
        UnderlyingPaymentInfo memory _paymentInfo,
        bytes32 _expectedSource,
        bytes32 _expectedTarget,
        uint256 _expectedValueUBA,
        uint256 _firstExpectedBlock,
        uint256 _lastExpectedBlock
    )
        internal pure
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
    }

    // the same transaction hash could perform several underlying payments if it is smart contract
    // for now this is illegal, but might change for some smart contract chains
    // therefore the mapping key for transaction is always the combination of
    // underlying address (from which funds were removed) and transaction hash
    function transactionKey(bytes32 _underlyingSourceAddress, bytes32 _transactionHash) 
        internal pure 
        returns (bytes32) 
    {
        return keccak256(abi.encode(_underlyingSourceAddress, _transactionHash));
    }
    
    // shortcut for transactionKey(_paymentInfo.sourceAddress, _paymentInfo.transactionHash)
    function transactionKey(UnderlyingPaymentInfo memory _paymentInfo)
        internal pure 
        returns (bytes32)
    {
        return keccak256(abi.encode(_paymentInfo.sourceAddress, _paymentInfo.transactionHash));
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
