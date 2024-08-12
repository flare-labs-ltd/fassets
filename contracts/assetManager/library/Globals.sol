// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../fassetToken/interfaces/IFAsset.sol";
import "../interfaces/IWNat.sol";
import "../../userInterfaces/data/AssetManagerSettings.sol";
import "../../userInterfaces/IAgentOwnerRegistry.sol";
import "./data/AssetManagerState.sol";


// global state helpers
library Globals {
    bytes32 internal constant ASSET_MANAGER_SETTINGS_POSITION = keccak256("fasset.AssetManager.Settings");

    function getSettings()
        internal pure
        returns (AssetManagerSettings.Data storage _settings)
    {
        bytes32 position = ASSET_MANAGER_SETTINGS_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _settings.slot := position
        }
    }

    function getWNat()
        internal view
        returns (IWNat)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return IWNat(address(state.collateralTokens[state.poolCollateralIndex].token));
    }

    function getPoolCollateral()
        internal view
        returns (CollateralTypeInt.Data storage)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.collateralTokens[state.poolCollateralIndex];
    }

    function getFAsset()
        internal view
        returns (IFAsset)
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        return IFAsset(settings.fAsset);
    }

    function getAgentOwnerRegistry()
        internal view
        returns (IAgentOwnerRegistry)
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        return IAgentOwnerRegistry(settings.agentOwnerRegistry);
    }
}
