// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "flare-smart-contracts-v2/contracts/userInterfaces/IFdcVerification.sol";
import "./data/AssetManagerState.sol";
import "./Globals.sol";


library TransactionAttestation {

    // payment status constants
    uint8 internal constant PAYMENT_SUCCESS = 0;
    uint8 internal constant PAYMENT_FAILED = 1;
    uint8 internal constant PAYMENT_BLOCKED = 2;

    function verifyPaymentSuccess(
        IPayment.Proof calldata _proof
    )
        internal view
    {
        require(_proof.data.responseBody.status == PAYMENT_SUCCESS, "payment failed");
        verifyPayment(_proof);
    }

    function verifyPayment(
        IPayment.Proof calldata _proof
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = Globals.getSettings();
        IFdcVerification scProofVerifier = IFdcVerification(_settings.scProofVerifier);
        require(_proof.data.sourceId == _settings.chainId, "invalid chain");
        require(scProofVerifier.verifyPayment(_proof), "legal payment not proved");
        require(_confirmationCannotBeCleanedUp(_proof.data.responseBody.blockTimestamp),
            "verified transaction too old");
    }

    function verifyBalanceDecreasingTransaction(
        IBalanceDecreasingTransaction.Proof calldata _proof
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = Globals.getSettings();
        IFdcVerification scProofVerifier = IFdcVerification(_settings.scProofVerifier);
        require(_proof.data.sourceId == _settings.chainId, "invalid chain");
        require(scProofVerifier.verifyBalanceDecreasingTransaction(_proof), "transaction not proved");
        require(_confirmationCannotBeCleanedUp(_proof.data.responseBody.blockTimestamp),
            "verified transaction too old");
    }

    function verifyConfirmedBlockHeightExists(
        IConfirmedBlockHeightExists.Proof calldata _proof
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = Globals.getSettings();
        IFdcVerification scProofVerifier = IFdcVerification(_settings.scProofVerifier);
        require(_proof.data.sourceId == _settings.chainId, "invalid chain");
        require(scProofVerifier.verifyConfirmedBlockHeightExists(_proof), "block height not proved");
    }

    function verifyReferencedPaymentNonexistence(
        IReferencedPaymentNonexistence.Proof calldata _proof
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = Globals.getSettings();
        IFdcVerification scProofVerifier = IFdcVerification(_settings.scProofVerifier);
        require(_proof.data.sourceId == _settings.chainId, "invalid chain");
        require(scProofVerifier.verifyReferencedPaymentNonexistence(_proof), "non-payment not proved");
    }

    function verifyAddressValidity(
        IAddressValidity.Proof calldata _proof
    )
        internal view
    {
        AssetManagerSettings.Data storage _settings = Globals.getSettings();
        IFdcVerification scProofVerifier = IFdcVerification(_settings.scProofVerifier);
        require(_proof.data.sourceId == _settings.chainId, "invalid chain");
        require(scProofVerifier.verifyAddressValidity(_proof), "address validity not proved");
    }

    function _confirmationCannotBeCleanedUp(uint256 timestamp) private view returns (bool) {
        return timestamp >= block.timestamp - PaymentConfirmations.VERIFICATION_CLEANUP_DAYS * 1 days;
    }
}
