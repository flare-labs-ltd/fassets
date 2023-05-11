// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IAssetManagerEvents.sol";
import "./IAssetManagerSystem.sol";
import "./IAssetManagerAgent.sol";
import "./IAssetManagerAvailableAgents.sol";
import "./IAssetManagerChallenges.sol";
import "./IAssetManagerLiquidation.sol";
import "./IAssetManagerMinting.sol";
import "./IAssetManagerRedemption.sol";


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
