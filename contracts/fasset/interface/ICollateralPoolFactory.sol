// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./ICollateralPool.sol";
import "./IIAssetManager.sol";


/**
 * @title Agent vault factory
 */
interface ICollateralPoolFactory {
    function create(
        IIAssetManager _assetManager,
        address _agentVault,
        AgentCreateSettings.Data memory _settings
    ) external returns (ICollateralPool);

    function createPoolToken(ICollateralPool pool)
        external returns (address);
}
