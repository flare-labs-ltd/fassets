// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../implementation/FtsoV2PriceStore.sol";


contract FtsoV2PriceStoreMock is FtsoV2PriceStore {
    using SafeCast for *;

    constructor(
        IGovernanceSettings _governanceSettings,
        address _initialGovernance,
        address _addressUpdater,
        uint64 _firstVotingRoundStartTs,
        uint8 _votingEpochDurationSeconds,
        uint8 _ftsoProtocolId
    )
        FtsoV2PriceStore(_governanceSettings, _initialGovernance, _addressUpdater,
            _firstVotingRoundStartTs, _votingEpochDurationSeconds, _ftsoProtocolId)
    {
    }

    function setDecimals(string memory _symbol, int8 _decimals) external {
        PriceStore storage feed = _getFeed(_symbol);
        feed.decimals = _decimals;
        feed.trustedDecimals = _decimals;
    }

    function setCurrentPrice(string memory _symbol, uint256 _price, uint256 _ageSeconds) external {
        PriceStore storage feed = _getFeed(_symbol);
        feed.value = _price.toUint32();
        feed.votingRoundId = _timestampToVotingRound(block.timestamp - _ageSeconds);
        feed.decimals = feed.trustedDecimals;
    }

    function setCurrentPriceFromTrustedProviders(string memory _symbol, uint256 _price, uint256 _ageSeconds) external {
        PriceStore storage feed = _getFeed(_symbol);
        feed.trustedValue = _price.toUint32();
        feed.trustedVotingRoundId = _timestampToVotingRound(block.timestamp - _ageSeconds);
    }

    function finalizePrices() external {
        emit PricesPublished(0);
    }

    function _getFeed(string memory _symbol) private view returns (PriceStore storage) {
        bytes21 feedId = symbolToFeedId[_symbol];
        require(feedId != bytes21(0), "symbol not supported");
        return latestPrices[feedId];
    }

    function _timestampToVotingRound(uint256 _timestamp) private view returns (uint32) {
        uint256 roundId = (_timestamp - firstVotingRoundStartTs) / votingEpochDurationSeconds;
        return roundId.toUint32();
    }
}
