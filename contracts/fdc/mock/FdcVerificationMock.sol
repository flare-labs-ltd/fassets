// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "flare-smart-contracts-v2/contracts/userInterfaces/IFdcVerification.sol";
import "flare-smart-contracts-v2/contracts/userInterfaces/IRelay.sol";


contract FdcVerificationMock is IFdcVerification {
    using MerkleProof for bytes32[];

    IRelay public immutable relay;
    uint8 public immutable fdcProtocolId;

    constructor(IRelay _relay, uint8 _fdcProtocolId) {
        relay = _relay;
        fdcProtocolId = _fdcProtocolId;
    }

    function verifyPayment(
        IPayment.Proof calldata _proof
    )
        external view
        returns (bool _proved)
    {
        return _proof.data.attestationType == bytes32("Payment") &&
            _proof.merkleProof.verifyCalldata(
                relay.merkleRoots(fdcProtocolId, _proof.data.votingRound),
                keccak256(abi.encode(_proof.data))
            );
    }

    function verifyBalanceDecreasingTransaction(
        IBalanceDecreasingTransaction.Proof calldata _proof
    )
        external view
        returns (bool _proved)
    {
        return _proof.data.attestationType == bytes32("BalanceDecreasingTransaction") &&
            _proof.merkleProof.verifyCalldata(
                relay.merkleRoots(fdcProtocolId, _proof.data.votingRound),
                keccak256(abi.encode(_proof.data))
            );
    }

    function verifyReferencedPaymentNonexistence(
        IReferencedPaymentNonexistence.Proof calldata _proof
    )
        external view
        returns (bool _proved)
    {
        return _proof.data.attestationType == bytes32("ReferencedPaymentNonexistence") &&
            _proof.merkleProof.verifyCalldata(
                relay.merkleRoots(fdcProtocolId, _proof.data.votingRound),
                keccak256(abi.encode(_proof.data))
            );
    }

    function verifyConfirmedBlockHeightExists(
        IConfirmedBlockHeightExists.Proof calldata _proof
    )
        external view
        returns (bool _proved)
    {
        return _proof.data.attestationType == bytes32("ConfirmedBlockHeightExists") &&
            _proof.merkleProof.verifyCalldata(
                relay.merkleRoots(fdcProtocolId, _proof.data.votingRound),
                keccak256(abi.encode(_proof.data))
            );
    }

    function verifyAddressValidity(
        IAddressValidity.Proof calldata _proof
    )
        external view
        returns (bool _proved)
    {
        return _proof.data.attestationType == bytes32("AddressValidity") &&
            _proof.merkleProof.verifyCalldata(
                relay.merkleRoots(fdcProtocolId, _proof.data.votingRound),
                keccak256(abi.encode(_proof.data))
            );
    }

    function verifyEVMTransaction(
        IEVMTransaction.Proof calldata _proof
    )
        external view
        returns (bool _proved)
    {
        return _proof.data.attestationType == bytes32("EVMTransaction") &&
            _proof.merkleProof.verifyCalldata(
                relay.merkleRoots(fdcProtocolId, _proof.data.votingRound),
                keccak256(abi.encode(_proof.data))
            );
    }
}
