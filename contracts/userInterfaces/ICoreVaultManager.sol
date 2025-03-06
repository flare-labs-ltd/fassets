// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "flare-smart-contracts-v2/contracts/userInterfaces/IFdcVerification.sol";

/**
 * Core vault manager
 */
interface ICoreVaultManager {

    event PaymentConfirmed(
        bytes32 indexed transactionId,
        bytes32 indexed paymentReference,
        uint256 amount
    );

    event PaymentInstructions(
        string account,
        string destination,
        uint256 amount,
        uint256 sequence,
        bytes32 paymentReference
    );

    event EscrowInstructions(
        bytes32 indexed preimageHash,
        string account,
        string destination,
        uint256 amount,
        uint256 sequence,
        uint256 cancelAfterTs
    );

    /**
     * Confirms payment to core vault address (increases available funds).
     * @param _proof payment proof
     */
    function confirmPayment(IPayment.Proof calldata _proof) external;

    /**
     * Triggers instructions - payment and escrow.
     * NOTE: may only be called by the triggering accounts.
     */
    function triggerInstructions() external;

    /**
     * Gets the triggering accounts.
     * @return List of triggering accounts.
     */
    function getTriggeringAccounts() external view returns (address[] memory);

    /**
     * Gets the allowed destination addresses.
     * @return List of allowed destination addresses.
     */
    function getAllowedDestinationAddresses() external view returns (string[] memory);

    /**
     * Gets the core vault address.
     * @return Core vault address.
     */
    function coreVaultAddress() external view returns (string memory);

    /**
     * Gets the core vault address hash.
     * @return Core vault address hash.
     */
    function coreVaultAddressHash() external view returns (bytes32);

    /**
     * Gets the custodian address.
     * @return Custodian address.
     */
    function custodianAddress() external view returns (string memory);
}
