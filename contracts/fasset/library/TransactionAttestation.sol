// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interface/IAttestationClient.sol";
import "../interface/IAssetManager.sol";
import "../library/AssetManagerSettings.sol";


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
    {
        require(_attestationData.status == PAYMENT_SUCCESS, "payment failed");
        verifyPaymentProof(_settings, _attestationData, _requireSingleSource);
    }
    
    function verifyPaymentProof(
        AssetManagerSettings.Settings storage _settings,
        IAttestationClient.PaymentProof calldata _attestationData,
        bool _requireSingleSource
    ) 
        internal view
    {
        require(_settings.attestationClient.verifyPaymentProof(_settings.chainId, _attestationData), 
            "legal payment not proved");
        require(_attestationData.blockTimestamp >= block.timestamp - MAX_VALID_PROOF_AGE_SECONDS,
            "verified transaction too old");
        require(!_requireSingleSource || _attestationData.sourceAddress != 0,
            "required single source payment");
    }
    
    function verifyBalanceDecreasingTransaction(
        AssetManagerSettings.Settings storage _settings,
        IAttestationClient.BalanceDecreasingTransaction calldata _attestationData
    ) 
        internal view
    {
        require(_settings.attestationClient.verifyBalanceDecreasingTransaction(_settings.chainId, _attestationData), 
            "transaction not proved");
        require(_attestationData.blockTimestamp >= block.timestamp - MAX_VALID_PROOF_AGE_SECONDS,
            "verified transaction too old");
    }
    
    function verifyBlockHeightExists(
        AssetManagerSettings.Settings storage _settings,
        IAttestationClient.BlockHeightExists calldata _attestationData
    ) 
        internal view
    {
        require(_settings.attestationClient.verifyBlockHeightExists(_settings.chainId, _attestationData), 
            "block height not proved");
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
}
