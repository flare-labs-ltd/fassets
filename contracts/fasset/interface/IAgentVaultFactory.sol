// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IAgentVault.sol";
import "./IAssetManager.sol";


/**
 * @title Agent vault factory
 */
interface IAgentVaultFactory {
    /**
     * @notice Creates new agent vault
     */
    function create(IAssetManager _assetManager) external returns (IAgentVault);
}
