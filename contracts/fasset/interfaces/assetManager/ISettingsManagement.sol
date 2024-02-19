// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

interface ISettingsManagement {
    ////////////////////////////////////////////////////////////////////////////////////
    // Settings update

    /**
     * Update any of the settings with validation.
     * NOTE: may not be called directly - only through asset manager controller by governance.
     */
    function updateSettings(
        bytes32 _method,
        bytes calldata _params
    ) external;

}
