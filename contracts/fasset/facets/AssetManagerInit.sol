// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../userInterfaces/IWhitelist.sol";
import "../library/data/AssetManagerState.sol";
import "../library/SettingsUpdater.sol";
import "../library/CollateralTypes.sol";
import "../library/LiquidationStrategy.sol";


contract AssetManagerInit {
    function init(
        AssetManagerSettings.Data memory _settings,
        CollateralType.Data[] memory _initialCollateralTypes,
        bytes memory _initialLiquidationSettings
    )
        external
    {
        SettingsUpdater.validateAndSet(_settings);
        CollateralTypes.initialize(_initialCollateralTypes);
        LiquidationStrategy.initialize(_initialLiquidationSettings);
        _initIERC165();
    }

    function _initIERC165() private {

    }
}
