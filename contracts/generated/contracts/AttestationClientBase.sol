//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../interface/IAttestationClient.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

abstract contract AttestationClientBase is IAttestationClient {
    using MerkleProof for bytes32[];

    // possible attestationType values
    uint16 public constant PAYMENT = 1;
    uint16 public constant BALANCE_DECREASING_TRANSACTION = 2;
    uint16 public constant CONFIRMED_BLOCK_HEIGHT_EXISTS = 3;
    uint16 public constant REFERENCED_PAYMENT_NONEXISTENCE = 4;
    uint16 public constant TRUSTLINE_ISSUANCE = 5;

    function verifyPayment(uint32 _chainId, Payment calldata _data)
        external view override
        returns (bool _proved)
    {
        return _verifyMerkleProof(
            _data.merkleProof,
            merkleRootForRound(_data.stateConnectorRound),
            _hashPayment(_chainId, _data)
        );
    }

    function verifyBalanceDecreasingTransaction(uint32 _chainId, BalanceDecreasingTransaction calldata _data)
        external view override
        returns (bool _proved)
    {
        return _verifyMerkleProof(
            _data.merkleProof,
            merkleRootForRound(_data.stateConnectorRound),
            _hashBalanceDecreasingTransaction(_chainId, _data)
        );
    }

    function verifyConfirmedBlockHeightExists(uint32 _chainId, ConfirmedBlockHeightExists calldata _data)
        external view override
        returns (bool _proved)
    {
        return _verifyMerkleProof(
            _data.merkleProof,
            merkleRootForRound(_data.stateConnectorRound),
            _hashConfirmedBlockHeightExists(_chainId, _data)
        );
    }

    function verifyReferencedPaymentNonexistence(uint32 _chainId, ReferencedPaymentNonexistence calldata _data)
        external view override
        returns (bool _proved)
    {
        return _verifyMerkleProof(
            _data.merkleProof,
            merkleRootForRound(_data.stateConnectorRound),
            _hashReferencedPaymentNonexistence(_chainId, _data)
        );
    }

    function verifyTrustlineIssuance(uint32 _chainId, TrustlineIssuance calldata _data)
        external view override
        returns (bool _proved)
    {
        return _verifyMerkleProof(
            _data.merkleProof,
            merkleRootForRound(_data.stateConnectorRound),
            _hashTrustlineIssuance(_chainId, _data)
        );
    }

    function merkleRootForRound(uint256 _stateConnectorRound) public view virtual returns (bytes32 _merkleRoot);

    function _hashPayment(uint32 _chainId, Payment calldata _data)
        private pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(
            // split into parts of length 8 to avoid 'stack too deep' errors
            abi.encode(
                PAYMENT,
                _chainId,
                _data.blockNumber,
                _data.blockTimestamp,
                _data.transactionHash,
                _data.inUtxo,
                _data.utxo,
                _data.sourceAddressHash
            ),
            abi.encode(
                _data.receivingAddressHash,
                _data.spentAmount,
                _data.receivedAmount,
                _data.paymentReference,
                _data.oneToOne,
                _data.status
            )
        ));
    }

    function _hashBalanceDecreasingTransaction(uint32 _chainId, BalanceDecreasingTransaction calldata _data)
        private pure
        returns (bytes32)
    {
        return keccak256(abi.encode(
            BALANCE_DECREASING_TRANSACTION,
            _chainId,
            _data.blockNumber,
            _data.blockTimestamp,
            _data.transactionHash,
            _data.inUtxo,
            _data.sourceAddressHash,
            _data.spentAmount,
            _data.paymentReference
        ));
    }

    function _hashConfirmedBlockHeightExists(uint32 _chainId, ConfirmedBlockHeightExists calldata _data)
        private pure
        returns (bytes32)
    {
        return keccak256(abi.encode(
            CONFIRMED_BLOCK_HEIGHT_EXISTS,
            _chainId,
            _data.blockNumber,
            _data.blockTimestamp,
            _data.numberOfConfirmations,
            _data.averageBlockProductionTimeMs,
            _data.lowestQueryWindowBlockNumber,
            _data.lowestQueryWindowBlockTimestamp
        ));
    }

    function _hashReferencedPaymentNonexistence(uint32 _chainId, ReferencedPaymentNonexistence calldata _data)
        private pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(
            // split into parts of length 8 to avoid 'stack too deep' errors
            abi.encode(
                REFERENCED_PAYMENT_NONEXISTENCE,
                _chainId,
                _data.deadlineBlockNumber,
                _data.deadlineTimestamp,
                _data.destinationAddressHash,
                _data.paymentReference,
                _data.amount,
                _data.lowerBoundaryBlockNumber
            ),
            abi.encode(
                _data.lowerBoundaryBlockTimestamp,
                _data.firstOverflowBlockNumber,
                _data.firstOverflowBlockTimestamp
            )
        ));
    }

    function _hashTrustlineIssuance(uint32 _chainId, TrustlineIssuance calldata _data)
        private pure
        returns (bytes32)
    {
        return keccak256(abi.encode(
            TRUSTLINE_ISSUANCE,
            _chainId,
            _data.tokenCurrencyCode,
            _data.tokenValueNominator,
            _data.tokenValueDenominator,
            _data.tokenIssuer
        ));
    }

    function _verifyMerkleProof(
        bytes32[] memory proof,
        bytes32 merkleRoot,
        bytes32 leaf
    ) internal pure returns (bool) {
        return proof.verify(merkleRoot, leaf);
    }

}
