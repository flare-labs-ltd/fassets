// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../diamond/library/LibDiamond.sol";
import "../../governance/implementation/GovernedProxyImplementation.sol";
import "../../openzeppelin/security/ReentrancyGuard.sol";
import "../library/CoreVault.sol";
import "./AssetManagerBase.sol";


contract CoreVaultSettingsFacet is AssetManagerBase, GovernedProxyImplementation, ICoreVaultSettings {
    using SafeCast for uint256;

    // prevent initialization of implementation contract
    constructor() {
        CoreVault.getState().initialized = true;
    }

    function initCoreVaultFacet(
        IICoreVaultManager _coreVaultManager,
        address payable _nativeAddress,
        uint256 _transferFeeBIPS,
        uint256 _redemptionFeeBIPS,
        uint256 _minimumAmountLeftBIPS,
        uint256 _minimumRedeemLots
    )
        external
    {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        require(ds.supportedInterfaces[type(IERC165).interfaceId], "diamond not initialized");
        ds.supportedInterfaces[type(ICoreVault).interfaceId] = true;
        ds.supportedInterfaces[type(ICoreVaultSettings).interfaceId] = true;
        // init settings
        CoreVault.State storage state = CoreVault.getState();
        require(!state.initialized, "already initialized");
        state.initialized = true;
        state.coreVaultManager = _coreVaultManager;
        state.nativeAddress = _nativeAddress;
        state.transferFeeBIPS = _transferFeeBIPS.toUint16();
        state.redemptionFeeBIPS = _redemptionFeeBIPS.toUint32();
        state.minimumAmountLeftBIPS = _minimumAmountLeftBIPS.toUint16();
        state.minimumRedeemLots = _minimumRedeemLots.toUint64();
    }

    ///////////////////////////////////////////////////////////////////////////////////
    // Settings

    function setCoreVaultManager(
        address _coreVaultManager
    )
        external
        onlyGovernance
    {
        CoreVault.State storage state = CoreVault.getState();
        state.coreVaultManager = IICoreVaultManager(_coreVaultManager);
    }

    function setCoreVaultNativeAddress(
        address payable _nativeAddress
    )
        external
        onlyImmediateGovernance
    {
        CoreVault.State storage state = CoreVault.getState();
        state.nativeAddress = _nativeAddress;
    }

    function setCoreVaultTransferFeeBIPS(
        uint256 _transferFeeBIPS
    )
        external
        onlyImmediateGovernance
    {
        CoreVault.State storage state = CoreVault.getState();
        state.transferFeeBIPS = _transferFeeBIPS.toUint16();
    }

    function setCoreVaultRedemptionFeeBIPS(
        uint256 _redemptionFeeBIPS
    )
        external
        onlyImmediateGovernance
    {
        CoreVault.State storage state = CoreVault.getState();
        state.redemptionFeeBIPS = _redemptionFeeBIPS.toUint32();
    }

    function setCoreVaultMinimumAmountLeftBIPS(
        uint256 _minimumAmountLeftBIPS
    )
        external
        onlyImmediateGovernance
    {
        CoreVault.State storage state = CoreVault.getState();
        state.minimumAmountLeftBIPS = _minimumAmountLeftBIPS.toUint16();
    }

    function setCoreVaultMinimumRedeemLots(
        uint256 _minimumRedeemLots
    )
        external
        onlyImmediateGovernance
    {
        CoreVault.State storage state = CoreVault.getState();
        state.minimumRedeemLots = _minimumRedeemLots.toUint64();
    }

    function getCoreVaultManager()
        external view
        returns (address)
    {
        CoreVault.State storage state = CoreVault.getState();
        return address(state.coreVaultManager);
    }

    function getCoreVaultNativeAddress()
        external view
        returns (address)
    {
        CoreVault.State storage state = CoreVault.getState();
        return state.nativeAddress;
    }

    function getCoreVaultTransferFeeBIPS()
        external view
        returns (uint256)
    {
        CoreVault.State storage state = CoreVault.getState();
        return state.transferFeeBIPS;
    }

    function getCoreVaultRedemptionFeeBIPS()
        external view
        returns (uint256)
    {
        CoreVault.State storage state = CoreVault.getState();
        return state.redemptionFeeBIPS;
    }

    function getCoreVaultMinimumAmountLeftBIPS()
        external view
        returns (uint256)
    {
        CoreVault.State storage state = CoreVault.getState();
        return state.minimumAmountLeftBIPS;
    }

    function getCoreVaultMinimumRedeemLots()
        external view
        returns (uint256)
    {
        CoreVault.State storage state = CoreVault.getState();
        return state.minimumRedeemLots;
    }
}
