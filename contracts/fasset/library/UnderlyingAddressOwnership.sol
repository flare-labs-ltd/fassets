// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./PaymentVerification.sol";

library UnderlyingAddressOwnership {
    struct Ownership {
        address owner;
        
        // there was a payment proof indicating this is externally owned account
        bool provedEOA;
    }
    
    struct State {
        // mapping underlyingAddressHash => Ownership
        mapping (bytes32 => Ownership) ownership;
    }

    function claim(
        State storage _state, 
        address _owner, 
        bytes32 _underlyingAddressHash,
        bool _requireEOA
    ) 
        internal 
    {
        Ownership storage ownership = _claim(_state, _owner, _underlyingAddressHash, false);
        require(!_requireEOA || ownership.provedEOA, "underlying address not EOA");
    }
    
    function claimWithProof(
        State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo, 
        address _owner, 
        bytes32 _underlyingAddressHash
    )
        internal
    {
        bool proofValid = _paymentInfo.sourceAddressHash == _underlyingAddressHash
            && _paymentInfo.paymentReference == bytes32(uint256(_owner));
        require(proofValid, "invalid address ownership proof");
        _claim(_state, _owner, _underlyingAddressHash, true);
    }
    
    function check(
        State storage _state, 
        address _owner, 
        bytes32 _underlyingAddressHash
    )
        internal view
        returns (bool)
    {
        Ownership storage ownership = _state.ownership[_underlyingAddressHash];
        return ownership.owner == _owner;
    }

    function _claim(
        State storage _state, 
        address _owner, 
        bytes32 _underlyingAddressHash,
        bool _provedEOA
    ) 
        private
        returns (Ownership storage)
    {
        Ownership storage ownership = _state.ownership[_underlyingAddressHash];
        if (ownership.owner == address(0)) {
            ownership.owner = _owner;
            ownership.provedEOA = _provedEOA;
        } else {
            require(ownership.owner == _owner, "address already claimed");
        }
        return ownership;
    }
    
}
