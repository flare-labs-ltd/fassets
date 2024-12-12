// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../library/data/AssetManagerState.sol";
import "../library/Globals.sol";
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
        return Globals.getSettings();
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
     * Get the price reader contract used by this asset manager instance.
     */
    function priceReader()
        external view
        returns (address)
    {
        return Globals.getSettings().priceReader;
    }

    /**
     * return lot size in UBA.
     */
    function lotSize()
        external view
        returns (uint256 _lotSizeUBA)
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        return settings.lotSizeAMG * settings.assetMintingGranularityUBA;
    }

    /**
     * return AMG in UBA.
     */
    function assetMintingGranularityUBA()
        external view
        returns (uint256)
    {
        return Globals.getSettings().assetMintingGranularityUBA;
    }

    /**
     * return asset minting decimals.
     */
    function assetMintingDecimals()
        external view
        returns (uint256)
    {
        return Globals.getSettings().assetMintingDecimals;
    }

    /**
     * Get the asset manager controller, the only address that can change settings.
     */
    function assetManagerController()
        external view
        returns (address)
    {
        return Globals.getSettings().assetManagerController;
    }

    /**
     * Returns timelock duration during for which collateral pool tokens are locked after minting.
     */
    function getCollateralPoolTokenTimelockSeconds()
        external view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        return settings.collateralPoolTokenTimelockSeconds;
    }
}
