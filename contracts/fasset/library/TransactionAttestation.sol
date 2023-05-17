// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../../generated/interface/IAttestationClient.sol";
import "./data/AssetManagerState.sol";


library TransactionAttestation {

    // payment status constants
    uint8 internal constant PAYMENT_SUCCESS = 0;
    uint8 internal constant PAYMENT_FAILED = 1;
    uint8 internal constant PAYMENT_BLOCKED = 2;

    function verifyPaymentSuccess(
        IAttestationClient.Payment calldata _attestationData
    )
        internal view
    {
        require(_attestationData.status == PAYMENT_SUCCESS, "payment failed");
        verifyPayment(_attestationData);
    }

    function verifyPayment(
        IAttestationClient.Payment calldata _attestationData
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = AssetManagerState.getSettings();
        IAttestationClient attestationClient = IAttestationClient(_settings.attestationClient);
        require(attestationClient.verifyPayment(_settings.chainId, _attestationData),
            "legal payment not proved");
        require(_confirmationCannotBeCleanedUp(_attestationData.blockTimestamp), "verified transaction too old");
    }

    function verifyBalanceDecreasingTransaction(
        IAttestationClient.BalanceDecreasingTransaction calldata _attestationData
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = AssetManagerState.getSettings();
        IAttestationClient attestationClient = IAttestationClient(_settings.attestationClient);
        require(attestationClient.verifyBalanceDecreasingTransaction(_settings.chainId, _attestationData),
            "transaction not proved");
        require(_confirmationCannotBeCleanedUp(_attestationData.blockTimestamp), "verified transaction too old");
    }

    function verifyConfirmedBlockHeightExists(
        IAttestationClient.ConfirmedBlockHeightExists calldata _attestationData
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = AssetManagerState.getSettings();
        IAttestationClient attestationClient = IAttestationClient(_settings.attestationClient);
        require(attestationClient.verifyConfirmedBlockHeightExists(_settings.chainId, _attestationData),
            "block height not proved");
    }

    function verifyReferencedPaymentNonexistence(
        IAttestationClient.ReferencedPaymentNonexistence calldata _attestationData
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = AssetManagerState.getSettings();
        IAttestationClient attestationClient = IAttestationClient(_settings.attestationClient);
        require(attestationClient.verifyReferencedPaymentNonexistence(_settings.chainId, _attestationData),
            "non-payment not proved");
    }

    function _confirmationCannotBeCleanedUp(uint256 timestamp) private view returns (bool) {
        return timestamp >= block.timestamp - PaymentConfirmations.VERIFICATION_CLEANUP_DAYS * 1 days;
    }
}
