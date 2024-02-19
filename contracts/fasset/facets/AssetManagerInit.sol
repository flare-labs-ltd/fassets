// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../../openzeppelin/security/ReentrancyGuard.sol";
import "../../governance/implementation/GovernedBase.sol";
import "../../userInterfaces/IAssetManager.sol";
import "../interfaces/IIAssetManager.sol";
import "../../diamond/library/LibDiamond.sol";
import "../library/data/AssetManagerState.sol";
import "../library/SettingsUpdater.sol";
import "../library/CollateralTypes.sol";
import "../library/LiquidationStrategy.sol";


contract AssetManagerInit is GovernedBase, ReentrancyGuard {
    function init(
        IGovernanceSettings _governanceSettings,
        address _initialGovernance,
        AssetManagerSettings.Data memory _settings,
        CollateralType.Data[] memory _initialCollateralTypes,
        bytes memory _initialLiquidationSettings
    )
        external
    {
        GovernedBase.initialise(_governanceSettings, _initialGovernance);
        ReentrancyGuard.initializeReentrancyGuard();
        SettingsUpdater.validateAndSet(_settings);
        CollateralTypes.initialize(_initialCollateralTypes);
        LiquidationStrategy.initialize(_initialLiquidationSettings);
        _initIERC165();
    }

    function _initIERC165() private {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IERC165).interfaceId] = true;
        ds.supportedInterfaces[type(IAssetManager).interfaceId] = true;
        ds.supportedInterfaces[type(IIAssetManager).interfaceId] = true;
    }
}
