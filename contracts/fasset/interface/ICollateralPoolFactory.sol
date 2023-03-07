// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./ICollateralPool.sol";
import "./IAssetManager.sol";


/**
 * @title Agent vault factory
 */
interface ICollateralPoolFactory {
    struct InitialSettings {
        uint256 exitCRBIPS;
        uint256 topupCRBIPS;
        uint256 topupTokenDiscountBIPS;
    }

    function create(
        IAssetManager _assetManager,
        address _agentVault,
        InitialSettings memory _settings
    ) external returns (ICollateralPool);
}
