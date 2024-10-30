// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "flare-smart-contracts-v2/contracts/userInterfaces/IRelay.sol";
import "../../governance/implementation/Governed.sol";
import "../../governance/implementation/AddressUpdatable.sol";
import "../interfaces/IPriceReader.sol";
import "../interfaces/IPricePublisher.sol";


contract FtsoV2PriceStore is Governed, IPriceReader, IPricePublisher, IERC165, AddressUpdatable {
    using MerkleProof for bytes32[];

    struct PriceStore {
        uint32 votingRoundId;
        uint32 value;
        int8 decimals;

        uint32 trustedVotingRoundId;
        uint32 trustedValue;
        int8 trustedDecimals;
    }

    /// Timestamp when the first voting epoch started, in seconds since UNIX epoch.
    uint64 public immutable firstVotingRoundStartTs;
    /// Duration of voting epochs, in seconds.
    uint64 public immutable votingEpochDurationSeconds;
    /// Duration of a window for submitting trusted prices, in seconds.
    uint64 public immutable submitTrustedPricesWindowSeconds;
    /// The FTSO protocol id.
    uint8 public immutable ftsoProtocolId;

    /// The list of required feed ids to be published.
    bytes21[] internal feedIds;
    /// Mapping from symbol to feed id - used for price lookups (backwards compatibility).
    mapping(string symbol => bytes21 feedId) internal symbolToFeedId;
    /// Mapping from feed id to price store which holds the latest published FTSO scaling price and trusted price.
    mapping(bytes21 feedId => PriceStore) internal latestPrices;
    /// Mapping from feed id to submitted trusted prices for the given voting round.
    mapping(bytes21 feedId => mapping (uint32 votingRoundId => bytes)) internal submittedTrustedPrices;
    /// Mapping from trusted provider to the last submitted voting epoch id.
    mapping(address trustedProvider => uint256 lastVotingEpochId) internal lastVotingEpochIdByProvider;

    /// The list of trusted providers.
    address[] internal trustedProviders;
    mapping(address trustedProvider => bool isTrustedProvider) internal trustedProvidersMap;
    /// Trusted providers threshold for calculating the median price.
    uint8 public trustedProvidersThreshold;

    /// The Relay contract.
    IRelay public relay;
    /// The last published voting round id.
    uint32 public lastPublishedVotingRoundId;

    event PricesPublished(uint32 indexed votingRoundId);

    constructor(
        IGovernanceSettings _governanceSettings,
        address _initialGovernance,
        address _addressUpdater,
        uint64 _firstVotingRoundStartTs,
        uint8 _votingEpochDurationSeconds,
        uint8 _ftsoProtocolId
    )
        Governed(_governanceSettings, _initialGovernance) AddressUpdatable(_addressUpdater)
    {
        require(_firstVotingRoundStartTs + _votingEpochDurationSeconds <= block.timestamp, "invalid start time");
        require(_votingEpochDurationSeconds > 1, "voting epoch duration too short"); // 90 s
        firstVotingRoundStartTs = _firstVotingRoundStartTs;
        votingEpochDurationSeconds = _votingEpochDurationSeconds;
        submitTrustedPricesWindowSeconds = _votingEpochDurationSeconds / 2; // 45 s
        ftsoProtocolId = _ftsoProtocolId;
        lastPublishedVotingRoundId = _getPreviousVotingEpochId();
    }

    /**
     * @inheritdoc IPricePublisher
     */
    function publishPrices(FeedWithProof[] calldata _proofs) external {
        uint32 votingRoundId = 0;
        require(_proofs.length == feedIds.length, "wrong number of proofs");
        for (uint256 i = 0; i < _proofs.length; i++) {
            FeedWithProof calldata proof = _proofs[i];
            Feed calldata feed = proof.body;
            if (i == 0) {
                votingRoundId = feed.votingRoundId;
                require(votingRoundId > lastPublishedVotingRoundId, "(newer) prices already published");
                require(_getEndTimestamp(votingRoundId) + submitTrustedPricesWindowSeconds <= block.timestamp,
                     "submission window not closed yet");
                // update last published voting round id
                lastPublishedVotingRoundId = votingRoundId;
                // emit event
                emit PricesPublished(votingRoundId);
            } else {
                require(feed.votingRoundId == votingRoundId, "voting round id mismatch");
            }
            bytes21 feedId = feedIds[i];
            require(feed.id == feedId, "feed id mismatch");
            require(feed.value >= 0, "value must be non-negative");

            bytes32 feedHash = keccak256(abi.encode(feed));
            bytes32 merkleRoot = relay.merkleRoots(ftsoProtocolId, votingRoundId);
            require(proof.merkleProof.verifyCalldata(merkleRoot, feedHash), "merkle proof invalid");

            PriceStore storage priceStore = latestPrices[feedId];
            priceStore.votingRoundId = feed.votingRoundId;
            priceStore.value = uint32(feed.value);
            priceStore.decimals = feed.decimals;

            // calculate trusted prices for the same voting round
            bytes memory trustedPrices = submittedTrustedPrices[feedId][votingRoundId];
            if (trustedPrices.length > 0 && trustedPrices.length >= 4 * trustedProvidersThreshold) {
                // calculate median price
                uint256 medianPrice = _calculateMedian(trustedPrices);
                // store the median price
                priceStore.trustedVotingRoundId = votingRoundId;
                priceStore.trustedValue = uint32(medianPrice);
                // delete submitted trusted prices
                delete submittedTrustedPrices[feedId][votingRoundId];
            }
        }
    }

    /**
     * @inheritdoc IPricePublisher
     * @dev The function can be called by trusted providers only.
     */
    function submitTrustedPrices(uint32 _votingRoundId, TrustedProviderFeed[] calldata _feeds) external {
        require(trustedProvidersMap[msg.sender], "only trusted provider");
        require(_feeds.length == feedIds.length, "all prices must be provided");
        uint32 previousVotingEpochId = _getPreviousVotingEpochId();
        require(_votingRoundId == previousVotingEpochId, "voting round id mismatch");
        // end of previous voting epoch = start of current voting epoch
        uint256 startTimestamp = _getEndTimestamp(previousVotingEpochId);
        uint256 endTimestamp = startTimestamp + submitTrustedPricesWindowSeconds;
        require(block.timestamp >= startTimestamp && block.timestamp < endTimestamp, "submission window closed");
        require(lastVotingEpochIdByProvider[msg.sender] < previousVotingEpochId, "already submitted");
        // mark the trusted provider submission
        lastVotingEpochIdByProvider[msg.sender] = previousVotingEpochId;

        for (uint256 i = 0; i < _feeds.length; i++) {
            TrustedProviderFeed calldata feed = _feeds[i];
            bytes21 feedId = feedIds[i];
            require(feed.id == feedId, "feed id mismatch");
            require(feed.decimals == latestPrices[feedId].trustedDecimals, "decimals mismatch");
            submittedTrustedPrices[feedId][previousVotingEpochId] =
                bytes.concat(submittedTrustedPrices[feedId][previousVotingEpochId], bytes4(feed.value));
        }
    }

    /**
     * Updates the settings.
     * @param _feedIds The list of feed ids.
     * @param _symbols The list of symbols.
     * @param _trustedDecimals The list of trusted decimals.
     * @dev Can only be called by the governance.
     */
    function updateSettings(
        bytes21[] calldata _feedIds,
        string[] calldata _symbols,
        int8[] calldata _trustedDecimals
    )
        external onlyGovernance
    {
        require(_feedIds.length == _symbols.length && _feedIds.length == _trustedDecimals.length, "length mismatch");
        feedIds = _feedIds;
        for (uint256 i = 0; i < _feedIds.length; i++) {
            bytes21 feedId = _feedIds[i];
            symbolToFeedId[_symbols[i]] = feedId;
            PriceStore storage latestPrice = latestPrices[feedId];
            if (latestPrice.trustedDecimals != _trustedDecimals[i]) {
                latestPrice.trustedDecimals = _trustedDecimals[i];
                latestPrice.trustedValue = 0;
                latestPrice.trustedVotingRoundId = 0;
                // delete all submitted trusted prices for the symbol
                for (uint32 j = lastPublishedVotingRoundId + 1; j <= _getPreviousVotingEpochId(); j++) {
                    delete submittedTrustedPrices[feedId][j];
                }
            }
        }
    }

    /**
     * Sets the trusted providers.
     * @param _trustedProviders The list of trusted providers.
     * @param _trustedProvidersThreshold The trusted providers threshold for calculating the median price.
     * @dev Can only be called by the governance.
     */
    function setTrustedProviders(
        address[] calldata _trustedProviders,
        uint8 _trustedProvidersThreshold
    )
        external onlyGovernance
    {
        require(_trustedProviders.length >= _trustedProvidersThreshold, "threshold too high");
        trustedProvidersThreshold = _trustedProvidersThreshold;
        // reset all trusted providers
        for (uint256 i = 0; i < trustedProviders.length; i++) {
            trustedProvidersMap[trustedProviders[i]] = false;
        }
        // set new trusted providers
        trustedProviders = _trustedProviders;
        for (uint256 i = 0; i < _trustedProviders.length; i++) {
            trustedProvidersMap[_trustedProviders[i]] = true;
        }
    }

    /**
     * @inheritdoc IPriceReader
     */
    function getPrice(string memory _symbol)
        external view
        returns (uint256 _price, uint256 _timestamp, uint256 _priceDecimals)
    {
        bytes21 feedId = symbolToFeedId[_symbol];
        require(feedId != bytes21(0), "symbol not supported");
        PriceStore storage feed = latestPrices[feedId];
        _price = feed.value;
        _timestamp = _getEndTimestamp(feed.votingRoundId);
        int256 decimals = feed.decimals; // int8
        if (decimals < 0) {
            _priceDecimals = 0;
            _price *= 10 ** uint256(-decimals);
        } else {
            _priceDecimals = uint256(decimals);
        }
    }

    /**
     * @inheritdoc IPriceReader
     */
    function getPriceFromTrustedProviders(string memory _symbol)
        external view
        returns (uint256 _price, uint256 _timestamp, uint256 _priceDecimals)
    {
        bytes21 feedId = symbolToFeedId[_symbol];
        require(feedId != bytes21(0), "symbol not supported");
        PriceStore storage feed = latestPrices[feedId];
        _price = feed.trustedValue;
        _timestamp = _getEndTimestamp(feed.trustedVotingRoundId);
        int256 decimals = feed.trustedDecimals; // int8
        if (decimals < 0) {
            _priceDecimals = 0;
            _price *= 10 ** uint256(-decimals);
        } else {
            _priceDecimals = uint256(decimals);
        }
    }

    /**
     * @inheritdoc IPricePublisher
     */
    function getFeedIds() external view returns (bytes21[] memory) {
        return feedIds;
    }

    /**
     * @inheritdoc IPricePublisher
     */
    function getFeedIdsWithDecimals() external view returns (bytes21[] memory _feedIds, int8[] memory _decimals) {
        _feedIds = feedIds;
        _decimals = new int8[](_feedIds.length);
        for (uint256 i = 0; i < _feedIds.length; i++) {
            _decimals[i] = latestPrices[_feedIds[i]].trustedDecimals;
        }
    }

    /**
     * @inheritdoc IPricePublisher
     */
    function getFeedId(string memory _symbol) external view returns (bytes21) {
        return symbolToFeedId[_symbol];
    }

    /**
     * @inheritdoc IPricePublisher
     */
    function getTrustedProviders() external view returns (address[] memory) {
        return trustedProviders;
    }

    /**
     * @notice virtual method that a contract extending AddressUpdatable must implement
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        relay = IRelay(_getContractAddress(_contractNameHashes, _contractAddresses, "Relay"));
    }

    /**
     * Returns the previous voting epoch id.
     */
    function _getPreviousVotingEpochId() internal view returns(uint32) {
        return uint32((block.timestamp - firstVotingRoundStartTs) / votingEpochDurationSeconds) - 1;
    }

    /**
     * Returns the end timestamp for the given voting epoch id.
     */
    function _getEndTimestamp(uint256 _votingEpochId) internal view returns(uint256) {
        return firstVotingRoundStartTs + (_votingEpochId + 1) * votingEpochDurationSeconds;
    }

    /**
     * @notice Calculates the simple median price (using insertion sort) - sorts original array
     * @param _prices positional array of prices to be sorted
     * @return median price
     */
    function _calculateMedian(bytes memory _prices) internal pure returns (uint256) {
        uint256 length = _prices.length;
        assert(length > 0 && length % 4 == 0);
        length /= 4;
        uint256[] memory prices = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            bytes memory price = new bytes(4);
            for (uint256 j = 0; j < 4; j++) {
                price[j] = _prices[i * 4 + j];
            }
            prices[i] = uint32(bytes4(price));
        }

        for (uint256 i = 1; i < length; i++) {
            // price to sort next
            uint256 currentPrice = prices[i];

            // shift bigger prices right
            uint256 j = i;
            while (j > 0 && prices[j - 1] > currentPrice) {
                prices[j] = prices[j - 1];
                j--; // no underflow
            }
            // insert
            prices[j] = currentPrice;
        }

        uint256 middleIndex = length / 2;
        if (length % 2 == 1) {
            return prices[middleIndex];
        } else {
            // if median is "in the middle", take the average price of the two consecutive prices
            return (prices[middleIndex - 1] + prices[middleIndex]) / 2;
        }
    }

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IPriceReader).interfaceId
            || _interfaceId == type(IPricePublisher).interfaceId;
    }
}
