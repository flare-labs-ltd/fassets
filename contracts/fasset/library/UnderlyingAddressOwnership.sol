// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../../generated/interface/IAttestationClient.sol";
import "./PaymentConfirmations.sol";
import "./PaymentReference.sol";


library UnderlyingAddressOwnership {
    struct Ownership {
        address owner;
        
        // if not 0, there was a payment proof indicating this is externally owned account
        uint64 underlyingBlockOfEOAProof;
        
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
        Ownership storage ownership = _state.ownership[_underlyingAddressHash];
        if (ownership.owner == address(0)) {
            ownership.owner = _owner;
            ownership.provedEOA = false;
            ownership.underlyingBlockOfEOAProof = 0;
        } else {
            require(ownership.owner == _owner, "address already claimed");
        }
        require(!_requireEOA || ownership.provedEOA, "EOA proof required");
    }
    
    function claimWithProof(
        State storage _state,
        IAttestationClient.Payment calldata _payment, 
        PaymentConfirmations.State storage _paymentVerification,
        address _owner, 
        bytes32 _underlyingAddressHash
    )
        internal
    {
        Ownership storage ownership = _state.ownership[_underlyingAddressHash];
        require(ownership.owner == address(0), "address already claimed");
        bool proofValid = _payment.sourceAddress == _underlyingAddressHash
            && _payment.paymentReference == PaymentReference.addressOwnership(_owner);
        require(proofValid, "invalid address ownership proof");
        PaymentConfirmations.confirmSourceDecreasingTransaction(_paymentVerification, _payment);
        ownership.owner = _owner;
        ownership.provedEOA = true;
        ownership.underlyingBlockOfEOAProof = _payment.blockNumber;
    }
    
    function underlyingBlockOfEOAProof(
        State storage _state, 
        bytes32 _underlyingAddressHash
    )
        internal view
        returns (uint64)
    {
        return _state.ownership[_underlyingAddressHash].underlyingBlockOfEOAProof;
    }
}
