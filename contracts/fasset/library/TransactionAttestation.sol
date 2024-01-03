// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../../stateConnector/interface/ISCProofVerifier.sol";
import "./data/AssetManagerState.sol";


library TransactionAttestation {

    // payment status constants
    uint8 internal constant PAYMENT_SUCCESS = 0;
    uint8 internal constant PAYMENT_FAILED = 1;
    uint8 internal constant PAYMENT_BLOCKED = 2;

    function verifyPaymentSuccess(
        Payment.Proof calldata _proof
    )
        internal view
    {
        require(_proof.data.responseBody.status == PAYMENT_SUCCESS, "payment failed");
        verifyPayment(_proof);
    }

    function verifyPayment(
        Payment.Proof calldata _proof
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = AssetManagerState.getSettings();
        ISCProofVerifier scProofVerifier = ISCProofVerifier(_settings.scProofVerifier);
        require(_proof.data.sourceId == _settings.chainId, "invalid chain");
        require(scProofVerifier.verifyPayment(_proof), "legal payment not proved");
        require(_confirmationCannotBeCleanedUp(_proof.data.responseBody.blockTimestamp),
            "verified transaction too old");
    }

    function verifyBalanceDecreasingTransaction(
        BalanceDecreasingTransaction.Proof calldata _proof
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = AssetManagerState.getSettings();
        ISCProofVerifier scProofVerifier = ISCProofVerifier(_settings.scProofVerifier);
        require(_proof.data.sourceId == _settings.chainId, "invalid chain");
        require(scProofVerifier.verifyBalanceDecreasingTransaction(_proof), "transaction not proved");
        require(_confirmationCannotBeCleanedUp(_proof.data.responseBody.blockTimestamp),
            "verified transaction too old");
    }

    function verifyConfirmedBlockHeightExists(
        ConfirmedBlockHeightExists.Proof calldata _proof
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = AssetManagerState.getSettings();
        ISCProofVerifier scProofVerifier = ISCProofVerifier(_settings.scProofVerifier);
        require(_proof.data.sourceId == _settings.chainId, "invalid chain");
        require(scProofVerifier.verifyConfirmedBlockHeightExists(_proof), "block height not proved");
    }

    function verifyReferencedPaymentNonexistence(
        ReferencedPaymentNonexistence.Proof calldata _proof
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = AssetManagerState.getSettings();
        ISCProofVerifier scProofVerifier = ISCProofVerifier(_settings.scProofVerifier);
        require(_proof.data.sourceId == _settings.chainId, "invalid chain");
        require(scProofVerifier.verifyReferencedPaymentNonexistence(_proof), "non-payment not proved");
    }

    function verifyAddressValidity(
        AddressValidity.Proof calldata _proof
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = AssetManagerState.getSettings();
        ISCProofVerifier scProofVerifier = ISCProofVerifier(_settings.scProofVerifier);
        require(_proof.data.sourceId == _settings.chainId, "invalid chain");
        require(scProofVerifier.verifyAddressValidity(_proof), "address validity not proved");
    }

    function _confirmationCannotBeCleanedUp(uint256 timestamp) private view returns (bool) {
        return timestamp >= block.timestamp - PaymentConfirmations.VERIFICATION_CLEANUP_DAYS * 1 days;
    }
}
