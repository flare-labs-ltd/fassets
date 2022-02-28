// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "flare-smart-contracts/contracts/userInterfaces/IFtso.sol";


contract FtsoMock is IFtso {
    uint256 private price;
    uint256 private priceTimestamp;
    
    function setCurrentPrice(uint256 _price) external {
        price = _price;
        priceTimestamp = block.timestamp;
    }
    
    // in FAsset system, we only need current price
    
    function getCurrentPrice() external view returns (uint256 _price, uint256 _timestamp) {
        return (price, priceTimestamp);
    }

    // unused
    
    function active() external view returns (bool) {}

    function symbol() external view returns (string memory) {}

    function getCurrentEpochId() external view returns (uint256) {}

    function getEpochId(uint256 _timestamp) external view returns (uint256) {}
    
    function getRandom(uint256 _epochId) external view returns (uint256) {}

    function getEpochPrice(uint256 _epochId) external view returns (uint256) {}

    function getPriceEpochData() external view returns (
        uint256 _epochId,
        uint256 _epochSubmitEndTime,
        uint256 _epochRevealEndTime,
        uint256 _votePowerBlock,
        bool _fallbackMode
    ) {}

    function getPriceEpochConfiguration() external view returns (
        uint256 _firstEpochStartTs,
        uint256 _submitPeriodSeconds,
        uint256 _revealPeriodSeconds
    ) {}
    
    function getEpochPriceForVoter(uint256 _epochId, address _voter) external view returns (uint256) {}

    function getCurrentRandom() external view returns (uint256) {}
}
