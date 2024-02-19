// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../userInterfaces/IWhitelist.sol";
import "../library/data/AssetManagerState.sol";


abstract contract AssetManagerBase {
    modifier onlyAssetManagerController {
        _checkOnlyAssetManagerController();
        _;
    }

    modifier onlyAttached {
        _checkOnlyAttached();
        _;
    }

    modifier onlyWhitelistedSender {
        _checkOnlyWhitelistedSender();
        _;
    }

    function _checkOnlyAssetManagerController() private view {
        require(msg.sender == AssetManagerState.getSettings().assetManagerController,
            "only asset manager controller");
    }

    function _checkOnlyAttached() private view {
        require(AssetManagerState.get().attached, "not attached");
    }

    function _checkOnlyWhitelistedSender() private view {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        if (settings.whitelist != address(0)) {
            require(IWhitelist(settings.whitelist).isWhitelisted(msg.sender), "not whitelisted");
        }
    }
}
