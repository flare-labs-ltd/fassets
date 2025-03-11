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

    bytes32[] private preimageHashes;
    Escrow[] private escrows;
    mapping(bytes32 preimageHash => uint256 escrowIndex) private preimageHashToEscrowIndex;

    /// index of a next preimage hash to be used for escrow
    uint256 public nextUnusedPreimageHashIndex;
    /// index of a next unprocessed escrow
    uint256 public nextUnprocessedEscrowIndex;

    uint256 private nextTransferRequestId;
    uint256[] private nonCancelableTransferRequests;
    uint256[] private cancelableTransferRequests;
    mapping(uint256 transferRequestId => TransferRequest) private transferRequestById;

    string[] private allowedDestinationAddresses;
    mapping(string allowedDestinationAddress => uint256) private allowedDestinationAddressIndex;
    EnumerableSet.AddressSet private triggeringAccounts;
    EnumerableSet.AddressSet private emergencyPauseSenders;

    /// escrow end time during a day in seconds (UTC time)
    uint256 public escrowEndTimeSeconds;
    /// amount to be escrowed
    uint128 public escrowAmount;
    /// minimal amount left in the core vault after escrowing
    uint128 public minimalAmount;
    /// available funds in the core vault
    uint128 public availableFunds;
    /// escrowed funds
    uint128 public escrowedFunds;
    /// paused state
    bool public paused;

    modifier onlyAssetManager() {
        require(msg.sender == assetManager, "only asset manager");
        _;
    }

    modifier notPaused() {
        require(!paused, "paused");
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
        require(_assetManager != address(0), "asset manager cannot be zero");
        require(_chainId != bytes32(0), "chain id cannot be zero");
        require(bytes(_custodianAddress).length > 0, "custodian address cannot be empty");
        require(bytes(_coreVaultAddress).length > 0, "core vault address cannot be empty");

        GovernedBase.initialise(_governanceSettings, _initialGovernance);
        AddressUpdatable.setAddressUpdaterValue(_addressUpdater);

        assetManager = _assetManager;
        chainId = _chainId;
        custodianAddress = _custodianAddress;
        coreVaultAddressHash = keccak256(bytes(_coreVaultAddress));
        coreVaultAddress = _coreVaultAddress;
        nextSequenceNumber = _nextSequenceNumber;
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
            uint128 receivedAmount = uint128(uint256(_proof.data.responseBody.receivedAmount));
            confirmedPayments[_proof.data.requestBody.transactionId] = true;
            availableFunds += receivedAmount;
            emit PaymentConfirmed(
                _proof.data.requestBody.transactionId,
                receivedAmount
            );
        }
    }

    /**
     * @inheritdoc IICoreVaultManager
     */
    function requestTransferFromCoreVault(
        string memory _destinationAddress,
        uint128 _amount,
        bool _cancelable
    )
        external
        onlyAssetManager notPaused
    {
        require(allowedDestinationAddressIndex[_destinationAddress] != 0, "destination address not allowed");
        bytes32 destinationAddressHash = keccak256(bytes(_destinationAddress));
        bool newTransferRequest = false;
        if (_cancelable) {
            // only one cancelable request per destination address
            for (uint256 i = 0; i < cancelableTransferRequests.length; i++) {
                TransferRequest storage req = transferRequestById[cancelableTransferRequests[i]];
                require(
                    keccak256(bytes(req.destinationAddress)) != destinationAddressHash,
                    "transfer request already exists"
                );
            }
            cancelableTransferRequests.push(nextTransferRequestId);
            newTransferRequest = true;
        } else {
            uint256 index = 0;
            while (index < nonCancelableTransferRequests.length) {
                TransferRequest storage req = transferRequestById[nonCancelableTransferRequests[index]];
                if (keccak256(bytes(req.destinationAddress)) == destinationAddressHash) {
                    // add the amount to the existing request
                    req.amount += _amount;
                    break;
                }
                index++;
            }
            // if the request does not exist, add a new one
            if (index == nonCancelableTransferRequests.length) {
                nonCancelableTransferRequests.push(nextTransferRequestId);
                newTransferRequest = true;
            }
        }
        if (newTransferRequest) {
            transferRequestById[nextTransferRequestId++] = TransferRequest({
                destinationAddress: _destinationAddress,
                amount: _amount
            });
        }
        emit TransferRequested(_destinationAddress, _amount, _cancelable);
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
            TransferRequest storage req = transferRequestById[cancelableTransferRequests[index]];
            if (keccak256(bytes(req.destinationAddress)) == destinationAddressHash) {
                break;
            }
            index++;
        }
        require (index < cancelableTransferRequests.length, "transfer request not found");
        uint256 transferRequestId = cancelableTransferRequests[index];
        emit TransferRequestCanceled(_destinationAddress,  transferRequestById[transferRequestId].amount);

        // remove the transfer request - keep the order
        while (index < cancelableTransferRequests.length - 1) { // length > 0
            cancelableTransferRequests[index] = cancelableTransferRequests[++index]; // shift left
        }
        cancelableTransferRequests.pop(); // remove the last element
        delete transferRequestById[transferRequestId];
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function triggerInstructions() external notPaused {
        require(triggeringAccounts.contains(msg.sender), "not a triggering account");
        uint256 nextUnprocessedEscrowIndexTmp = nextUnprocessedEscrowIndex;
        uint128 availableFundsTmp = availableFunds;
        uint128 escrowedFundsTmp = escrowedFunds;
        // process all expired escrows
        while (nextUnprocessedEscrowIndexTmp < escrows.length &&
            escrows[nextUnprocessedEscrowIndexTmp].expiryTs <= block.timestamp)
        {
            if (!escrows[nextUnprocessedEscrowIndexTmp].finished) {
                // if the escrow is not finished, add the amount to the available funds
                uint128 amount = escrows[nextUnprocessedEscrowIndexTmp].amount;
                availableFundsTmp += amount;
                escrowedFundsTmp -= amount;
            }
            nextUnprocessedEscrowIndexTmp++;
        }
        // update the state
        nextUnprocessedEscrowIndex = nextUnprocessedEscrowIndexTmp;

        uint256 sequenceNumberTmp = nextSequenceNumber;
        // process cancelable transfer requests
        uint256 length = cancelableTransferRequests.length;
        uint256 index = 0;
        while (index < length) {
            uint256 transferRequestId = cancelableTransferRequests[index];
            if (availableFundsTmp >= transferRequestById[transferRequestId].amount) {
                TransferRequest memory req = transferRequestById[transferRequestId];
                availableFundsTmp -= req.amount;
                emit PaymentInstructions(
                    sequenceNumberTmp++,
                    coreVaultAddress,
                    req.destinationAddress,
                    req.amount
                );
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

        // process non-cancelable transfer requests
        length = nonCancelableTransferRequests.length;
        index = 0;
        while (index < length) {
            uint256 transferRequestId = nonCancelableTransferRequests[index];
            if (availableFundsTmp >= transferRequestById[transferRequestId].amount) {
                TransferRequest memory req = transferRequestById[transferRequestId];
                availableFundsTmp -= req.amount;
                emit PaymentInstructions(
                    sequenceNumberTmp++,
                    coreVaultAddress,
                    req.destinationAddress,
                    req.amount
                );
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

        uint128 escrowAmountTmp = escrowAmount;
        if (escrowAmountTmp == 0 || length > 0 || cancelableTransferRequests.length > 0) {
            // update the state
            availableFunds = availableFundsTmp;
            escrowedFunds = escrowedFundsTmp;
            nextSequenceNumber = sequenceNumberTmp;
            return;
        }

        // create escrows
        uint256 preimageHashIndexTmp = nextUnusedPreimageHashIndex;
        uint256 minFundsToTriggerEscrow = minimalAmount + escrowAmountTmp;
        if (availableFundsTmp >= minFundsToTriggerEscrow && preimageHashIndexTmp < preimageHashes.length) {
            uint64 escrowEndTimestamp = _getNextEscrowEndTimestamp();
            while (availableFundsTmp >= minFundsToTriggerEscrow && preimageHashIndexTmp < preimageHashes.length) {
                availableFundsTmp -= escrowAmountTmp;
                escrowedFundsTmp += escrowAmountTmp;
                bytes32 preimageHash = preimageHashes[preimageHashIndexTmp++];
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
                    escrowEndTimestamp
                );
                // next escrow end timestamp
                escrowEndTimestamp += 1 days;
            }
            nextUnusedPreimageHashIndex = preimageHashIndexTmp;
        }

        // update the state
        availableFunds = availableFundsTmp;
        escrowedFunds = escrowedFundsTmp;
        nextSequenceNumber = sequenceNumberTmp;
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
            require(bytes(_allowedDestinationAddresses[i]).length > 0, "destination address cannot be empty");
            if (allowedDestinationAddressIndex[_allowedDestinationAddresses[i]] != 0) {
                continue;
            }
            allowedDestinationAddresses.push(_allowedDestinationAddresses[i]);
            allowedDestinationAddressIndex[_allowedDestinationAddresses[i]] = allowedDestinationAddresses.length;
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
            triggeringAccounts.add(_triggeringAccounts[i]);
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
            triggeringAccounts.remove(_triggeringAccounts[i]);
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
        require(bytes(_custodianAddress).length > 0, "custodian address cannot be empty");
        custodianAddress = _custodianAddress;
    }

    /**
     * Updates the settings.
     * @param _escrowEndTimeSeconds Escrow end time in seconds.
     * @param _escrowAmount Escrow amount (setting to 0 will disable escrows).
     * @param _minimalAmount Minimal amount left in the core vault after escrow.
     * NOTE: may only be called by the governance.
     */
    function updateSettings(
        uint256 _escrowEndTimeSeconds,
        uint128 _escrowAmount,
        uint128 _minimalAmount
    )
        external
        onlyGovernance
    {
        require(_escrowEndTimeSeconds < 1 days, "escrow end time must be less than a day");
        escrowEndTimeSeconds = _escrowEndTimeSeconds;
        escrowAmount = _escrowAmount;
        minimalAmount = _minimalAmount;
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
            require(_preimageHashes[i] != bytes32(0), "preimage hash cannot be zero");
            preimageHashes.push(_preimageHashes[i]);
        }
    }

    /**
     * Replaces unused preimage hashes.
     * @param _preimageHashes List of preimage hashes.
     * NOTE: may only be called by the governance.
     */
    function replaceUnusedPreimageHashes(
        bytes32[] calldata _preimageHashes
    )
        external
        onlyImmediateGovernance
    {
        for (uint256 i = preimageHashes.length; i > nextUnusedPreimageHashIndex; i--) {
            preimageHashes.pop();
        }
        for (uint256 i = 0; i < _preimageHashes.length; i++) {
            require(_preimageHashes[i] != bytes32(0), "preimage hash cannot be zero");
            preimageHashes.push(_preimageHashes[i]);
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
        for (uint256 i = 0; i < _preimageHashes.length; i++) {
            uint256 escrowIndex = preimageHashToEscrowIndex[_preimageHashes[i]];
            require(escrowIndex != 0, "escrow not found");
            Escrow storage escrow = escrows[escrowIndex - 1];
            require(!escrow.finished, "escrow already finished");
            escrow.finished = true;
            if (escrowIndex <= nextUnprocessedEscrowIndex) {
                availableFunds -= escrow.amount;
            } else {
                escrowedFunds -= escrow.amount;
            }
            emit EscrowFinished(_preimageHashes[i], escrow.amount);
        }
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
            emergencyPauseSenders.add(_addresses[i]);
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
            emergencyPauseSenders.remove(_addresses[i]);
        }
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function pause() external {
        require(msg.sender == governance() || emergencyPauseSenders.contains(msg.sender),
            "only governance or emergency pause senders");
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
        require(index != 0, "escrow not found");
        return escrows[index - 1];
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getUnusedPreimageHashes() external view returns (bytes32[] memory) {
        uint256 length = preimageHashes.length - nextUnusedPreimageHashIndex;
        bytes32[] memory unusedPreimageHashes = new bytes32[](length);
        for (uint256 i = 0; i < length; i++) {
            unusedPreimageHashes[i] = preimageHashes[nextUnusedPreimageHashIndex + i];
        }
        return unusedPreimageHashes;
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getPreimageHashesCount() external view returns (uint256) {
        return preimageHashes.length;
    }

    /**
     * @inheritdoc ICoreVaultManager
     */
    function getPreimageHash(uint256 _index) external view returns (bytes32) {
        return preimageHashes[_index];
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
    function getNonCancelableTransferRequestsAmount() external view returns(uint128 _amount) {
        for (uint256 i = 0; i < nonCancelableTransferRequests.length; i++) {
            _amount += transferRequestById[nonCancelableTransferRequests[i]].amount;
        }
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
    function getCancelableTransferRequestsAmount() external view returns(uint128 _amount) {
        for (uint256 i = 0; i < cancelableTransferRequests.length; i++) {
            _amount += transferRequestById[cancelableTransferRequests[i]].amount;
        }
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
        escrowEndTimestamp = escrowEndTimestamp - (escrowEndTimestamp % 1 days) + escrowEndTimeSeconds;
        if (escrowEndTimestamp <= block.timestamp + 12 hours) { // less than 12 hours from now, move to the next day
            escrowEndTimestamp += 1 days;
        }
        return uint64(escrowEndTimestamp);
    }
}
