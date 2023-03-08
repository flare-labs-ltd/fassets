// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interface/IFAsset.sol";
import "../interface/ICollateralPoolFactory.sol";
import "./CollateralPool.sol";


contract CollateralPoolFactory is ICollateralPoolFactory {
    using SafeCast for uint256;

    function create(
        IAssetManager _assetManager,
        address _agentVault,
        IAssetManager.InitialAgentSettings memory _settings
    )
        external
        returns (ICollateralPool)
    {
        validatePoolSettings(_assetManager, _agentVault, _settings);
        address fAsset = address(_assetManager.fAsset());
        ICollateralPool pool = new CollateralPool(_agentVault, address(_assetManager), fAsset,
            _settings.poolExitCollateralRatioBIPS.toUint32(),
            _settings.poolTopupCollateralRatioBIPS.toUint32(),
            _settings.poolTopupTokenDiscountBIPS.toUint16());
        CollateralPoolToken poolToken = new CollateralPoolToken(payable(address(pool)));
        pool.setPoolToken(address(poolToken));
        return pool;
    }

    function validatePoolSettings(
        IAssetManager _assetManager,
        address _agentVault,
        IAssetManager.InitialAgentSettings memory _settings
    )
        internal view
    {
        // TODO
    }
}
