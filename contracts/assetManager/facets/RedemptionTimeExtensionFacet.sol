// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../../userInterfaces/data/AssetManagerSettings.sol";
import "../../userInterfaces/IRedemptionTimeExtension.sol";
import "../library/data/RedemptionTimeExtension.sol";
import "../library/SettingsUpdater.sol";
import "../../diamond/library/LibDiamond.sol";
import "../../governance/implementation/GovernedProxyImplementation.sol";
import "./AssetManagerBase.sol";

contract RedemptionTimeExtensionFacet is AssetManagerBase, GovernedProxyImplementation, IRedemptionTimeExtension {
    bytes32 internal constant SET_REDEMPTION_PAYMENT_EXTENSION_SECONDS =
        keccak256("RedemptionTimeExtensionFacet.setRedemptionPaymentExtensionSeconds(uint256)");

    // this method is not accessible through diamond proxy
    // it is only used for initialization when the contract is added after proxy deploy
    function initRedemptionTimeExtensionFacet(uint256 _redemptionPaymentExtensionSeconds)
        external
    {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        require(ds.supportedInterfaces[type(IERC165).interfaceId], "diamond not initialized");
        ds.supportedInterfaces[type(IRedemptionTimeExtension).interfaceId] = true;
        // init settings
        RedemptionTimeExtension.setRedemptionPaymentExtensionSeconds(_redemptionPaymentExtensionSeconds);
    }

    function setRedemptionPaymentExtensionSeconds(uint256 _value)
        external
        onlyImmediateGovernance
    {
        SettingsUpdater.checkEnoughTimeSinceLastUpdate();
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 currentValue = RedemptionTimeExtension.redemptionPaymentExtensionSeconds();
        require(_value <= currentValue * 4 + settings.averageBlockTimeMS / 1000, "increase too big");
        require(_value >= currentValue / 4, "decrease too big");
        RedemptionTimeExtension.setRedemptionPaymentExtensionSeconds(_value);
        emit RedemptionPaymentExtensionSecondsChanged(_value);
    }

    function redemptionPaymentExtensionSeconds()
        external view
        returns (uint256)
    {
        return RedemptionTimeExtension.redemptionPaymentExtensionSeconds();
    }
}
