// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IIAgentVault.sol";
import "./IIAssetManager.sol";
import "./IUpgradableContractFactory.sol";


/**
 * @title Agent vault factory
 */
interface IAgentVaultFactory is IUpgradableContractFactory {
    /**
     * @notice Creates new agent vault
     */
    function create(IIAssetManager _assetManager) external returns (IIAgentVault);
}
