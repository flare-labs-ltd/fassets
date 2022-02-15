// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../interface/IAttestationClient.sol";


contract AttestationClientMock is IAttestationClient {
    // possible attestationType values
    uint16 public constant PAYMENT_PROOF = 1;
    uint16 public constant BALANCE_DECREASING_TRANSACION = 2;
    uint16 public constant BLOCK_HEIGHT_EXISTS = 3;
    uint16 public constant REFERENCED_PAYMENT_NONEXISTENCE = 3;
    
    mapping (bytes32 => bool) private _proofs;

    // because this is mock, we do not use state connector merkle root, but just state it is proved
    
    function provePaymentProof(uint32 _chainId, PaymentProof calldata _data) 
        external
    {
        _proofs[_hashPaymentProof(_chainId, _data)] = true;
    }
    
    function proveBalanceDecreasingTransaction(uint32 _chainId, BalanceDecreasingTransaction calldata _data) 
        external
    {
        _proofs[_hashBalanceDecreasingTransaction(_chainId, _data)] = true;
    }

    function proveReferencedPaymentNonexistence(uint32 _chainId, ReferencedPaymentNonexistence calldata _data) 
        external
    {
        _proofs[_hashReferencedPaymentNonexistence(_chainId, _data)] = true;
    }
    
    function proveBlockHeightExists(uint32 _chainId, BlockHeightExists calldata _data) 
        external
    {
        _proofs[_hashBlockHeightExists(_chainId, _data)] = true;
    }
    
    function verifyPaymentProof(uint32 _chainId, PaymentProof calldata _data) 
        external view override
        returns (bool _proved)
    {
        return _proofs[_hashPaymentProof(_chainId, _data)];
    }
    
    function verifyBalanceDecreasingTransaction(uint32 _chainId, BalanceDecreasingTransaction calldata _data) 
        external view override
        returns (bool _proved)
    {
        return _proofs[_hashBalanceDecreasingTransaction(_chainId, _data)];
    }

    function verifyReferencedPaymentNonexistence(uint32 _chainId, ReferencedPaymentNonexistence calldata _data) 
        external view override
        returns (bool _proved)
    {
        return _proofs[_hashReferencedPaymentNonexistence(_chainId, _data)];
    }
    
    function verifyBlockHeightExists(uint32 _chainId, BlockHeightExists calldata _data) 
        external view override
        returns (bool _proved)
    {
        return _proofs[_hashBlockHeightExists(_chainId, _data)];
    }

    function _hashPaymentProof(uint32 _chainId, PaymentProof calldata _data) 
        private pure
        returns (bytes32)
    {
        return keccak256(abi.encode(
            PAYMENT_PROOF,
            _chainId, 
            _data.blockNumber, 
            _data.blockTimestamp, 
            _data.transactionHash, 
            _data.utxo, 
            _data.sourceAddress, 
            _data.receivingAddress,
            _data.paymentReference, 
            _data.spentAmount, 
            _data.receivedAmount, 
            _data.oneToOne, 
            _data.status
        ));
    }
    
    function _hashBalanceDecreasingTransaction(uint32 _chainId, BalanceDecreasingTransaction calldata _data) 
        private pure
        returns (bytes32)
    {
        return keccak256(abi.encode(
            BALANCE_DECREASING_TRANSACION,
            _chainId, 
            _data.blockNumber, 
            _data.blockTimestamp, 
            _data.transactionHash, 
            _data.sourceAddress, 
            _data.spentAmount
        ));
    }

    function _hashReferencedPaymentNonexistence(uint32 _chainId, ReferencedPaymentNonexistence calldata _data)
        private pure
        returns (bytes32)
    {
        return keccak256(abi.encode(
            REFERENCED_PAYMENT_NONEXISTENCE,
            _chainId, 
            _data.endTimestamp, 
            _data.endBlock, 
            _data.destinationAddress, 
            _data.paymentReference, 
            _data.amount,
            _data.firstCheckedBlock,
            _data.firstCheckedBlockTimestamp,
            _data.firstOverflowBlock,
            _data.firstOverflowBlockTimestamp
        ));
    }
    
    function _hashBlockHeightExists(uint32 _chainId, BlockHeightExists calldata _data) 
        private pure
        returns (bytes32)
    {
        return keccak256(abi.encode(
            BLOCK_HEIGHT_EXISTS,
            _chainId, 
            _data.blockNumber,
            _data.blockTimestamp
        ));
    }
}
