// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../governance/implementation/GovernedProxyImplementation.sol";
import "../../governance/implementation/AddressUpdatable.sol";
import "../interfaces/IICoreVaultManager.sol";


//solhint-disable-next-line max-states-count
contract CoreVaultManager is
    UUPSUpgradeable,
    GovernedProxyImplementation,
    AddressUpdatable,
    IICoreVaultManager,
    IERC165
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /// asset manager address
    address public assetManager;
    /// chain id
    bytes32 public chainId;
    /// custodian address
    string public custodianAddress;
    /// core vault address hash
    bytes32 public coreVaultAddressHash;
    /// core vault address
    string public coreVaultAddress;
    /// next sequence number for core vault instructions
    uint256 public nextSequenceNumber;

    /// FDC verification contract
    IFdcVerification public fdcVerification;
    /// confirmed payments
    mapping(bytes32 transactionId => bool) public confirmedPayments;

    EnumerableSet.Bytes32Set private preimageHashes;
    Escrow[] private escrows;
    mapping(bytes32 preimageHash => uint256 escrowIndex) private preimageHashToEscrowIndex; // 1-based index

    /// index of a next preimage hash to be used for escrow
    uint256 public nextUnusedPreimageHashIndex;
    /// index of a next unprocessed escrow
    uint256 public nextUnprocessedEscrowIndex;

    uint256 private nextTransferRequestId;

    // NOTE: There is at most one cancelableTransferRequest per agent (an agent must cancel previous
    // return request before starting a new one). The number of agents cannot increase arbitrarily,
    // as agents that are allowed return are controlled by the governance. The total number will always be < ~10.
    // Therefore loops over cancelableTransferRequests are actually bounded and will not run out of gas.
    uint256[] private cancelableTransferRequests;

    // NOTE: The nonCancelableTransferRequests correspond to requests for direct core vault redemption.
    // The addresses to which the redemptions can be made are controlled by governance and the requests
    // to the same address get merged, so there will always be a limited number of requests (< ~10).
    // Therefore loops over nonCancelableTransferRequests are actually bounded and will not run out of gas.
    uint256[] private nonCancelableTransferRequests;

    mapping(uint256 transferRequestId => TransferRequest) private transferRequestById;

    // there will probably be no more than 10 destination addresses set in the system at any time
    string[] private allowedDestinationAddresses;
    mapping(string allowedDestinationAddress => uint256) private allowedDestinationAddressIndex; // 1-based index
    EnumerableSet.AddressSet private triggeringAccounts;
    EnumerableSet.AddressSet private emergencyPauseSenders;

    // settings
    /// escrow end time during a day in seconds (UTC time)
    uint128 private escrowEndTimeSeconds;
    /// amount to be escrowed
    uint128 private escrowAmount;
    /// minimal amount left in the core vault after escrowing
    uint128 private minimalAmount;
    /// fee
    uint128 private fee;

    /// available funds in the core vault
    uint128 public availableFunds;
    /// escrowed funds
    uint128 public escrowedFunds;
    /// cancelable transfer requests amount
    uint128 private cancelableTransferRequestsAmount;
    /// non-cancelable transfer requests amount
    uint128 private nonCancelableTransferRequestsAmount;

    /// paused state
    bool public paused;

    modifier onlyAssetManager() {
        _checkOnlyAssetManager();
        _;
    }

    modifier notPaused() {
        _checkNotPaused();
        _;
    }

    constructor()
        GovernedProxyImplementation()
        AddressUpdatable(address(0))
    {
    }

    /**
     * Proxyable initialization method. Can be called only once, from the proxy constructor
     * (single call is assured by GovernedBase.initialise).
     */
    function initialize(
        IGovernanceSettings _governanceSettings,
        address _initialGovernance,
        address _addressUpdater,
        address _assetManager,
        bytes32 _chainId,
        string memory _custodianAddress,
        string memory _coreVaultAddress,
        uint256 _nextSequenceNumber
    )
        external
    {
        require(_assetManager != address(0), "invalid address");
        require(_chainId != bytes32(0), "invalid chain");
        require(bytes(_custodianAddress).length > 0, "invalid address");
        require(bytes(_coreVaultAddress).length > 0, "invalid address");

        GovernedBase.initialise(_governanceSettings, _initialGovernance);
        AddressUpdatable.setAddressUpdaterValue(_addressUpdater);

        assetManager = _assetManager;
        chainId = _chainId;
        custodianAddress = _custodianAddress;
        coreVaultAddressHash = keccak256(bytes(_coreVaultAddress));
        coreVaultAddress = _coreVaultAddress;
        nextSequenceNumber = _nextSequenceNumber;
        emit CustodianAddressUpdated(_custodianAddress);
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
        require(fdcVerification.verifyPayment(_proof), "payment not proved");
        require(_proof.data.responseBody.receivingAddressHash == coreVaultAddressHash, "not core vault");
        require(_proof.data.responseBody.receivedAmount > 0, "invalid amount");
        if (!confirmedPayments[_proof.data.requestBody.transactionId]) {
            uint128 receivedAmount = uint128(uint256(_proof.data.responseBody.receivedAmount));
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
        bytes32 _paymentReference,
        uint128 _amount,
        bool _cancelable
    )
        external
        onlyAssetManager notPaused
        returns (bytes32)
    {
        require(_amount > 0, "amount zero");
        require(allowedDestinationAddressIndex[_destinationAddress] != 0, "destination not allowed");
        bytes32 destinationAddressHash = keccak256(bytes(_destinationAddress));
        bool newTransferRequest = false;
        if (_cancelable) {
            // only one cancelable request per destination address
            for (uint256 i = 0; i < cancelableTransferRequests.length; i++) {
                TransferRequest storage req = transferRequestById[cancelableTransferRequests[i]];
                require(keccak256(bytes(req.destinationAddress)) != destinationAddressHash, "request already exists");
            }
            cancelableTransferRequestsAmount += _amount;
            cancelableTransferRequests.push(nextTransferRequestId);
            newTransferRequest = true;
        } else {
            uint256 index = 0;
            while (index < nonCancelableTransferRequests.length) {
                TransferRequest storage req = transferRequestById[nonCancelableTransferRequests[index]];
                if (keccak256(bytes(req.destinationAddress)) == destinationAddressHash) {
                    // add the amount to the existing request
                    req.amount += _amount;
                    _paymentReference = req.paymentReference;   // use the old payment reference when merged
                    break;
                }
                index++;
            }
            nonCancelableTransferRequestsAmount += _amount;
            // if the request does not exist, add a new one
            if (index == nonCancelableTransferRequests.length) {
                nonCancelableTransferRequests.push(nextTransferRequestId);
                newTransferRequest = true;
            }
        }

        uint256 requestsAmount = totalRequestAmountWithFee();
        require(requestsAmount <= availableFunds + escrowedFunds, "insufficient funds");

        if (newTransferRequest) {
            transferRequestById[nextTransferRequestId++] = TransferRequest({
                destinationAddress: _destinationAddress,
                paymentReference: _paymentReference,
                amount: _amount
            });
        }
        emit TransferRequested(_destinationAddress, _paymentReference, _amount, _cancelable);
        return _paymentReference;
    }

    /**
     * @inheritdoc IICoreVaultManager
     */
    function cancelTransferRequestFromCoreVault(
        string memory _destinationAddress
    )
        external
        onlyAssetManager
    {
        bytes32 destinationAddressHash = keccak256(bytes(_destinationAddress));
        uint256 index = 0;
        while (index < cancelableTransferRequests.length) {
            string memory destAddress = transferRequestById[cancelableTransferRequests[index]].destinationAddress;
            if (keccak256(bytes(destAddress)) == destinationAddressHash) {
                break;
            }
            index++;
        }
        require (index < cancelableTransferRequests.length, "not found");
        uint256 transferRequestId = cancelableTransferRequests[index];
        TransferRequest storage req = transferRequestById[transferRequestId];
        uint128 amount = req.amount;
        cancelableTransferRequestsAmount -= amount;
        emit TransferRequestCanceled(_destinationAddress, req.paymentReference, amount);

        // remove the transfer request - keep the order
        while (index < cancelableTransferRequests.length - 1) { // length > 0
            cancelableTransferRequests[index] = cancelableTransferRequests[index + 1]; // shift left
            index++;
        }
        cancelableTransferRequests.pop(); // remove the last element
        delete transferRequestById[transferRequestId];
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function processEscrows(uint256 _maxCount) external returns (bool) {
        return _processEscrows(_maxCount);
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function triggerInstructions() external notPaused returns (uint256 _numberOfInstructions) {
        require(triggeringAccounts.contains(msg.sender), "not authorized");
        _processEscrows(type(uint256).max); // process all escrows
        uint128 availableFundsTmp = availableFunds;
        uint256 sequenceNumberTmp = nextSequenceNumber;

        // process cancelable transfer requests
        uint128 feeTmp = fee;
        require(feeTmp > 0, "fee zero");
        uint256 index = 0;
        uint256 length = cancelableTransferRequests.length;
        uint128 amountTmp = cancelableTransferRequestsAmount;
        while (index < length) {
            uint256 transferRequestId = cancelableTransferRequests[index];
            if (availableFundsTmp >= transferRequestById[transferRequestId].amount + feeTmp) {
                TransferRequest memory req = transferRequestById[transferRequestId];
                availableFundsTmp -= (req.amount + feeTmp);
                amountTmp -= req.amount;
                emit PaymentInstructions(
                    sequenceNumberTmp++,
                    coreVaultAddress,
                    req.destinationAddress,
                    req.amount,
                    feeTmp,
                    req.paymentReference
                );
                _numberOfInstructions++;
                // remove the transfer request - keep the order
                for (uint256 i = index; i < length - 1; i++) { // length > 0
                    cancelableTransferRequests[i] = cancelableTransferRequests[i + 1]; // shift left
                }
                cancelableTransferRequests.pop(); // remove the last element
                delete transferRequestById[transferRequestId];
                length--;
            } else {
                index++;
            }
        }
        cancelableTransferRequestsAmount = amountTmp;

        // process non-cancelable transfer requests
        index = 0;
        length = nonCancelableTransferRequests.length;
        amountTmp = nonCancelableTransferRequestsAmount;
        while (index < length) {
            uint256 transferRequestId = nonCancelableTransferRequests[index];
            if (availableFundsTmp >= transferRequestById[transferRequestId].amount + feeTmp) {
                TransferRequest memory req = transferRequestById[transferRequestId];
                availableFundsTmp -= (req.amount + feeTmp);
                amountTmp -= req.amount;
                emit PaymentInstructions(
                    sequenceNumberTmp++,
                    coreVaultAddress,
                    req.destinationAddress,
                    req.amount,
                    feeTmp,
                    req.paymentReference
                );
                _numberOfInstructions++;
                // remove the transfer request - keep the order
                for (uint256 i = index; i < length - 1; i++) { // length > 0
                    nonCancelableTransferRequests[i] = nonCancelableTransferRequests[i + 1]; // shift left
                }
                nonCancelableTransferRequests.pop(); // remove the last element
                delete transferRequestById[transferRequestId];
                length--;
            } else {
                index++;
            }
        }
        nonCancelableTransferRequestsAmount = amountTmp;

        uint128 escrowAmountTmp = escrowAmount;
        if (escrowAmountTmp == 0 || length > 0 || cancelableTransferRequests.length > 0) {
            // update the state but skip creating new escrows
            availableFunds = availableFundsTmp;
            nextSequenceNumber = sequenceNumberTmp;
            return _numberOfInstructions;
        }

        // create escrows
        uint256 preimageHashIndexTmp = nextUnusedPreimageHashIndex;
        uint256 minFundsToTriggerEscrow = minimalAmount + escrowAmountTmp + feeTmp;
        length = preimageHashes.length();
        amountTmp = escrowedFunds;
        if (availableFundsTmp >= minFundsToTriggerEscrow && preimageHashIndexTmp < length) {
            uint64 escrowEndTimestamp = _getNextEscrowEndTimestamp();
            while (availableFundsTmp >= minFundsToTriggerEscrow && preimageHashIndexTmp < length) {
                availableFundsTmp -= (escrowAmountTmp + feeTmp);
                amountTmp += escrowAmountTmp;
                bytes32 preimageHash = preimageHashes.at(preimageHashIndexTmp++);
                Escrow memory escrow = Escrow({
                    preimageHash: preimageHash,
                    amount: escrowAmountTmp,
                    expiryTs: escrowEndTimestamp,
                    finished: false
                });
                escrows.push(escrow);
                preimageHashToEscrowIndex[preimageHash] = escrows.length;
                emit EscrowInstructions(
                    sequenceNumberTmp++,
                    preimageHash,
                    coreVaultAddress,
                    custodianAddress,
                    escrowAmountTmp,
                    feeTmp,
                    escrowEndTimestamp
                );
                _numberOfInstructions++;
                // next escrow end timestamp
                escrowEndTimestamp += 1 days;
            }
            nextUnusedPreimageHashIndex = preimageHashIndexTmp;
        }

        // update the state
        availableFunds = availableFundsTmp;
        nextSequenceNumber = sequenceNumberTmp;
        escrowedFunds = amountTmp;
    }

    /**
     * Adds allowed destination addresses.
     * @param _allowedDestinationAddresses List of allowed destination addresses to add.
     * NOTE: may only be called by the governance.
     */
    function addAllowedDestinationAddresses(
        string[] calldata _allowedDestinationAddresses
    )
        external
        onlyGovernance
    {
        for (uint256 i = 0; i < _allowedDestinationAddresses.length; i++) {
            require(bytes(_allowedDestinationAddresses[i]).length > 0, "invalid address");
            if (allowedDestinationAddressIndex[_allowedDestinationAddresses[i]] != 0) {
                continue;
            }
            allowedDestinationAddresses.push(_allowedDestinationAddresses[i]);
            allowedDestinationAddressIndex[_allowedDestinationAddresses[i]] = allowedDestinationAddresses.length;
            emit AllowedDestinationAddressAdded(_allowedDestinationAddresses[i]);
        }
    }

    /**
     * Removes allowed destination addresses.
     * @param _allowedDestinationAddresses List of allowed destination addresses to remove.
     * NOTE: may only be called by the governance.
     */
    function removeAllowedDestinationAddresses(
        string[] calldata _allowedDestinationAddresses
    )
        external
        onlyGovernance
    {
        for (uint256 i = 0; i < _allowedDestinationAddresses.length; i++) {
            uint256 index = allowedDestinationAddressIndex[_allowedDestinationAddresses[i]];
            if (index == 0) {
                continue;
            }
            uint256 length = allowedDestinationAddresses.length;
            if (index < length) {
                string memory addressToMove = allowedDestinationAddresses[length - 1];
                allowedDestinationAddresses[index - 1] = addressToMove;
                allowedDestinationAddressIndex[addressToMove] = index;
            }
            allowedDestinationAddresses.pop();
            delete allowedDestinationAddressIndex[_allowedDestinationAddresses[i]];
            emit AllowedDestinationAddressRemoved(_allowedDestinationAddresses[i]);
        }
    }

    /**
     * Adds the triggering accounts.
     * @param _triggeringAccounts List of triggering accounts to add.
     * NOTE: may only be called by the governance.
     */
    function addTriggeringAccounts(
        address[] calldata _triggeringAccounts
    )
        external
        onlyGovernance
    {
        for (uint256 i = 0; i < _triggeringAccounts.length; i++) {
            if (triggeringAccounts.add(_triggeringAccounts[i])) {
                emit TriggeringAccountAdded(_triggeringAccounts[i]);
            }
        }
    }

    /**
     * Removes the triggering accounts.
     * @param _triggeringAccounts List of triggering accounts to remove.
     * NOTE: may only be called by the governance.
     */
    function removeTriggeringAccounts(
        address[] calldata _triggeringAccounts
    )
        external
        onlyGovernance
    {
        for (uint256 i = 0; i < _triggeringAccounts.length; i++) {
            if (triggeringAccounts.remove(_triggeringAccounts[i])) {
                emit TriggeringAccountRemoved(_triggeringAccounts[i]);
            }
        }
    }

    /**
     * Updates the custodian address.
     * @param _custodianAddress Custodian address.
     * NOTE: may only be called by the governance.
     */
    function updateCustodianAddress(
        string calldata _custodianAddress
    )
        external
        onlyGovernance
    {
        require(bytes(_custodianAddress).length > 0, "invalid address");
        custodianAddress = _custodianAddress;
        emit CustodianAddressUpdated(_custodianAddress);
    }

    /**
     * Updates the settings.
     * @param _escrowEndTimeSeconds Escrow end time in seconds.
     * @param _escrowAmount Escrow amount (setting to 0 will disable escrows).
     * @param _minimalAmount Minimal amount left in the core vault after escrow.
     * @param _fee Fee.
     * NOTE: may only be called by the governance.
     */
    function updateSettings(
        uint128 _escrowEndTimeSeconds,
        uint128 _escrowAmount,
        uint128 _minimalAmount,
        uint128 _fee
    )
        external
        onlyGovernance
    {
        require(_escrowEndTimeSeconds < 1 days, "invalid end time");
        require(_fee > 0, "fee zero");
        escrowEndTimeSeconds = _escrowEndTimeSeconds;
        escrowAmount = _escrowAmount;
        minimalAmount = _minimalAmount;
        fee = _fee;
        emit SettingsUpdated(_escrowEndTimeSeconds, _escrowAmount, _minimalAmount, _fee);
    }

    /**
     * Adds preimage hashes.
     * @param _preimageHashes List of preimage hashes.
     * NOTE: may only be called by the governance.
     */
    function addPreimageHashes(
        bytes32[] calldata _preimageHashes
    )
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _preimageHashes.length; i++) {
            require(_preimageHashes[i] != bytes32(0) && preimageHashes.add(_preimageHashes[i]),
                "invalid preimage hash");
            emit PreimageHashAdded(_preimageHashes[i]);
        }
    }

    /**
     * Remove last unused preimage hashes.
     * @param _maxCount Maximum number of preimage hashes to remove.
     * NOTE: may only be called by the governance.
     */
    function removeUnusedPreimageHashes(
        uint256 _maxCount
    )
        external
        onlyImmediateGovernance
    {
        uint256 index = preimageHashes.length();
        while (_maxCount > 0 && index > nextUnusedPreimageHashIndex) {
            bytes32 preimageHash = preimageHashes.at(--index);
            preimageHashes.remove(preimageHash);
            _maxCount--;
            emit UnusedPreimageHashRemoved(preimageHash);
        }
    }

    /**
     * Sets escrows as finished.
     * @param _preimageHashes List of preimage hashes.
     * NOTE: may only be called by the governance.
     */
    function setEscrowsFinished(
        bytes32[] calldata _preimageHashes
    )
        external
        onlyImmediateGovernance
    {
        uint128 availableFundsTmp = availableFunds;
        uint128 escrowedFundsTmp = escrowedFunds;
        for (uint256 i = 0; i < _preimageHashes.length; i++) {
            uint256 escrowIndex = preimageHashToEscrowIndex[_preimageHashes[i]];
            Escrow storage escrow = _getEscrow(escrowIndex);
            require(!escrow.finished, "already finished");
            escrow.finished = true;
            if (escrowIndex <= nextUnprocessedEscrowIndex) {
                availableFundsTmp -= escrow.amount;
            } else {
                escrowedFundsTmp -= escrow.amount;
            }
            emit EscrowFinished(_preimageHashes[i], escrow.amount);
        }
        availableFunds = availableFundsTmp;
        escrowedFunds = escrowedFundsTmp;
    }

    /**
     * Adds emergency pause senders.
     * @param _addresses List of emergency pause senders to add.
     * NOTE: may only be called by the governance.
     */
    function addEmergencyPauseSenders(address[] calldata _addresses)
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _addresses.length; i++) {
            if(emergencyPauseSenders.add(_addresses[i])) {
                emit EmergencyPauseSenderAdded(_addresses[i]);
            }
        }
    }

    /**
     * Removes emergency pause senders.
     * @param _addresses List of emergency pause senders to remove.
     * NOTE: may only be called by the governance.
     */
    function removeEmergencyPauseSenders(address[] calldata _addresses)
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _addresses.length; i++) {
            if (emergencyPauseSenders.remove(_addresses[i])) {
                emit EmergencyPauseSenderRemoved(_addresses[i]);
            }
        }
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function pause() external {
        require(msg.sender == governance() || emergencyPauseSenders.contains(msg.sender), "not authorized");
        paused = true;
        emit Paused();
    }

    /**
     * Unpauses the contract. New transfer requests and instructions can be triggered.
     * NOTE: may only be called by the governance.
     */
    function unpause() external onlyImmediateGovernance {
        paused = false;
        emit Unpaused();
    }

    /**
     * Triggers custom instructions, which are not related to payment or escrow but increases the sequence number.
     * @param _instructionsHash Hash of the instructions send off-chain.
     * NOTE: may only be called by the governance.
     */
    function triggerCustomInstructions(bytes32 _instructionsHash) external onlyImmediateGovernance {
        emit CustomInstructions(
            nextSequenceNumber++,
            coreVaultAddress,
            _instructionsHash
        );
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getSettings()
        external view
        returns (
            uint128 _escrowEndTimeSeconds,
            uint128 _escrowAmount,
            uint128 _minimalAmount,
            uint128 _fee
        )
    {
        return (escrowEndTimeSeconds, escrowAmount, minimalAmount, fee);
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
    function isDestinationAddressAllowed(string memory _address) external view returns (bool) {
        return allowedDestinationAddressIndex[_address] > 0;
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getTriggeringAccounts() external view returns (address[] memory) {
        return triggeringAccounts.values();
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getUnprocessedEscrows() external view returns (Escrow[] memory _unprocessedEscrows) {
        uint256 length = escrows.length - nextUnprocessedEscrowIndex;
        _unprocessedEscrows = new Escrow[](length);
        for (uint256 i = 0; i < length; i++) {
            _unprocessedEscrows[i] = escrows[nextUnprocessedEscrowIndex + i];
        }
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getEscrowsCount() external view returns (uint256) {
        return escrows.length;
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getEscrowByIndex(uint256 _index) external view returns (Escrow memory) {
        return escrows[_index];
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getEscrowByPreimageHash(bytes32 _preimageHash) external view returns (Escrow memory) {
        uint256 index = preimageHashToEscrowIndex[_preimageHash];
        return _getEscrow(index);
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getUnusedPreimageHashes() external view returns (bytes32[] memory) {
        uint256 length = preimageHashes.length() - nextUnusedPreimageHashIndex;
        bytes32[] memory unusedPreimageHashes = new bytes32[](length);
        for (uint256 i = 0; i < length; i++) {
            unusedPreimageHashes[i] = preimageHashes.at(nextUnusedPreimageHashIndex + i);
        }
        return unusedPreimageHashes;
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getPreimageHashesCount() external view returns (uint256) {
        return preimageHashes.length();
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getPreimageHash(uint256 _index) external view returns (bytes32) {
        return preimageHashes.at(_index);
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getCancelableTransferRequests() external view returns (TransferRequest[] memory _transferRequests) {
        _transferRequests = new TransferRequest[](cancelableTransferRequests.length);
        for (uint256 i = 0; i < cancelableTransferRequests.length; i++) {
            _transferRequests[i] = transferRequestById[cancelableTransferRequests[i]];
        }
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getNonCancelableTransferRequests() external view returns (TransferRequest[] memory _transferRequests) {
        _transferRequests = new TransferRequest[](nonCancelableTransferRequests.length);
        for (uint256 i = 0; i < nonCancelableTransferRequests.length; i++) {
            _transferRequests[i] = transferRequestById[nonCancelableTransferRequests[i]];
        }
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function totalRequestAmountWithFee() public view returns (uint256) {
        return nonCancelableTransferRequestsAmount + cancelableTransferRequestsAmount +
            (cancelableTransferRequests.length + nonCancelableTransferRequests.length) * fee;
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getEmergencyPauseSenders() external view returns (address[] memory) {
        return emergencyPauseSenders.values();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // ERC 165

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IIAddressUpdatable).interfaceId
            || _interfaceId == type(IICoreVaultManager).interfaceId;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // UUPS Proxy

    /**
     * See UUPSUpgradeable.upgradeTo
     */
    function upgradeTo(address newImplementation)
        public override
        onlyGovernance
        onlyProxy
    {
        _upgradeToAndCallUUPS(newImplementation, new bytes(0), false);
    }

    /**
     * See UUPSUpgradeable.upgradeToAndCall
     */
    function upgradeToAndCall(address newImplementation, bytes memory data)
        public payable override
        onlyGovernance
        onlyProxy
    {
        _upgradeToAndCallUUPS(newImplementation, data, true);
    }

    /**
     * Unused. just to present to satisfy UUPSUpgradeable requirement.
     * The real check is in onlyGovernance modifier on upgradeTo and upgradeToAndCall.
     */
    function _authorizeUpgrade(address newImplementation) internal override {}

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

    /**
     * Processes the escrows.
     * @param _maxCount Maximum number of escrows to process.
     * @return _allProcessed True if all escrows were processed, false otherwise.
     */
    function _processEscrows(uint256 _maxCount) internal returns (bool _allProcessed) {
        uint128 availableFundsTmp = availableFunds;
        uint128 escrowedFundsTmp = escrowedFunds;
        // process all expired or finished escrows
        uint256 index = nextUnprocessedEscrowIndex;
        while (_maxCount > 0 && index < escrows.length &&
            (escrows[index].expiryTs <= block.timestamp || escrows[index].finished))
        {
            if (!escrows[index].finished) {
                // if the escrow is not finished, add the amount to the available funds
                uint128 amount = escrows[index].amount;
                availableFundsTmp += amount;
                escrowedFundsTmp -= amount;
            }
            index++;
            _maxCount--;
        }
        // update the state
        nextUnprocessedEscrowIndex = index;
        availableFunds = availableFundsTmp;
        escrowedFunds = escrowedFundsTmp;

        _allProcessed = _maxCount > 0 || index == escrows.length ||
            (escrows[index].expiryTs > block.timestamp && !escrows[index].finished);
        if (!_allProcessed) {
            emit NotAllEscrowsProcessed();
        }
    }

    /**
     * Gets the escrow by index.
     * @param _index Escrow index (1-based).
     * @return Escrow.
     */
    function _getEscrow(uint256 _index) internal view returns (Escrow storage) {
        require(_index != 0, "not found");
        return escrows[_index - 1];
    }

    /**
     * Gets the next escrow end timestamp.
     * @return Next escrow end timestamp.
     */
    function _getNextEscrowEndTimestamp() internal view returns (uint64) {
        uint256 escrowEndTimestamp = 0;
        // find the last unfinished escrow
        for (uint256 i = escrows.length; i > nextUnprocessedEscrowIndex; i--) {
            if (!escrows[i - 1].finished) {
                escrowEndTimestamp = escrows[i - 1].expiryTs;
                break;
            }
        }
        escrowEndTimestamp = Math.max(escrowEndTimestamp, block.timestamp);
        escrowEndTimestamp += 1 days;
        // slither-disable-next-line weak-prng
        escrowEndTimestamp = escrowEndTimestamp - (escrowEndTimestamp % 1 days) + escrowEndTimeSeconds;
        if (escrowEndTimestamp <= block.timestamp + 12 hours) { // less than 12 hours from now, move to the next day
            escrowEndTimestamp += 1 days;
        }
        return uint64(escrowEndTimestamp);
    }

    /**
     * Checks if the caller is the asset manager.
     */
    function _checkOnlyAssetManager() internal view {
        require(msg.sender == assetManager, "only asset manager");
    }

    /**
     * Checks if the contract is not paused.
     */
    function _checkNotPaused() internal view {
        require(!paused, "paused");
    }
}
