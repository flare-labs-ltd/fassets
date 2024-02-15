// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@flarenetwork/state-connector-protocol/contracts/interface/external/IMerkleRootStorage.sol";
import "../interfaces/ISCProofVerifier.sol";


contract SCProofVerifier is ISCProofVerifier {
    using MerkleProof for bytes32[];

    IMerkleRootStorage public immutable merkleRootStorage;

    constructor(IMerkleRootStorage _merkleRootStorage) {
        merkleRootStorage = _merkleRootStorage;
    }

    function verifyPayment(
        Payment.Proof calldata _proof
    )
        external view
        returns (bool _proved)
    {
        return _proof.data.attestationType == bytes32("Payment") &&
            _proof.merkleProof.verifyCalldata(
                merkleRootStorage.merkleRoot(_proof.data.votingRound),
                keccak256(abi.encode(_proof.data))
            );
    }

    function verifyBalanceDecreasingTransaction(
        BalanceDecreasingTransaction.Proof calldata _proof
    )
        external view
        returns (bool _proved)
    {
        return _proof.data.attestationType == bytes32("BalanceDecreasingTransaction") &&
            _proof.merkleProof.verifyCalldata(
                merkleRootStorage.merkleRoot(_proof.data.votingRound),
                keccak256(abi.encode(_proof.data))
            );
    }

    function verifyReferencedPaymentNonexistence(
        ReferencedPaymentNonexistence.Proof calldata _proof
    )
        external view
        returns (bool _proved)
    {
        return _proof.data.attestationType == bytes32("ReferencedPaymentNonexistence") &&
            _proof.merkleProof.verifyCalldata(
                merkleRootStorage.merkleRoot(_proof.data.votingRound),
                keccak256(abi.encode(_proof.data))
            );
    }

    function verifyConfirmedBlockHeightExists(
        ConfirmedBlockHeightExists.Proof calldata _proof
    )
        external view
        returns (bool _proved)
    {
        return _proof.data.attestationType == bytes32("ConfirmedBlockHeightExists") &&
            _proof.merkleProof.verifyCalldata(
                merkleRootStorage.merkleRoot(_proof.data.votingRound),
                keccak256(abi.encode(_proof.data))
            );
    }

    function verifyAddressValidity(
        AddressValidity.Proof calldata _proof
    )
        external view
        returns (bool _proved)
    {
        return _proof.data.attestationType == bytes32("AddressValidity") &&
            _proof.merkleProof.verifyCalldata(
                merkleRootStorage.merkleRoot(_proof.data.votingRound),
                keccak256(abi.encode(_proof.data))
            );
    }
}
