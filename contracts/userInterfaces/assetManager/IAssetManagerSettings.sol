// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../data/AssetManagerSettings.sol";


/**
 * Query information about asset manager
 */
interface IAssetManagerSettings {
    /**
     * Get complete current settings.
     * @return the current settings
     */
    function getSettings()
        external view
        returns (AssetManagerSettings.Data memory);

    /**
     * Get the asset manager controller, the only address that can change settings.
     * Asset manager must be attached to the asset manager controller in the system contract registry.
     */
    function assetManagerController()
        external view
        returns (address);

    /**
     * Get the f-asset contract managed by this asset manager instance.
     */
    function fAsset()
        external view
        returns (IERC20);

    /**
     * Return lot size in UBA (underlying base amount - smallest amount on underlying chain, e.g. satoshi).
     */
    function lotSize()
        external view
        returns (uint256 _lotSizeUBA);

    /**
     * Get settings for current liquidation strategy. Format depends on the liquidation strategy implementation.
     * @return the current settings
     */
    function getLiquidationSettings()
        external view
        returns (bytes memory);

    /**
     * Returns the duration for which the collateral pool tokens are timelocked after minting.
     * Timelocking is done to battle sandwich attacks aimed at stealing newly deposited f-asset
     * fees from the pool.
     */
    function getCollateralPoolTokenTimelockSeconds()
        external view
        returns (uint256);

    /**
     * When `controllerAttached` is true, asset manager has been added to the asset manager controller.
     * This is required for the asset manager to be operational (create agent and minting don't work otherwise).
     */
    function controllerAttached()
        external view
        returns (bool);

    /**
     * True if the asset manager is paused.
     * In the paused state, minting is disabled, but all other operations (e.g. redemptions, liquidation) still work.
     * Paused asset manager can be later unpaused.
     */
    function paused()
        external view
        returns (bool);

    /**
     * True if the asset manager is terminated.
     * In terminated state almost all operations (minting, redeeming, liquidation) are disabled and f-assets are
     * not transferable any more. The only operation still permitted is for agents to release the locked collateral
     * by calling `buybackAgentCollateral`.
     * An asset manager can be terminated after being paused for at least a month
     * (to redeem as many f-assets as possible).
     * The terminated asset manager can not be revived anymore.
     */
    function terminated()
        external view
        returns (bool);
}
