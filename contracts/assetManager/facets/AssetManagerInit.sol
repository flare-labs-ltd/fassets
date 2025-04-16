// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../../openzeppelin/security/ReentrancyGuard.sol";
import "../../governance/implementation/GovernedBase.sol";
import "../../governance/implementation/GovernedProxyImplementation.sol";
import "../../userInterfaces/IAssetManager.sol";
import "../interfaces/IIAssetManager.sol";
import "../../diamond/library/LibDiamond.sol";
import "../library/data/AssetManagerState.sol";
import "../library/SettingsInitializer.sol";
import "../library/CollateralTypes.sol";


contract AssetManagerInit is GovernedProxyImplementation, ReentrancyGuard {
    function init(
        IGovernanceSettings _governanceSettings,
        address _initialGovernance,
        AssetManagerSettings.Data memory _settings,
        CollateralType.Data[] memory _initialCollateralTypes
    )
        external
    {
        GovernedBase.initialise(_governanceSettings, _initialGovernance);
        ReentrancyGuard.initializeReentrancyGuard();
        SettingsInitializer.validateAndSet(_settings);
        CollateralTypes.initialize(_initialCollateralTypes);
        _initIERC165();
    }

    /**
     * If a diamond cut adds methods to one of the declared interfaces, it should call this method in initialization.
     * In this way ERC165 identifiers for both old and new version of interface will be marked as supported,
     * which is correct since the new interface should be backward compatible with the old one.
     */
    function upgradeERC165Identifiers() external {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        require(ds.supportedInterfaces[type(IERC165).interfaceId], "not initialized");
        ds.supportedInterfaces[type(IGoverned).interfaceId] = true;
        ds.supportedInterfaces[type(IAssetManager).interfaceId] = true;
        ds.supportedInterfaces[type(IIAssetManager).interfaceId] = true;
        ds.supportedInterfaces[type(IAgentPing).interfaceId] = true;
    }

    function _initIERC165() private {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IERC165).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IGoverned).interfaceId] = true;
        ds.supportedInterfaces[type(IAssetManager).interfaceId] = true;
        ds.supportedInterfaces[type(IIAssetManager).interfaceId] = true;
        ds.supportedInterfaces[type(IAgentPing).interfaceId] = true;
    }
}
