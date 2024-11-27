// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../../userInterfaces/data/AssetManagerSettings.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";
import "../../userInterfaces/IRedemptionTimeExtension.sol";
import "../library/data/RedemptionTimeExtension.sol";
import "../library/SettingsUpdater.sol";
import "../../diamond/library/LibDiamond.sol";
import "./AssetManagerBase.sol";

contract RedemptionTimeExtensionFacet is AssetManagerBase, IRedemptionTimeExtension {

    constructor() {
        // implementation initialization - to prevent reinitialization
        RedemptionTimeExtension.setRedemptionPaymentExtensionSeconds(1);
    }

    // this method is not accessible through diamond proxy
    // it is only used for initialization when the contract is added after proxy deploy
    function initRedemptionTimeExtensionFacet(uint256 _redemptionPaymentExtensionSeconds)
        external
    {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        require(ds.supportedInterfaces[type(IERC165).interfaceId], "diamond not initialized");
        ds.supportedInterfaces[type(IRedemptionTimeExtension).interfaceId] = true;
        require(RedemptionTimeExtension.redemptionPaymentExtensionSeconds() == 0, "already initialized");
        // init settings
        RedemptionTimeExtension.setRedemptionPaymentExtensionSeconds(_redemptionPaymentExtensionSeconds);
    }

    function setRedemptionPaymentExtensionSeconds(uint256 _value)
        external
        onlyAssetManagerController
    {
        SettingsUpdater.checkEnoughTimeSinceLastUpdate();
        // validate
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 currentValue = RedemptionTimeExtension.redemptionPaymentExtensionSeconds();
        require(_value <= currentValue * 4 + settings.averageBlockTimeMS / 1000, "increase too big");
        require(_value >= currentValue / 4, "decrease too big");
        require(_value > 0, "value must be nonzero");
        // update
        RedemptionTimeExtension.setRedemptionPaymentExtensionSeconds(_value);
        emit IAssetManagerEvents.SettingChanged("redemptionPaymentExtensionSeconds", _value);
    }

    function redemptionPaymentExtensionSeconds()
        external view
        returns (uint256)
    {
        return RedemptionTimeExtension.redemptionPaymentExtensionSeconds();
    }
}
