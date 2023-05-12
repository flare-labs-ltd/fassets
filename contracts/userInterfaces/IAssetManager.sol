// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./assetManager/IAssetManagerEvents.sol";
import "./assetManager/IAssetManagerSystem.sol";
import "./assetManager/IAssetManagerAgent.sol";
import "./assetManager/IAssetManagerAvailableAgents.sol";
import "./assetManager/IAssetManagerChallenges.sol";
import "./assetManager/IAssetManagerLiquidation.sol";
import "./assetManager/IAssetManagerMinting.sol";
import "./assetManager/IAssetManagerRedemption.sol";


/**
 * Asset manager publicly callable methods.
 */
interface IAssetManager is
    IAssetManagerEvents,
    IAssetManagerSystem,
    IAssetManagerAgent,
    IAssetManagerAvailableAgents,
    IAssetManagerChallenges,
    IAssetManagerLiquidation,
    IAssetManagerMinting,
    IAssetManagerRedemption
{
}
