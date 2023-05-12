// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interface/IFAsset.sol";
import "../interface/ICollateralPoolFactory.sol";
import "./CollateralPool.sol";


contract CollateralPoolFactory is ICollateralPoolFactory {
    using SafeCast for uint256;

    function create(
        IIAssetManager _assetManager,
        address _agentVault,
        AgentCreateSettings.Data memory _settings
    )
        external
        returns (IICollateralPool)
    {
        address fAsset = address(_assetManager.fAsset());
        IICollateralPool pool = new CollateralPool(_agentVault, address(_assetManager), fAsset,
            _settings.poolExitCollateralRatioBIPS.toUint32(),
            _settings.poolTopupCollateralRatioBIPS.toUint32(),
            _settings.poolTopupTokenPriceFactorBIPS.toUint16());
        return pool;
    }

    function createPoolToken(IICollateralPool _pool)
        external
        returns (address)
    {
        CollateralPoolToken poolToken = new CollateralPoolToken(payable(address(_pool)));
        return address(poolToken);
    }
}
