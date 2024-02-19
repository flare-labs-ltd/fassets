// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IAssetManagerEvents.sol";
import "./assetManager/IAgentInfo.sol";
import "./assetManager/IAvailableAgents.sol";
import "./assetManager/IAgentCollateral.sol";
import "./assetManager/IAgentVaultManagement.sol";
import "./assetManager/IAgentSettings.sol";
import "./assetManager/IAssetManagerSettings.sol";
import "./assetManager/IChallenges.sol";
import "./assetManager/ICollateralTypes.sol";
import "./assetManager/ILiquidation.sol";
import "./assetManager/IMinting.sol";
import "./assetManager/IRedemptionRequests.sol";
import "./assetManager/IRedemptionConfirmations.sol";
import "./assetManager/IRedemptionDefaults.sol";
import "./assetManager/IUnderlyingBalance.sol";
import "./assetManager/IUnderlyingTimekeeping.sol";


/**
 * Asset manager publicly callable methods.
 */
interface IAssetManager is
    IAssetManagerEvents,
    IAgentInfo,
    IAvailableAgents,
    IAgentCollateral,
    IAgentVaultManagement,
    IAgentSettings,
    IAssetManagerSettings,
    IChallenges,
    ICollateralTypes,
    ILiquidation,
    IMinting,
    IRedemptionRequests,
    IRedemptionConfirmations,
    IRedemptionDefaults,
    IUnderlyingBalance,
    IUnderlyingTimekeeping
{
}
