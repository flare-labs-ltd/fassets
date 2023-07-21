// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IIContingencyPool.sol";
import "./IIAssetManager.sol";


/**
 * @title Collateral pool factory
 */
interface IContingencyPoolFactory {
    function create(
        IIAssetManager _assetManager,
        address _agentVault,
        AgentSettings.Data memory _settings
    ) external
        returns (IIContingencyPool);
}
