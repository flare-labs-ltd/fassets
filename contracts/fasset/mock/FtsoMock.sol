// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "flare-smart-contracts/contracts/ftso/interface/IIFtso.sol";


contract FtsoMock is IIFtso {
    bool public immutable active = true;
    string public symbol;

    uint256 private price;
    uint256 private priceTimestamp;

    uint256 private priceFromTrustedProviders;
    uint256 private priceTimestampFromTrustedProviders;

    uint256 private immutable decimals;

    constructor(string memory _symbol, uint256 _decimals) {
        symbol = _symbol;
        decimals = _decimals;
    }

    function setCurrentPrice(uint256 _price, uint256 _ageSeconds) external {
        price = _price;
        priceTimestamp = block.timestamp - _ageSeconds;
    }

    function setCurrentPriceFromTrustedProviders(uint256 _price, uint256 _ageSeconds) external {
        priceFromTrustedProviders = _price;
        priceTimestampFromTrustedProviders = block.timestamp - _ageSeconds;
    }

    // in FAsset system, we only need current price

    function getCurrentPrice() external view returns (uint256 _price, uint256 _timestamp) {
        return (price, priceTimestamp);
    }

    function getCurrentPriceWithDecimals()
        external view
        returns (uint256 _price, uint256 _timestamp, uint256 _assetPriceUsdDecimals)
    {
        return (price, priceTimestamp, decimals);
    }

    function getCurrentPriceFromTrustedProviders() external view returns (uint256 _price, uint256 _timestamp) {
        return (priceFromTrustedProviders, priceTimestampFromTrustedProviders);
    }

    function getCurrentPriceWithDecimalsFromTrustedProviders()
        external view
        returns (uint256 _price, uint256 _timestamp, uint256 _assetPriceUsdDecimals)
    {
        return (priceFromTrustedProviders, priceTimestampFromTrustedProviders, decimals);
    }

    // unused

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

    function getCurrentPriceDetails() external view returns (
        uint256 _price,
        uint256 _priceTimestamp,
        PriceFinalizationType _priceFinalizationType,
        uint256 _lastPriceEpochFinalizationTimestamp,
        PriceFinalizationType _lastPriceEpochFinalizationType
    ) {}

    function getCurrentRandom() external view returns (uint256) {}

    // IFtsoGenesis

    function revealPriceSubmitter(
        address _voter,
        uint256 _epochId,
        uint256 _price,
        uint256 _wNatVP
    ) external {}

    function wNatVotePowerCached(address _voter, uint256 _epochId) external returns (uint256) {}

    // IIFtso

    function finalizePriceEpoch(uint256 _epochId, bool _returnRewardData) external
        returns(
            address[] memory _eligibleAddresses,
            uint256[] memory _natWeights,
            uint256 _totalNatWeight
        ) {}

    function fallbackFinalizePriceEpoch(uint256 _epochId) external {}

    function forceFinalizePriceEpoch(uint256 _epochId) external {}

    function activateFtso(
        uint256 _firstEpochStartTs,
        uint256 _submitPeriodSeconds,
        uint256 _revealPeriodSeconds
    ) external {}

    function deactivateFtso() external {}

    function updateInitialPrice(uint256 _initialPriceUSD, uint256 _initialPriceTimestamp) external {}

    function configureEpochs(
        uint256 _maxVotePowerNatThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowNatTurnoutThresholdBIPS,
        address[] memory _trustedAddresses
    ) external {}

    function setAsset(IIVPToken _asset) external {}

    function setAssetFtsos(IIFtso[] memory _assetFtsos) external {}

    function setVotePowerBlock(uint256 _blockNumber) external {}

    function initializeCurrentEpochStateForReveal(uint256 _circulatingSupplyNat, bool _fallbackMode) external {}

    function ftsoManager() external view returns (address) {}

    function getAsset() external view returns (IIVPToken) {}

    function getAssetFtsos() external view returns (IIFtso[] memory) {}

    function epochsConfiguration() external view
        returns (
            uint256 _maxVotePowerNatThresholdFraction,
            uint256 _maxVotePowerAssetThresholdFraction,
            uint256 _lowAssetUSDThreshold,
            uint256 _highAssetUSDThreshold,
            uint256 _highAssetTurnoutThresholdBIPS,
            uint256 _lowNatTurnoutThresholdBIPS,
            address[] memory _trustedAddresses
        ) {}

    function getVoteWeightingParameters() external view
        returns (
            IIVPToken[] memory _assets,
            uint256[] memory _assetMultipliers,
            uint256 _totalVotePowerNat,
            uint256 _totalVotePowerAsset,
            uint256 _assetWeightRatio,
            uint256 _votePowerBlock
        ) {}

    function wNat() external view returns (IIVPToken) {}

}
