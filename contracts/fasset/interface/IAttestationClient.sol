// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


interface IAttestationClient {
    struct PaymentProof {
        // Round number (epoch id) of the state connector request
        uint256 stateConnectorRound;
        
        // Merkle proof needed to verify the existence of transaction with the below fields.
        bytes32[] merkleProof;
        
        // Number of the transaction block on the underlying chain.
        uint64 blockNumber;
        
        // Timestamp of the transaction block on the underlying chain.
        uint64 blockTimestamp;
        
        // Hash of the transaction on the underlying chain.
        bytes32 transactionHash;
        
        // Output index for transactions with multiple outputs.
        uint8 utxo;
        
        // In case of single source address (required for redemptions): hash of the source address as a string.
        // For multi-source payments (allowed for minting and topup): must be zero.
        bytes32 sourceAddress;
        
        // Hash of the receiving address as a string (there can only be a single address for this type).
        bytes32 receivingAddress;
        
        // Chain dependent extra data (e.g. memo field, detination tag, tx data)
        // For minting and redemption payment it depends on request id, 
        // for topup and self-mint it depends on the agent vault address.
        // See PaymentReference.sol for details of payment reference calculation.
        uint256 paymentReference;

        // The amount that what went out of source address (or all source addresses), in smallest underlying units.
        // It includes both payment value and fee / gas.
        int256 spentAmount;
        
        // The amount the receiving address received, in smallest underlying units.
        uint256 receivedAmount;
        
        // True if the transaction has exactly one source address and 
        // exactly one receiving address (different from source).
        bool oneToOne;

        // Transaction success status, can have 3 values:
        // 0 - Success
        // 1 - Failure due to sender fault (this is the default failure)
        // 2 - Failure due to receiver fault (bad destination address)
        uint8 status;
    }
    
    struct BalanceDecreasingTransaction {
        // Round number (epoch id) of the state connector request
        uint256 stateConnectorRound;
        
        // Merkle proof needed to verify the existence of transaction with the below fields.
        bytes32[] merkleProof;
        
        // Number of the transaction block on the underlying chain.
        uint64 blockNumber;
        
        // Timestamp of the transaction block on the underlying chain.
        uint64 blockTimestamp;
        
        // Hash of the transaction on the underlying chain.
        bytes32 transactionHash;
        
        // Must always be a single address. For utxo transactions with multiple addresses,
        // it is the one for which `spent` is calculated and was indicated in the state connector instructions.
        bytes32 sourceAddress;

        // The amount that what went out of source address, in smallest underlying units.
        // It includes both payment value and fee (gas).
        // For utxo chains it can be negative, that's why signed int256 is used.
        int256 spentAmount;
        
        // If the attestation provider detects that the transaction is actually a valid payment (same conditions
        // as for PaymentProof), it should set this field to its the paymentReference.
        // Otherwise, paymentReference must be 0.
        uint256 paymentReference;
    }
    
    struct ReferencedPaymentNonexistence {
        // Round number (epoch id) of the state connector request
        uint256 stateConnectorRound;
        
        // Merkle proof needed to verify the existence of transaction with the below fields.
        bytes32[] merkleProof;

        // End timestamp specified in attestation request.
        uint64 endTimestamp;
        
        // End block specified in attestation request.
        uint64 endBlock;
        
        // Payment nonexistence is confirmed if there is no payment transaction (attestation of PaymentProof type)
        // with correct `(destinationAddress, paymentReference, amount) combination
        // and with transaction status 0 (success) or 2 (failure, receiver's fault). 
        // Note: if there exist only payment(s) with status 1 (failure, sender's fault) 
        // then payment nonexistence is still confirmed.
        bytes32 destinationAddress;
        uint256 paymentReference;
        uint128 amount;
        
        // The first (confirmed) block that gets checked. It is the block that has timestamp (median time) 
        // greater or equal to `endTimestamp - CHECK_WINDOW`. 
        // f-asset: check that `firstCheckBlock <= currentUnderlyingBlock` at the time of redemption request.
        uint64 firstCheckedBlock;
        
        // Timestamp of the firstCheckedBlock.
        uint64 firstCheckedBlockTimestamp;
        
        // The first confirmed block with `timestamp > endTimestamp` and `blockNumber  > endBlock`. 
        // f-asset: check that `firstOverflowBlock > last payment block` (`= currentUnderlyingBlock + blocksToPay`).
        uint64 firstOverflowBlock;
        
        // Timestamp of the firstOverflowBlock.
        // f-asset: check that `firstOverflowBlockTimestamp > last payment timestamp` 
        //     (`= currentUnderlyingBlockTimestamp + time to pay`). 
        uint64 firstOverflowBlockTimestamp;
    }
    
    struct BlockHeightExists {
        // Round number (epoch id) of the state connector request
        uint256 stateConnectorRound;
        
        // Merkle proof needed to verify the existence of transaction with the below fields.
        bytes32[] merkleProof;
        
        // Number of the block that was proved to exist.
        uint64 blockNumber;
        
        // Timestamp of the block that was proved to exist.
        uint64 blockTimestamp;
    }

    // When verifying state connector proofs, the data verified will be
    // `keccak256(abi.encode(attestationType, _chainId, all _data fields except merkleProof, stateConnectorRound))`
    // where `attestationType` (`uint16`) is a different constant for each of the methods below
    // (possible values are defined in attestation specs).
    
    function verifyPaymentProof(uint32 _chainId, PaymentProof calldata _data) 
        external view
        returns (bool _proved);
    
    function verifyBalanceDecreasingTransaction(uint32 _chainId, BalanceDecreasingTransaction calldata _data) 
        external view
        returns (bool _proved);

    function verifyReferencedPaymentNonexistence(uint32 _chainId, ReferencedPaymentNonexistence calldata _data)
        external view
        returns (bool _proved);
    
    function verifyBlockHeightExists(uint32 _chainId, BlockHeightExists calldata _data) 
        external view
        returns (bool _proved);
}
