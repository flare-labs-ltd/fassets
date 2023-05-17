// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "flare-smart-contracts/contracts/userInterfaces/IFtsoManager.sol";


contract FtsoManagerMock is IFtsoManager {
    // just need finalization event to detect price changes

    function mockFinalizePriceEpoch() external {
        emit PriceEpochFinalized(address(0), 0);
    }

    // stub methods, to fulfil interface

    function getCurrentPriceEpochId() external view returns (uint256 _priceEpochId) {}

    function active() external view returns (bool) {}

    function getCurrentRewardEpoch() external view returns (uint256) {}

    function getRewardEpochVotePowerBlock(uint256 _rewardEpoch) external view returns (uint256) {}

    function getRewardEpochToExpireNext() external view returns (uint256) {}

    function getCurrentPriceEpochData() external view
        returns (
            uint256 _priceEpochId,
            uint256 _priceEpochStartTimestamp,
            uint256 _priceEpochEndTimestamp,
            uint256 _priceEpochRevealEndTimestamp,
            uint256 _currentTimestamp
        ) {}

    function getFtsos() external view returns (IIFtso[] memory _ftsos) {}

    function getPriceEpochConfiguration() external view
        returns (
            uint256 _firstPriceEpochStartTs,
            uint256 _priceEpochDurationSeconds,
            uint256 _revealEpochDurationSeconds
        ) {}

    function getRewardEpochConfiguration() external view
        returns (
            uint256 _firstRewardEpochStartTs,
            uint256 _rewardEpochDurationSeconds
        ) {}

    function getFallbackMode() external view
        returns (
            bool _fallbackMode,
            IIFtso[] memory _ftsos,
            bool[] memory _ftsoInFallbackMode
        ) {}

}
