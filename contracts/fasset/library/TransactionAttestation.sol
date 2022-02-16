// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interface/IAttestationClient.sol";
import "../interface/IAssetManager.sol";
import "../library/AssetManagerSettings.sol";
import "../library/PaymentVerification.sol";


library TransactionAttestation {
    
    // must be strictly smaller than PaymentVerification.VERIFICATION_CLEANUP_DAYS
    uint256 internal constant MAX_VALID_PROOF_AGE_SECONDS = 2 days;

    // payment status constants
    uint8 internal constant PAYMENT_SUCCESS = 0;
    uint8 internal constant PAYMENT_FAILED = 1;
    uint8 internal constant PAYMENT_BLOCKED = 2;

    function verifyPaymentProofSuccess(
        AssetManagerSettings.Settings storage _settings,
        IAttestationClient.PaymentProof calldata _attestationData,
        bool _requireSingleSource
    ) 
        internal view
        returns (PaymentVerification.UnderlyingPaymentInfo memory)
    {
        require(_attestationData.status == PAYMENT_SUCCESS, "payment failed");
        return verifyPaymentProof(_settings, _attestationData, _requireSingleSource);
    }
    
    function verifyPaymentProof(
        AssetManagerSettings.Settings storage _settings,
        IAttestationClient.PaymentProof calldata _attestationData,
        bool _requireSingleSource
    ) 
        internal view
        returns (PaymentVerification.UnderlyingPaymentInfo memory)
    {
        require(_settings.attestationClient.verifyPaymentProof(_settings.chainId, _attestationData), 
            "legal payment not proved");
        require(_attestationData.blockTimestamp >= block.timestamp - MAX_VALID_PROOF_AGE_SECONDS,
            "verified transaction too old");
        require(!_requireSingleSource || _attestationData.sourceAddress != 0,
            "required single source payment");
        return decodePaymentProof(_attestationData);
    }
    
    function verifyBalanceDecreasingTransaction(
        AssetManagerSettings.Settings storage _settings,
        IAttestationClient.BalanceDecreasingTransaction calldata _attestationData
    ) 
        internal view
        returns (PaymentVerification.UnderlyingPaymentInfo memory)
    {
        require(_settings.attestationClient.verifyBalanceDecreasingTransaction(_settings.chainId, _attestationData), 
            "transaction not proved");
        require(_attestationData.blockTimestamp >= block.timestamp - MAX_VALID_PROOF_AGE_SECONDS,
            "verified transaction too old");
        return decodeBalanceDecreasingTransaction(_attestationData);
    }
    
    function verifyBlockHeightExists(
        AssetManagerSettings.Settings storage _settings,
        IAttestationClient.BlockHeightExists calldata _attestationData
    ) 
        internal view
        returns (uint64 _blockHeight, uint64 _blockTimestamp)
    {
        require(_settings.attestationClient.verifyBlockHeightExists(_settings.chainId, _attestationData), 
            "block height not proved");
        _blockHeight = _attestationData.blockNumber;
        _blockTimestamp = _attestationData.blockTimestamp;
    }
    
    function verifyReferencedPaymentNonexistence(
        AssetManagerSettings.Settings storage _settings,
        IAttestationClient.ReferencedPaymentNonexistence calldata _attestationData
    ) 
        internal view
    {
        require(_settings.attestationClient.verifyReferencedPaymentNonexistence(_settings.chainId, _attestationData), 
            "non-payment not proved");
    }
    
    function decodePaymentProof(
        IAttestationClient.PaymentProof calldata _attestationData
    ) 
        internal pure
        returns (PaymentVerification.UnderlyingPaymentInfo memory)
    {
        return PaymentVerification.UnderlyingPaymentInfo({
            sourceAddressHash: _attestationData.sourceAddress,
            targetAddressHash: _attestationData.receivingAddress,
            transactionHash: _attestationData.transactionHash,
            paymentReference: _attestationData.paymentReference,
            deliveredUBA: _attestationData.receivedAmount,
            spentUBA: _attestationData.spentAmount,
            underlyingBlock: _attestationData.blockNumber
        });
    }

    function decodeBalanceDecreasingTransaction(
        IAttestationClient.BalanceDecreasingTransaction calldata _attestationData
    ) 
        internal pure
        returns (PaymentVerification.UnderlyingPaymentInfo memory)
    {
        return PaymentVerification.UnderlyingPaymentInfo({
            sourceAddressHash: _attestationData.sourceAddress,
            targetAddressHash: 0,       // not important
            transactionHash: _attestationData.transactionHash,
            paymentReference: 0,    // not important
            deliveredUBA: 0,
            spentUBA: _positive(_attestationData.spentAmount),
            underlyingBlock: _attestationData.blockNumber
        });
    }

    function decodeBlockHeightExists(
        IAttestationClient.BalanceDecreasingTransaction calldata _attestationData
    ) 
        internal pure
        returns (uint64 _blockHeight, uint64 _blockTimestamp)
    {
        _blockHeight = _attestationData.blockNumber;
        _blockTimestamp = _attestationData.blockTimestamp;
    }
    
    function decodePaymentReport(
        IAssetManager.PaymentReport calldata _paymentReport
    )
        internal pure
        returns (PaymentVerification.UnderlyingPaymentInfo memory)
    {
        return PaymentVerification.UnderlyingPaymentInfo({
            sourceAddressHash: _paymentReport.sourceAddress,
            targetAddressHash: _paymentReport.receivingAddress,
            transactionHash: _paymentReport.transactionHash,
            paymentReference: _paymentReport.paymentReference,
            deliveredUBA: _paymentReport.receivedAmount,
            spentUBA: _paymentReport.spentAmount,
            underlyingBlock: 0  // TODO: not used in payment reportfor now
        });
    }
    
    function _positive(int256 _value) private pure returns (uint256) {
        return _value >= 0 ? uint256(_value) : 0;
    }
    
}
