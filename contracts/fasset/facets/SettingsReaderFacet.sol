// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../library/data/AssetManagerState.sol";
import "../library/Globals.sol";
import "../library/LiquidationStrategy.sol";
import "./AssetManagerBase.sol";


contract SettingsReaderFacet is AssetManagerBase {
    /**
     * Get complete current settings.
     * @return the current settings
     */
    function getSettings()
        external view
        returns (AssetManagerSettings.Data memory)
    {
        return AssetManagerState.getSettings();
    }

    /**
     * Get the f-asset contract managed by this asset manager instance.
     */
    function fAsset()
        external view
        returns (IERC20)
    {
        return IERC20(address(Globals.getFAsset()));
    }

    /**
     * return lot size in UBA.
     */
    function lotSize()
        external view
        returns (uint256 _lotSizeUBA)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        return settings.lotSizeAMG * settings.assetMintingGranularityUBA;
    }

    /**
     * Get the asset manager controller, the only address that can change settings.
     */
    function assetManagerController()
        external view
        returns (address)
    {
        return AssetManagerState.getSettings().assetManagerController;
    }

    /**
     * When `controllerAttached` is true, asset manager has been added to the asset manager controller.
     */
    function controllerAttached() external view  returns (bool) {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.attached;
    }

    /**
     * Get settings for current liquidation strategy. Format depends on the liquidation strategy implementation.
     * @return the current settings
     */
    function getLiquidationSettings()
        external view
        returns (bytes memory)
    {
        return LiquidationStrategy.getSettings();
    }

    /**
     * Returns timelock duration during for which collateral pool tokens are locked after minting.
     */
    function getCollateralPoolTokenTimelockSeconds()
        external view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        return settings.collateralPoolTokenTimelockSeconds;
    }

    /**
     * True if asset manager is paused.
     */
    function paused()
        external view
        returns (bool)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.pausedAt != 0;
    }

    /**
     * True if asset manager is terminated.
     */
    function terminated()
        external view
        returns (bool)
    {
        return Globals.getFAsset().terminated();
    }
}
