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
        bytes32 paymentReference;
        uint128 amount;
    }

    // Events
    event PaymentConfirmed(
        bytes32 indexed transactionId,
        bytes32 paymentReference,
        uint256 amount
    );

    event PaymentInstructions(
        uint256 indexed sequence,
        string account,
        string destination,
        uint256 amount,
        uint256 fee,
        bytes32 paymentReference
    );

    event EscrowInstructions(
        uint256 indexed sequence,
        bytes32 indexed preimageHash,
        string account,
        string destination,
        uint256 amount,
        uint256 fee,
        uint256 cancelAfterTs
    );

    event CustomInstructions(
        uint256 indexed sequence,
        string account,
        bytes32 instructionsHash
    );

    event TransferRequested(
        string destinationAddress,
        bytes32 paymentReference,
        uint256 amount,
        bool cancelable
    );

    event TransferRequestCanceled(
        string destinationAddress,
        bytes32 paymentReference,
        uint256 amount
    );

    event NotAllEscrowsProcessed();

    event EscrowFinished(
        bytes32 indexed preimageHash,
        uint256 amount
    );

    event Paused();

    event Unpaused();

    event TriggeringAccountAdded(
        address triggeringAccount
    );

    event TriggeringAccountRemoved(
        address triggeringAccount
    );

    event AllowedDestinationAddressAdded(
        string destinationAddress
    );

    event AllowedDestinationAddressRemoved(
        string destinationAddress
    );

    event CustodianAddressUpdated(
        string custodianAddress
    );

    event SettingsUpdated(
        uint256 escrowEndTimeSeconds,
        uint256 escrowAmount,
        uint256 minimalAmount,
        uint256 fee
    );

    event PreimageHashAdded(
        bytes32 preimageHash
    );

    event UnusedPreimageHashRemoved(
        bytes32 preimageHash
    );

    event EmergencyPauseSenderAdded(
        address sender
    );

    event EmergencyPauseSenderRemoved(
        address sender
    );

    /**
     * Confirms payment to core vault address (increases available funds).
     * @param _proof payment proof
     */
    function confirmPayment(IPayment.Proof calldata _proof) external;

    /**
     * Pauses the contract. New requests and instructions cannot be triggered.
     * NOTE: may only be called by the governance or emergency pause senders.
     */
    function pause() external;

    /**
     * Trigger processing of escrows.
     * @param _maxCount Maximum number of escrows to process.
     * @return True if all escrows were processed, false otherwise.
     */
    function processEscrows(uint256 _maxCount) external returns (bool);

    /**
     * Triggers instructions - payment and escrow.
     * NOTE: cannot be called if the contract is paused.
     * NOTE: may only be called by the triggering accounts.
     */
    function triggerInstructions() external;

    /**
     * Returns the available funds.
     * @return Available funds.
     */
    function availableFunds() external view returns (uint128);

    /**
     * Returns the escrowed funds.
     * @return Escrowed funds.
     */
    function escrowedFunds() external view returns (uint128);

    /**
     * Returns the total amount requested, together with payment fee.
     */
    function totalRequestAmountWithFee() external view returns (uint256);

    /**
     * Indicates if the contract is paused. New transfer requests and instructions cannot be triggered.
     * @return True if paused, false otherwise.
     */
    function paused() external view returns (bool);

    /**
     * Gets the triggering accounts.
     * @return List of triggering accounts.
     */
    function getTriggeringAccounts() external view returns (address[] memory);


    /**
     * Returns settings.
     * @return _escrowEndTimeSeconds Escrow end time in seconds.
     * @return _escrowAmount Escrow amount.
     * @return _minimalAmount Minimal amount.
     * @return _fee Fee.
     */
    function getSettings()
        external view
        returns (
            uint128 _escrowEndTimeSeconds,
            uint128 _escrowAmount,
            uint128 _minimalAmount,
            uint128 _fee
        );

    /**
     * Gets the allowed destination addresses.
     * @return List of allowed destination addresses.
     */
    function getAllowedDestinationAddresses() external view returns (string[] memory);

    /**
     * Checks if the destination address is allowed.
     * @param _address Destination address.
     * @return True if allowed, false otherwise.
     */
    function isDestinationAddressAllowed(string memory _address) external view returns (bool);

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
     * Returns next unprocessed escrow index.
     */
    function nextUnprocessedEscrowIndex() external view returns (uint256);

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
     * Returns next unused preimage hash index.
     */
    function nextUnusedPreimageHashIndex() external view returns (uint256);

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
     * Gets the cancelable transfer requests.
     * @return List of transfer cancelable requests.
     */
    function getCancelableTransferRequests() external view returns (TransferRequest[] memory);

    /**
     * Gets the non-cancelable transfer requests.
     * @return List of transfer non-cancelable requests.
     */
    function getNonCancelableTransferRequests() external view returns (TransferRequest[] memory);

    /**
     * Gets the list of emergency pause senders.
     * @return List of emergency pause senders.
     */
    function getEmergencyPauseSenders() external view returns (address[] memory);
}
