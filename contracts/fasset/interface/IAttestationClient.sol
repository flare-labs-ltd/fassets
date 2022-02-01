// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;


interface IAttestationClient {
    struct LegalPayment {
        // Buffer number (epoch id) of the state connector request
        uint256 stateConnectorBuffer;
        
        // Merkle proof needed to verify the existence of transaction with the below fields.
        bytes32[] merkleProof;
        
        // Number of the transaction block on the underlying chain.
        uint64 blockNumber;
        
        // Timestamp of the transaction block on the underlying chain.
        uint64 blockTimestamp;
        
        // Hash of the transaction on the underlying chain.
        bytes32 transactionHash;
        
        // In case of single source address (required for redemptions): hash of the source address as a string.
        // For multi-source payments (allowed for minting and topup): must be zero.
        bytes32 spendingAddress;
        
        // Hash of the receiving address as a string (there can only be a single address for this type).
        bytes32 receivingAddress;
        
        // Chain dependent extra data (e.g. memo field, detination tag, tx data)
        // - for minting, ir will be based in collateral reservation id, to prevent using the payment by somone else
        // - for redemption, it will have the value requested by the redeemer
        // - for topup it must be constant (TOPUP_PAYMENT_REFERENCE)
        bytes32 paymentReference;

        // The amount that what went out of source address (or all source addresses), in smallest underlying units.
        // It includes both payment value and fee / gas.
        // For utxo chains it can be negative, that's why signed int256 is used.
        uint256 spentAmount;
        
        // The amount the receiving address received, in smallest underlying units.
        uint256 receivedAmount;

        // Transaction success status, can have 3 values:
        // 0 - Success
        // 1 - Failure due to sender fault (this is the default failure)
        // 2 - Failure due to receiver fault (bad destination address)
        uint8 status;
    }
    
    struct SourceUsingTransaction {
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
        bytes32 spendingAddress;

        // The amount that what went out of spending address, in smallest underlying units.
        // It includes both payment value and fee (gas).
        // For utxo chains it can be negative, that's why signed int256 is used.
        int256 spentAmount;
    }
    
    struct BlockHeightExists {
        // Merkle proof needed to verify the existence of transaction with the below fields.
        bytes32[] merkleProof;
        
        // Number of the block that was proved to exist.
        uint64 blockNumber;
    }

    // When verifying state connector proofs, the data verified will be
    // `keccak256(abi.encode(attestationType, _chainId, all _data fields except merkleProof))`
    // where `attestationType` (`uint16`) is a different constant for each of the methods below
    // (possible values are defined in attestation specs).
    
    function verifyLegalPayment(uint32 _chainId, LegalPayment calldata _data) 
        external view
        returns (bool _proved);
    
    function verifySourceUsingTransaction(uint32 _chainId, SourceUsingTransaction calldata _data) 
        external view
        returns (bool _proved);
    
    function verifyBlockHeightExists(uint32 _chainId, BlockHeightExists calldata _data) 
        external view
        returns (bool _proved);
}
