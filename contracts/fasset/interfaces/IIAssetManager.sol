// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../diamond/interfaces/IDiamondCut.sol";
import "../../userInterfaces/IAssetManager.sol";
import "./assetManager/IAgentVaultAndPoolSupport.sol";
import "./assetManager/IAgentVaultCollateralHooks.sol";
import "./assetManager/IPoolSelfCloseRedemption.sol";
import "./assetManager/ICollateralTypesManagement.sol";
import "./assetManager/ISettingsManagement.sol";
import "./assetManager/ISystemStateManagement.sol";


/**
 * Asset Manager methods used internally in AgentVault, CollateralPool and AssetManagerController.
 */
interface IIAssetManager is
    IAssetManager,
    IDiamondCut,
    IAgentVaultAndPoolSupport,
    IAgentVaultCollateralHooks,
    IPoolSelfCloseRedemption,
    ICollateralTypesManagement,
    ISettingsManagement,
    ISystemStateManagement
{
}
