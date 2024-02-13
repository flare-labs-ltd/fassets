// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../../../stateConnector/interfaces/ISCProofVerifier.sol";
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

    function claimAndTransfer(
        State storage _state,
        address _expectedOwner,
        address _targetOwner,
        bytes32 _underlyingAddressHash,
        bool _requireEOA
    )
        internal
    {
        Ownership storage ownership = _state.ownership[_underlyingAddressHash];
        // check that currently unclaimed or owner is the expected owner
        if (ownership.owner == address(0)) {
            ownership.provedEOA = false;
            ownership.underlyingBlockOfEOAProof = 0;
        } else {
            require(ownership.owner == _expectedOwner, "address already claimed");
        }
        // if requireEOA, the proof had to be verified in some previous call
        require(!_requireEOA || ownership.provedEOA, "EOA proof required");
        // set the new owner
        ownership.owner = _targetOwner;
    }

    function claimWithProof(
        State storage _state,
        Payment.Proof calldata _payment,
        PaymentConfirmations.State storage _paymentVerification,
        address _owner
    )
        internal
    {
        assert(_payment.data.responseBody.sourceAddressHash != 0);
        Ownership storage ownership = _state.ownership[_payment.data.responseBody.sourceAddressHash];
        require(ownership.owner == address(0), "address already claimed");
        require(_payment.data.responseBody.standardPaymentReference == PaymentReference.addressOwnership(_owner),
            "invalid address ownership proof");
        PaymentConfirmations.confirmSourceDecreasingTransaction(_paymentVerification, _payment);
        ownership.owner = _owner;
        ownership.provedEOA = true;
        ownership.underlyingBlockOfEOAProof = _payment.data.responseBody.blockNumber;
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
