// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IAgentVault.sol";
import "./IAssetManager.sol";


/**
 * @title Agent vault factory
 */
interface ICollateralPoolFactory {
    /**
     * @notice Creates new agent vault
     */
    function create(IAssetManager _assetManager, address payable _owner) external returns (IAgentVault);
}
