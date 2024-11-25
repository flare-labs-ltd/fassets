// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IICollateralPool.sol";
import "./IIAssetManager.sol";
import "./IUpgradableContractFactory.sol";


/**
 * @title Collateral pool factory
 */
interface ICollateralPoolFactory is IUpgradableContractFactory {
    /**
     * @notice Creates new collateral pool
     */
    function create(
        IIAssetManager _assetManager,
        address _agentVault,
        AgentSettings.Data memory _settings
    ) external
        returns (IICollateralPool);
}
