// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../library/SettingsUpdater.sol";
import "./AssetManagerBase.sol";


contract SettingsManagementFacet is AssetManagerBase {
    /**
     * Update all settings with validation.
     * This method cannot be called directly, it has to be called through assetManagerController.
     * NOTE: may not be called directly - only through asset manager controller by governance.
     */
    function updateSettings(
        bytes32 _method,
        bytes calldata _params
    )
        external
        onlyAssetManagerController
    {
        SettingsUpdater.callUpdate(_method, _params);
    }
}
