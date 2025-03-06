// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../governance/implementation/Governed.sol";
import "../../governance/implementation/AddressUpdatable.sol";
import "../interfaces/IICoreVaultManager.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";


//solhint-disable-next-line max-states-count
contract CoreVaultManager is Governed, AddressUpdatable, IICoreVaultManager {

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

    address public immutable assetManager;
    bytes32 public immutable chainId;
    bytes32 public immutable coreVaultAddressHash;

    string public custodianAddress;
    string public coreVaultAddress;
    uint256 public sequenceNumber;

    IFdcVerification public fdcVerification;
    mapping(bytes32 transactionId => bool) public confirmedPayments;

    bytes32[] private preimageHashes;
    Escrow[] private escrows;
    mapping(bytes32 preimageHash => uint256 escrowIndex) private preimageHashToEscrowIndex;

    uint256 public nextPreimageHashIndex;
    uint256 public nextEscrowExpiryIndex;

    uint256 public availableFunds;

    TransferRequest[] private transferRequests;
    TransferRequest[] private cancelableTransferRequests;

    string[] private allowedDestinationAddresses;
    mapping(string allowedDestinationAddress => uint256) public allowedDestinationAddressIndex;
    address[] private triggeringAccounts;
    mapping(address triggeringAccount => uint256) private triggeringAccountIndex;

    uint256 public escrowEndTimeSeconds; // h:m:s in a day (UTC)
    uint128 public escrowAmount;
    uint128 public minAvailableFunds;

    bool public paused;

    modifier onlyAssetManager() {
        require(msg.sender == assetManager, "only asset manager");
        _;
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    constructor(
        IGovernanceSettings _governanceSettings,
        address _initialGovernance,
        address _addressUpdater,
        address _assetManager,
        bytes32 _chainId,
        string memory _custodianAddress,
        string memory _coreVaultAddress,
        uint256 _initialSequenceNumber
    )
        Governed(_governanceSettings, _initialGovernance) AddressUpdatable(_addressUpdater)
    {
        require(_assetManager != address(0), "asset manager cannot be zero");
        require(_chainId != bytes32(0), "chain id cannot be zero");
        require(bytes(_custodianAddress).length > 0, "custodian address cannot be empty");
        require(bytes(_coreVaultAddress).length > 0, "core vault address cannot be empty");
        assetManager = _assetManager;
        chainId = _chainId;
        custodianAddress = _custodianAddress;
        coreVaultAddressHash = keccak256(bytes(_coreVaultAddress));
        coreVaultAddress = _coreVaultAddress;
        sequenceNumber = _initialSequenceNumber;
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function confirmPayment(
        IPayment.Proof calldata _proof
    )
        external
    {
        require(_proof.data.responseBody.status == 0, "payment failed"); // 0 = payment success
        require(_proof.data.sourceId == chainId, "invalid chain");
        require(fdcVerification.verifyPayment(_proof), "legal payment not proved");
        require(_proof.data.responseBody.receivingAddressHash == coreVaultAddressHash, "not core vault's address");
        require(_proof.data.responseBody.receivedAmount > 0, "no amount received");
        if (!confirmedPayments[_proof.data.requestBody.transactionId]) {
            uint256 receivedAmount = uint256(_proof.data.responseBody.receivedAmount);
            confirmedPayments[_proof.data.requestBody.transactionId] = true;
            availableFunds += receivedAmount;
            emit PaymentConfirmed(
                _proof.data.requestBody.transactionId,
                _proof.data.responseBody.standardPaymentReference,
                receivedAmount
            );
        }
    }

    /**
     * @inheritdoc IICoreVaultManager
     */
    function requestTransferFromCoreVault(
        string memory _destinationAddress,
        uint256 _amount,
        bytes32 _paymentReference,
        bool _cancelable
    )
        external
        onlyAssetManager notPaused
    {
        require(allowedDestinationAddressIndex[_destinationAddress] != 0, "destination address not allowed");
        TransferRequest memory transferRequest = TransferRequest({
            destinationAddress: _destinationAddress,
            amount: _amount,
            paymentReference: _paymentReference
        });
        if (_cancelable) {
            bytes32 destinationAddressHash = keccak256(bytes(_destinationAddress));
            for (uint256 i = 0; i < cancelableTransferRequests.length; i++) {
                require(
                    keccak256(bytes(cancelableTransferRequests[i].destinationAddress)) != destinationAddressHash,
                    "transfer request already exists"
                );
            }
            cancelableTransferRequests.push(transferRequest);
        } else {
            transferRequests.push(transferRequest);
        }
        emit TransferRequested(_paymentReference, _destinationAddress, _amount, _cancelable);
    }

    /**
     * @inheritdoc IICoreVaultManager
     */
    function cancelTransferRequestFromCoreVault(
        bytes32 _paymentReference
    )
        external
        onlyAssetManager
    {
        uint256 index = 0;
        while (index < cancelableTransferRequests.length) {
            if (cancelableTransferRequests[index].paymentReference == _paymentReference) {
                break;
            }
            index++;
        }
        require (index < cancelableTransferRequests.length, "transfer request not found");
        TransferRequest storage request = cancelableTransferRequests[index];
        emit TransferRequestCanceled(_paymentReference, request.destinationAddress, request.amount);

        // remove the transfer request - keep the order
        while (index < cancelableTransferRequests.length - 1) { // length > 0
            cancelableTransferRequests[index] = cancelableTransferRequests[++index]; // shift left
        }
        cancelableTransferRequests.pop(); // remove the last element
    }

    function triggerInstructions() external notPaused {
        require(triggeringAccountIndex[msg.sender] != 0, "not a triggering account");
        uint256 nextEscrowExpiryIndexTmp = nextEscrowExpiryIndex;
        uint256 availableFundsTmp = availableFunds;
        // process all expired escrows
        while (nextEscrowExpiryIndexTmp < escrows.length &&
            escrows[nextEscrowExpiryIndexTmp].expiryTs <= block.timestamp)
        {
            if (!escrows[nextEscrowExpiryIndexTmp].finished) {
                // if the escrow is not finished, add the amount to the available funds
                availableFundsTmp += escrows[nextEscrowExpiryIndexTmp].amount;
            }
            nextEscrowExpiryIndexTmp++;
        }
        // update the state
        nextEscrowExpiryIndex = nextEscrowExpiryIndexTmp;

        uint256 sequenceNumberTmp = sequenceNumber;
        // process cancelable transfer requests
        uint256 length = cancelableTransferRequests.length;
        uint256 index = 0;
        while (index < length) {
            if (availableFundsTmp >= cancelableTransferRequests[index].amount) {
                TransferRequest memory req = cancelableTransferRequests[index];
                availableFundsTmp -= req.amount;
                emit PaymentInstructions(
                    coreVaultAddress,
                    req.destinationAddress,
                    req.amount,
                    sequenceNumberTmp++,
                    req.paymentReference
                );
                // remove the transfer request - keep the order
                for (uint256 i = index; i < length - 1; i++) { // length > 0
                    cancelableTransferRequests[i] = cancelableTransferRequests[i + 1]; // shift left
                }
                cancelableTransferRequests.pop(); // remove the last element
                length--;
            } else {
                index++;
            }
        }

        // process non-cancelable transfer requests
        length = transferRequests.length;
        index = 0;
        while (index < length) {
            if (availableFundsTmp >= transferRequests[index].amount) {
                TransferRequest memory req = transferRequests[index];
                availableFundsTmp -= req.amount;
                emit PaymentInstructions(
                    coreVaultAddress,
                    req.destinationAddress,
                    req.amount,
                    sequenceNumberTmp++,
                    req.paymentReference
                );
                // remove the transfer request - keep the order
                for (uint256 i = index; i < length - 1; i++) { // length > 0
                    transferRequests[i] = transferRequests[i + 1]; // shift left
                }
                transferRequests.pop(); // remove the last element
                length--;
            } else {
                index++;
            }
        }

        // create escrows
        uint256 nextPreimageHashIndexTmp = nextPreimageHashIndex;
        uint128 escrowAmountTmp = escrowAmount;
        uint256 minFundsToTriggerEscrow = minAvailableFunds + escrowAmountTmp;
        if (availableFundsTmp >= minFundsToTriggerEscrow && nextPreimageHashIndexTmp < preimageHashes.length) {
            uint64 escrowEndTimestamp = _getNextEscrowEndTimestamp();
            while (availableFundsTmp >= minFundsToTriggerEscrow && nextPreimageHashIndexTmp < preimageHashes.length) {
                availableFundsTmp -= escrowAmountTmp;
                bytes32 preimageHash = preimageHashes[nextPreimageHashIndexTmp++];
                Escrow memory escrow = Escrow({
                    preimageHash: preimageHash,
                    amount: escrowAmountTmp,
                    expiryTs: escrowEndTimestamp,
                    finished: false
                });
                escrows.push(escrow);
                preimageHashToEscrowIndex[preimageHash] = escrows.length;
                emit EscrowInstructions(
                    preimageHash,
                    coreVaultAddress,
                    custodianAddress,
                    escrowAmountTmp,
                    sequenceNumberTmp++,
                    escrowEndTimestamp
                );
                // next escrow end timestamp
                escrowEndTimestamp += 1 days;
            }
            nextPreimageHashIndex = nextPreimageHashIndexTmp;
        }

        // update the state
        availableFunds = availableFundsTmp;
        sequenceNumber = sequenceNumberTmp;
    }

    function setAllowedDestinationAddresses(
        string[] calldata _allowedDestinationAddresses
    )
        external
        onlyGovernance
    {
        // clear the existing list
        for (uint256 i = allowedDestinationAddresses.length; i > 0; i--) {
            delete allowedDestinationAddressIndex[allowedDestinationAddresses[i - 1]];
            allowedDestinationAddresses.pop();
        }
        // add the new list
        for (uint256 i = 0; i < _allowedDestinationAddresses.length; i++) {
            require(bytes(_allowedDestinationAddresses[i]).length > 0, "destination address cannot be empty");
            allowedDestinationAddresses.push(_allowedDestinationAddresses[i]);
            allowedDestinationAddressIndex[_allowedDestinationAddresses[i]] = i + 1;
        }
    }

    function setTriggeringAccounts(
        address[] calldata _triggeringAccounts
    )
        external
        onlyGovernance
    {
        // clear the existing list
        for (uint256 i = triggeringAccounts.length; i > 0; i--) {
            delete triggeringAccountIndex[triggeringAccounts[i - 1]];
            triggeringAccounts.pop();
        }
        // add the new list
        for (uint256 i = 0; i < _triggeringAccounts.length; i++) {
            require(_triggeringAccounts[i] != address(0), "triggering account cannot be zero");
            triggeringAccounts.push(_triggeringAccounts[i]);
            triggeringAccountIndex[_triggeringAccounts[i]] = i + 1;
        }
    }

    function updateSettings(
        uint256 _escrowEndTimeSeconds,
        uint128 _escrowAmount,
        uint128 _minAvailableFunds
    )
        external onlyGovernance
    {
        require(_escrowEndTimeSeconds < 1 days, "escrow end time must be less than a day");
        require(_escrowAmount > 0, "escrow amount cannot be zero");
        escrowEndTimeSeconds = _escrowEndTimeSeconds;
        escrowAmount = _escrowAmount;
        minAvailableFunds = _minAvailableFunds;
    }

    function addPreimageHashes(bytes32[] calldata _preimageHashes) external onlyImmediateGovernance {
        for (uint256 i = 0; i < _preimageHashes.length; i++) {
            require(_preimageHashes[i] != bytes32(0), "preimage hash cannot be zero");
            preimageHashes.push(_preimageHashes[i]);
        }
    }

    function setEscrowsFinished(bytes32[] calldata _preimageHashes) external onlyImmediateGovernance {
        for (uint256 i = 0; i < _preimageHashes.length; i++) {
            uint256 escrowIndex = preimageHashToEscrowIndex[_preimageHashes[i]];
            require(escrowIndex != 0, "escrow not found");
            Escrow storage escrow = escrows[escrowIndex - 1];
            escrow.finished = true;
        }
    }

    function pause() external onlyImmediateGovernance {
        paused = true;
    }

    function unpause() external onlyImmediateGovernance {
        paused = false;
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getAllowedDestinationAddresses() external view returns (string[] memory) {
        return allowedDestinationAddresses;
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getTriggeringAccounts() external view returns (address[] memory) {
        return triggeringAccounts;
    }

    /**
     * @inheritdoc AddressUpdatable
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        fdcVerification = IFdcVerification(
            _getContractAddress(_contractNameHashes, _contractAddresses, "FdcVerification"));
    }

    function _getNextEscrowEndTimestamp() internal view returns (uint64) {
        uint256 escrowEndTimestamp = 0;
        // find the last unfinished escrow
        for (uint256 i = escrows.length; i > nextEscrowExpiryIndex; i--) {
            if (!escrows[i - 1].finished) {
                escrowEndTimestamp = escrows[i - 1].expiryTs;
                break;
            }
        }
        escrowEndTimestamp = Math.max(escrowEndTimestamp, block.timestamp);
        escrowEndTimestamp += 1 days;
        escrowEndTimestamp = escrowEndTimestamp - (escrowEndTimestamp % 1 days) + escrowEndTimeSeconds;
        if (escrowEndTimestamp <= block.timestamp + 12 hours) { // less than 12 hours from now
            escrowEndTimestamp += 1 days;
        }
        return uint64(escrowEndTimestamp);
    }
}
