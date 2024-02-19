// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../interfaces/assetManager/ISettingsManagement.sol";
import "../library/SettingsUpdater.sol";
import "./AssetManagerBase.sol";


contract SettingsManagementFacet is AssetManagerBase, ISettingsManagement {
    /**
     * Update all settings with validation.
     * This method cannot be called directly, it has to be called through assetManagerController.
     * NOTE: may not be called directly - only through asset manager controller by governance.
     */
    function updateSettings(
        bytes32 _method,
        bytes calldata _params
    )
        external override
        onlyAssetManagerController
    {
        SettingsUpdater.callUpdate(_method, _params);
    }
}
