// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";


library PaymentVerification {
    using SafeMath for uint256;
    
    // only used in-memory, so no bit optimization is necessary
    struct UnderlyingPaymentInfo {
        bytes32 sourceAddressHash;
        bytes32 targetAddressHash;
        bytes32 transactionHash;
        bytes32 paymentReference;      // used in minting to identify sender
        uint256 deliveredUBA;
        uint256 spentUBA;
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
    
    /**
     * For payment transaction, we record `tx hash`, so that the same transaction can only be used once for payment.
     * (For redemption it can have only one source anyway, but for minting there can be several sources.)
     */
    function confirmPayment(
        State storage _state,
        UnderlyingPaymentInfo memory _paymentInfo
    ) 
        internal 
    {
        _recordPaymentVerification(_state, _paymentInfo.transactionHash);
    }

    /**
     * For source decreasing transaction, we record `(source address, tx hash)` pair, since illegal
     * transactions on utxo chains can have multiple input addresses.
     */
    function confirmSourceDecreasingTransaction(
        State storage _state,
        UnderlyingPaymentInfo memory _paymentInfo
    ) 
        internal 
    {
        _recordPaymentVerification(_state, transactionKey(_paymentInfo));
    }

    function transactionConfirmed(
        State storage _state, 
        UnderlyingPaymentInfo memory _paymentInfo
    ) 
        internal view 
        returns (bool) 
    {
        bytes32 txKey = transactionKey(_paymentInfo);
        return _state.verifiedPayments[txKey] != 0;
    }

    function transactionConfirmed(
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
        bytes32 _expectedSourceHash,
        bytes32 _expectedTargetHash,
        uint256 _expectedValueUBA
    )
        internal pure
    {
        // _expectedSourceHash is zero for topups and non-zero otherwise
        if (_expectedSourceHash != 0) {
            require(_paymentInfo.sourceAddressHash == _expectedSourceHash, "invalid payment source");
        }
        // _expectedTargetHash is zero for allowed payments and non-zero for required payments
        if (_expectedTargetHash != 0) {
            require(_paymentInfo.targetAddressHash == _expectedTargetHash, "invalid payment target");
        }
        require(_paymentInfo.deliveredUBA == _expectedValueUBA, "invalid payment value");
    }

    // the same transaction hash could perform several underlying payments if it is smart contract
    // for now this is illegal, but might change for some smart contract chains
    // therefore the mapping key for transaction is always the combination of
    // underlying address (from which funds were removed) and transaction hash
    function transactionKey(bytes32 _underlyingSourceAddressHash, bytes32 _transactionHash) 
        internal pure 
        returns (bytes32) 
    {
        return keccak256(abi.encode(_underlyingSourceAddressHash, _transactionHash));
    }
    
    // shortcut for transactionKey(_paymentInfo.sourceAddressHash, _paymentInfo.transactionHash)
    function transactionKey(UnderlyingPaymentInfo memory _paymentInfo)
        internal pure 
        returns (bytes32)
    {
        return keccak256(abi.encode(_paymentInfo.sourceAddressHash, _paymentInfo.transactionHash));
    }
    
    function usedGas(UnderlyingPaymentInfo memory _paymentInfo)
        internal pure
        returns (uint256 _gasUBA)
    {
        (, _gasUBA) = _paymentInfo.spentUBA.trySub(_paymentInfo.deliveredUBA);
    }
    
    function _recordPaymentVerification(
        State storage _state,
        bytes32 _txKey
    ) 
        private
    {
        require(_state.verifiedPayments[_txKey] == 0, "payment already confirmed");
        // add to cleanup list
        uint256 day = block.timestamp / 86400;
        bytes32 first = _state.verifiedPaymentsForDay[day];
        // set next linked list element - last in list points to itself
        _state.verifiedPayments[_txKey] = first != 0 ? first : _txKey;
        // set first linked list element
        _state.verifiedPaymentsForDay[day] = _txKey;
        if (_state.verifiedPaymentsForDayStart == 0) {
            _state.verifiedPaymentsForDayStart = day;
        }
        // cleanup one old payment hash (> 5 days) for each new payment hash
        _cleanupPaymentVerification(_state);
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
