// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;


import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../interface/IAttestationClient.sol";
import "../library/AssetManagerSettings.sol";
import "../library/PaymentVerification.sol";

library TransactionAttestation {
    using SafeMath for uint256;
    
    // must be strictly smaller than PaymentVerification.VERIFICATION_CLEANUP_DAYS
    uint256 internal constant MAX_VALID_PROOF_AGE_SECONDS = 2 days;

    // payment status constants
    uint8 internal constant PAYMENT_SUCCESS = 0;
    uint8 internal constant PAYMENT_FAILED = 1;
    uint8 internal constant PAYMENT_BLOCKED = 2;
    
    function verifyLegalPayment(
        AssetManagerSettings.Settings storage _settings,
        IAttestationClient.LegalPayment calldata _attestationData,
        bool _requireSingleSource
    ) 
        internal view
        returns (PaymentVerification.UnderlyingPaymentInfo memory)
    {
        require(_settings.attestationClient.verifyLegalPayment(_settings.chainId, _attestationData), 
            "legal payment not proved");
        require(_attestationData.blockTimestamp >= block.timestamp.sub(MAX_VALID_PROOF_AGE_SECONDS),
            "verified transaction too old");
        require(!_requireSingleSource || _attestationData.spendingAddress != 0,
            "required single source payment");
        return decodeLegalPayment(_attestationData);
    }
    
    function verifySourceUsingTransaction(
        AssetManagerSettings.Settings storage _settings,
        IAttestationClient.SourceUsingTransaction calldata _attestationData
    ) 
        internal view
        returns (PaymentVerification.UnderlyingPaymentInfo memory)
    {
        require(_settings.attestationClient.verifySourceUsingTransaction(_settings.chainId, _attestationData), 
            "transaction not proved");
        require(_attestationData.blockTimestamp >= block.timestamp.sub(MAX_VALID_PROOF_AGE_SECONDS),
            "verified transaction too old");
        return decodeSourceUsingTransaction(_attestationData);
    }
    
    function verifyBlockHeightExists(
        AssetManagerSettings.Settings storage _settings,
        IAttestationClient.BlockHeightExists calldata _attestationData
    ) 
        internal view
        returns (uint64 _minBlockHeight)
    {
        require(_settings.attestationClient.verifyBlockHeightExists(_settings.chainId, _attestationData), 
            "block height not proved");
        return SafeCast.toUint64(_attestationData.blockNumber);
    }
    
    function decodeLegalPayment(
        IAttestationClient.LegalPayment calldata _attestationData
    ) 
        internal pure
        returns (PaymentVerification.UnderlyingPaymentInfo memory)
    {
        return PaymentVerification.UnderlyingPaymentInfo({
            sourceAddressHash: _attestationData.spendingAddress,
            targetAddressHash: _attestationData.receivingAddress,
            transactionHash: _attestationData.transactionHash,
            paymentReference: _attestationData.paymentReference,
            deliveredUBA: _attestationData.receivedAmount,
            spentUBA: _attestationData.spentAmount,
            underlyingBlock: _attestationData.blockNumber
        });
    }

    function decodeSourceUsingTransaction(
        IAttestationClient.SourceUsingTransaction calldata _attestationData
    ) 
        internal pure
        returns (PaymentVerification.UnderlyingPaymentInfo memory)
    {
        return PaymentVerification.UnderlyingPaymentInfo({
            sourceAddressHash: _attestationData.spendingAddress,
            targetAddressHash: 0,       // not important
            transactionHash: _attestationData.transactionHash,
            paymentReference: 0,    // not important
            deliveredUBA: 0,
            spentUBA: _positive(_attestationData.spentAmount),
            underlyingBlock: _attestationData.blockNumber
        });
    }

    function decodeBlockHeightExists(
        IAttestationClient.SourceUsingTransaction calldata _attestationData
    ) 
        internal pure
        returns (uint256 _minBlockHeight)
    {
        return _attestationData.blockNumber;
    }
    
    function _positive(int256 _value) private pure returns (uint256) {
        return _value >= 0 ? uint256(_value) : 0;
    }
    
}
