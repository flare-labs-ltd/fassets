// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../../generated/interface/IAttestationClient.sol";
import "./data/AssetManagerSettings.sol";
import "./data/PaymentConfirmations.sol";


library TransactionAttestation {
    
    // payment status constants
    uint8 internal constant PAYMENT_SUCCESS = 0;
    uint8 internal constant PAYMENT_FAILED = 1;
    uint8 internal constant PAYMENT_BLOCKED = 2;

    function verifyPaymentSuccess(
        AssetManagerSettings.Data storage _settings,
        IAttestationClient.Payment calldata _attestationData
    ) 
        internal view
    {
        require(_attestationData.status == PAYMENT_SUCCESS, "payment failed");
        verifyPayment(_settings, _attestationData);
    }
    
    function verifyPayment(
        AssetManagerSettings.Data storage _settings,
        IAttestationClient.Payment calldata _attestationData
    ) 
        internal view
    {
        require(_settings.attestationClient.verifyPayment(_settings.chainId, _attestationData), 
            "legal payment not proved");
        require(_confirmationCannotBeCleanedUp(_attestationData.blockTimestamp), "verified transaction too old");
    }
    
    function verifyBalanceDecreasingTransaction(
        AssetManagerSettings.Data storage _settings,
        IAttestationClient.BalanceDecreasingTransaction calldata _attestationData
    ) 
        internal view
    {
        require(_settings.attestationClient.verifyBalanceDecreasingTransaction(_settings.chainId, _attestationData), 
            "transaction not proved");
        require(_confirmationCannotBeCleanedUp(_attestationData.blockTimestamp), "verified transaction too old");
    }
    
    function verifyConfirmedBlockHeightExists(
        AssetManagerSettings.Data storage _settings,
        IAttestationClient.ConfirmedBlockHeightExists calldata _attestationData
    ) 
        internal view
    {
        require(_settings.attestationClient.verifyConfirmedBlockHeightExists(_settings.chainId, _attestationData), 
            "block height not proved");
    }
    
    function verifyReferencedPaymentNonexistence(
        AssetManagerSettings.Data storage _settings,
        IAttestationClient.ReferencedPaymentNonexistence calldata _attestationData
    ) 
        internal view
    {
        require(_settings.attestationClient.verifyReferencedPaymentNonexistence(_settings.chainId, _attestationData), 
            "non-payment not proved");
    }
    
    function _confirmationCannotBeCleanedUp(uint256 timestamp) private view returns (bool) {
        return timestamp >= block.timestamp - PaymentConfirmations.VERIFICATION_CLEANUP_DAYS * 1 days;
    }
}
