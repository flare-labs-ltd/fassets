//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


interface ISCProofVerifier {

    struct Payment {
        // Merkle proof needed to verify the existence of transaction with the below fields.
        bytes32[] merkleProof;

        // Round id in which the attestation request was validated.
        uint256 stateConnectorRound;

        // Number of the transaction block on the underlying chain.
        uint64 blockNumber;

        // Timestamp of the transaction block on the underlying chain.
        uint64 blockTimestamp;

        // Hash of the transaction on the underlying chain.
        bytes32 transactionHash;

        // Index of the transaction input indicating source address on UTXO chains, 0 on non-UTXO chains.
        uint8 inUtxo;

        // Output index for a transaction with multiple outputs on UTXO chains, 0 on non-UTXO chains.
        // The same as in the 'utxo' parameter from the request.
        uint8 utxo;

        // Standardized address hash of the source address viewed as a string
        // (the one indicated by the 'inUtxo' parameter for UTXO blockchains).
        bytes32 sourceAddressHash;

        // Standardized address hash of the intended source address viewed as a string
        // (the one indicated by the 'inUtxo' parameter for UTXO blockchains).
        bytes32 intendedSourceAddressHash;

        // Standardized address hash of the receiving address as a string
        // (the one indicated by the 'utxo' parameter for UTXO blockchains).
        bytes32 receivingAddressHash;

        // Standardized address hash of the intended receiving address as a string
        // (the one indicated by the 'utxo' parameter for UTXO blockchains).
        bytes32 intendedReceivingAddressHash;

        // The amount that went out of the source address, in the smallest underlying units.
        // In non-UTXO chains it includes both payment value and fee (gas).
        // Calculation for UTXO chains depends on the existence of standardized payment reference.
        // If it exists, it is calculated as 'outgoing_amount - returned_amount' and can be negative.
        // If the standardized payment reference does not exist, then it is just the spent amount
        // on the input indicated by 'inUtxo'.
        int256 spentAmount;

        // The amount that was intended to go out of the source address, in the smallest underlying units.
        // If the transaction status is successful the value matches 'spentAmount'.
        // If the transaction status is not successful, the value is the amount that was intended
        // to be spent by the source address.
        int256 intendedSpentAmount;

        // The amount received to the receiving address, in smallest underlying units.
        // Can be negative in UTXO chains.
        int256 receivedAmount;

        // The intended amount to be received by the receiving address, in smallest underlying units.
        // For transactions that are successful, this is the same as 'receivedAmount'.
        // If the transaction status is not successful, the value is the amount that was intended
        // to be received by the receiving address.
        int256 intendedReceivedAmount;

        // Standardized payment reference, if it exists, 0 otherwise.
        bytes32 paymentReference;

        // 'true' if the transaction has exactly one source address and
        // exactly one receiving address (different from source).
        bool oneToOne;

        // Transaction success status, can have 3 values:
        //   - 0 - Success
        //   - 1 - Failure due to sender (this is the default failure)
        //   - 2 - Failure due to receiver (bad destination address)
        uint8 status;
    }

    struct BalanceDecreasingTransaction {
        // Merkle proof needed to verify the existence of transaction with the below fields.
        bytes32[] merkleProof;

        // Round id in which the attestation request was validated.
        uint256 stateConnectorRound;

        // Number of the transaction block on the underlying chain.
        uint64 blockNumber;

        // Timestamp of the transaction block on the underlying chain.
        uint64 blockTimestamp;

        // Hash of the transaction on the underlying chain.
        bytes32 transactionHash;

        // Either standardized hash of a source address or UTXO vin index in hex format
        // (as provided in the request).
        bytes32 sourceAddressIndicator;

        // Standardized hash of the source address viewed as a string (the one indicated
        //   by the 'sourceAddressIndicator' (vin input index) parameter for UTXO blockchains).
        bytes32 sourceAddressHash;

        // The amount that went out of the source address, in the smallest underlying units.
        // In non-UTXO chains it includes both payment value and fee (gas).
        // Calculation for UTXO chains depends on the existence of standardized payment reference.
        // If it exists, it is calculated as 'total_outgoing_amount - returned_amount' from the address
        // indicated by 'sourceAddressIndicator', and can be negative.
        // If the standardized payment reference does not exist, then it is just the spent amount
        // on the input indicated by 'sourceAddressIndicator'.
        int256 spentAmount;

        // Standardized payment reference, if it exists, 0 otherwise.
        bytes32 paymentReference;
    }

    struct ConfirmedBlockHeightExists {
        // Merkle proof needed to verify the existence of transaction with the below fields.
        bytes32[] merkleProof;

        // Round id in which the attestation request was validated.
        uint256 stateConnectorRound;

        // Number of the highest confirmed block that was proved to exist.
        uint64 blockNumber;

        // Timestamp of the confirmed block that was proved to exist.
        uint64 blockTimestamp;

        // Number of confirmations for the blockchain.
        uint8 numberOfConfirmations;

        // Lowest query window block number.
        uint64 lowestQueryWindowBlockNumber;

        // Lowest query window block timestamp.
        uint64 lowestQueryWindowBlockTimestamp;
    }

    struct ReferencedPaymentNonexistence {
        // Merkle proof needed to verify the existence of transaction with the below fields.
        bytes32[] merkleProof;

        // Round id in which the attestation request was validated.
        uint256 stateConnectorRound;

        // Deadline block number specified in the attestation request.
        uint64 deadlineBlockNumber;

        // Deadline timestamp specified in the attestation request.
        uint64 deadlineTimestamp;

        // Standardized address hash of the destination address searched for.
        bytes32 destinationAddressHash;

        // The payment reference searched for.
        bytes32 paymentReference;

        // The minimal amount intended to be paid to the destination address.
        // The actual amount should match or exceed this value.
        uint128 amount;

        // The first confirmed block that gets checked. It is exactly 'minimalBlockNumber' from the request.
        uint64 lowerBoundaryBlockNumber;

        // Timestamp of the 'lowerBoundaryBlockNumber'.
        uint64 lowerBoundaryBlockTimestamp;

        // The first (lowest) confirmed block with 'timestamp > deadlineTimestamp'
        // and 'blockNumber  > deadlineBlockNumber'.
        uint64 firstOverflowBlockNumber;

        // Timestamp of the firstOverflowBlock.
        uint64 firstOverflowBlockTimestamp;
    }

    // When verifying state connector proofs, the data verified will be
    //   `keccak256(abi.encode(attestationType, _chainId, all _data fields except merkleProof, stateConnectorRound))`
    // where `attestationType` (`uint16`) is a different constant for each of the methods below
    // (possible values are defined in attestation specs).

    function verifyPayment(uint32 _chainId, Payment calldata _data)
        external view
        returns (bool _proved);
    
    
    function verifyBalanceDecreasingTransaction(uint32 _chainId, BalanceDecreasingTransaction calldata _data)
        external view
        returns (bool _proved);
    
    
    function verifyConfirmedBlockHeightExists(uint32 _chainId, ConfirmedBlockHeightExists calldata _data)
        external view
        returns (bool _proved);
    
    
    function verifyReferencedPaymentNonexistence(uint32 _chainId, ReferencedPaymentNonexistence calldata _data)
        external view
        returns (bool _proved);
}
