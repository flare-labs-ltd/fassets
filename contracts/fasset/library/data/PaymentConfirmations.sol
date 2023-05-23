// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../../../generated/interface/IAttestationClient.sol";


library PaymentConfirmations {
    struct State {
        // a store of payment hashes to prevent payment being used / challenged twice
        // structure: map of hash to the next hash in that day
        mapping(bytes32 => bytes32) verifiedPayments;
        // a linked list of payment hashes (one list per day) used for cleanup
        mapping(uint256 => bytes32) verifiedPaymentsForDay;
        // first day number for which we are tracking verifications
        uint256 verifiedPaymentsForDayStart;
    }

    uint256 internal constant DAY = 1 days;
    uint256 internal constant VERIFICATION_CLEANUP_DAYS = 14;

    /**
     * For payment transaction with non-unique payment reference (generated from address, not id),
     * we record `tx hash`, so that the same transaction can only be used once for payment.
     */
    function confirmIncomingPayment(
        State storage _state,
        IAttestationClient.Payment calldata _payment
    )
        internal
    {
        _recordPaymentVerification(_state, _payment.transactionHash);
    }

    /**
     * For source decreasing transaction, we record `(source address, tx hash)` pair, since illegal
     * transactions on utxo chains can have multiple input addresses.
     */
    function confirmSourceDecreasingTransaction(
        State storage _state,
        IAttestationClient.Payment calldata _payment
    )
        internal
    {
        _recordPaymentVerification(_state, transactionKey(_payment.sourceAddressHash, _payment.transactionHash));
    }

    /**
     * Check if source decreasing transaction was already confirmed.
     */
    function transactionConfirmed(
        State storage _state,
        IAttestationClient.BalanceDecreasingTransaction calldata _transaction
    )
        internal view
        returns (bool)
    {
        bytes32 txKey = transactionKey(_transaction.sourceAddressHash, _transaction.transactionHash);
        return _state.verifiedPayments[txKey] != 0;
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

    function _recordPaymentVerification(
        State storage _state,
        bytes32 _txKey
    )
        private
    {
        require(_state.verifiedPayments[_txKey] == 0, "payment already confirmed");
        // add to cleanup list
        uint256 day = block.timestamp / DAY;
        bytes32 first = _state.verifiedPaymentsForDay[day];
        // set next linked list element - last in list points to itself
        _state.verifiedPayments[_txKey] = first != 0 ? first : _txKey;
        // set first linked list element
        _state.verifiedPaymentsForDay[day] = _txKey;
        if (_state.verifiedPaymentsForDayStart == 0) {
            _state.verifiedPaymentsForDayStart = day;
        }
        // cleanup one old payment hash (> 14 days) for each new payment hash
        _cleanupPaymentVerification(_state);
    }

    function _cleanupPaymentVerification(State storage _state) private {
        uint256 startDay = _state.verifiedPaymentsForDayStart;
        if (startDay == 0 || startDay >= block.timestamp / DAY - VERIFICATION_CLEANUP_DAYS) return;
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
