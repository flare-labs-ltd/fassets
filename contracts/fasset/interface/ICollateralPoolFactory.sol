// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./ICollateralPool.sol";
import "./IAssetManager.sol";


/**
 * @title Agent vault factory
 */
interface ICollateralPoolFactory {
    function create(
        IAssetManager _assetManager,
        address _agentVault,
        IAssetManager.InitialAgentSettings memory _settings
    ) external returns (ICollateralPool);

    function createPoolToken(ICollateralPool pool)
        external returns (address);
}
