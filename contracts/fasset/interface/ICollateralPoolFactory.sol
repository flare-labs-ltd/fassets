// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IICollateralPool.sol";
import "./IIAssetManager.sol";


/**
 * @title Agent vault factory
 */
interface ICollateralPoolFactory {
    function create(
        IIAssetManager _assetManager,
        address _agentVault,
        AgentCreateSettings.Data memory _settings
    ) external returns (IICollateralPool);

    function createPoolToken(IICollateralPool pool)
        external returns (address);
}
