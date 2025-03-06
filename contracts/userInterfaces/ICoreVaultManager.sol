// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "flare-smart-contracts-v2/contracts/userInterfaces/IFdcVerification.sol";

/**
 * Core vault manager
 */
interface ICoreVaultManager {

    // Structs
    struct Escrow {
        bytes32 preimageHash;
        uint128 amount;
        uint64 expiryTs;
        bool finished;
    }

    struct TransferRequest {
        string destinationAddress;
        uint256 amount;
        bytes32 paymentReference;
    }

    // Events
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

    /**
     * Gets unprocessed escrows.
     * @return List of unprocessed escrows.
     */
    function getUnprocessedEscrows() external view returns (Escrow[] memory);

    /**
     * Gets escrows count.
     * @return Escrows count.
     */
    function getEscrowsCount() external view returns (uint256);

    /**
     * Gets escrow by index.
     * @param _index Escrow index.
     * @return Escrow.
     */
    function getEscrowByIndex(uint256 _index) external view returns (Escrow memory);

    /**
     * Gets escrow by preimage hash.
     * @param _preimageHash Preimage hash.
     * @return Escrow.
     */
    function getEscrowByPreimageHash(bytes32 _preimageHash) external view returns (Escrow memory);

    /**
     * Gets unused preimage hashes.
     * @return List of unused preimage hashes.
     */
    function getUnusedPreimageHashes() external view returns (bytes32[] memory);

    /**
     * Gets preimage hashes count.
     * @return Preimage hashes count.
     */
    function getPreimageHashesCount() external view returns (uint256);

    /**
     * Gets preimage hash by index.
     * @param _index Preimage hash index.
     * @return Preimage hash.
     */
    function getPreimageHash(uint256 _index) external view returns (bytes32);

    /**
     * Gets the non-cancelable transfer requests.
     * @return List of transfer non-cancelable requests.
     */
    function getNonCancelableTransferRequests() external view returns (TransferRequest[] memory);

    /**
     * Gets the cancelable transfer requests.
     * @return List of transfer cancelable requests.
     */
    function getCancelableTransferRequests() external view returns (TransferRequest[] memory);
}
