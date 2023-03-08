// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../interface/ILiquidationStrategy.sol";
import "../../utils/lib/DynamicLibrary.sol";
import "./data/AssetManagerState.sol";

// This is just a wrapper for dynamic library with interface ILiquidationStrategy.
library LiquidationStrategy {
    using Agent for Agent.State;

    function initialize(bytes memory _encodedSettings) internal {
        address ls = AssetManagerState.getSettings().liquidationStrategy;
        bytes memory data = abi.encodeCall(ILiquidationStrategy(ls).initialize, (_encodedSettings));
        DynamicLibrary.delegateCall(ls, data);
    }

    function updateSettings(bytes memory _encodedSettings) internal {
        address ls = AssetManagerState.getSettings().liquidationStrategy;
        bytes memory data = abi.encodeCall(ILiquidationStrategy(ls).updateSettings, (_encodedSettings));
        DynamicLibrary.delegateCall(ls, data);
    }

    function getSettings() internal view returns (bytes memory) {
        address ls = AssetManagerState.getSettings().liquidationStrategy;
        bytes memory data = abi.encodeCall(ILiquidationStrategy(ls).getSettings, ());
        bytes memory result = DynamicLibrary.staticDelegateCall(ls, data);
        return abi.decode(result, (bytes));
    }

    function currentLiquidationFactorBIPS(
        Agent.State storage _agent,
        uint256 _class1CR,
        uint256 _poolCR
    )
        internal view
        returns (uint256 _c1FactorBIPS, uint256 _poolFactorBIPS)
    {
        address ls = AssetManagerState.getSettings().liquidationStrategy;
        bytes memory data = abi.encodeCall(ILiquidationStrategy(ls).currentLiquidationFactorBIPS,
            (_agent.vaultAddress(), _class1CR, _poolCR));
        bytes memory result = DynamicLibrary.staticDelegateCall(ls, data);
        return abi.decode(result, (uint256, uint256));
    }

}
