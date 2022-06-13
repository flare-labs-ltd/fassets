// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../interface/IAgentVaultFactory.sol";
import "./AgentVault.sol";


contract AgentVaultFactory is IAgentVaultFactory {
    /**
     * @notice Creates new agent vault
     */
    function create(IAssetManager _assetManager, address payable _owner) external returns (IAgentVault) {
        return new AgentVault(_assetManager, _owner);
    }
}
