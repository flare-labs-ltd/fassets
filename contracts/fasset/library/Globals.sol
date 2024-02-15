// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../interfaces/IFAsset.sol";
import "../../userInterfaces/IAgentOwnerRegistry.sol";
import "./data/AssetManagerState.sol";


// global state helpers
library Globals {
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
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        return IFAsset(settings.fAsset);
    }

    function getAgentOwnerRegistry()
        internal view
        returns (IAgentOwnerRegistry)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        return IAgentOwnerRegistry(settings.agentOwnerRegistry);
    }
}
