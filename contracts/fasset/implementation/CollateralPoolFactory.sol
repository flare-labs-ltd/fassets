// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interfaces/IFAsset.sol";
import "../interfaces/ICollateralPoolFactory.sol";
import "./CollateralPool.sol";


contract CollateralPoolFactory is ICollateralPoolFactory, IERC165 {
    using SafeCast for uint256;

    function create(
        IIAssetManager _assetManager,
        address _agentVault,
        AgentSettings.Data memory _settings
    )
        external override
        returns (IICollateralPool)
    {
        address fAsset = address(_assetManager.fAsset());
        IICollateralPool pool = new CollateralPool(_agentVault, address(_assetManager), fAsset,
            _settings.poolExitCollateralRatioBIPS.toUint32(),
            _settings.poolTopupCollateralRatioBIPS.toUint32(),
            _settings.poolTopupTokenPriceFactorBIPS.toUint16());
        return pool;
    }

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(ICollateralPoolFactory).interfaceId;
    }
}
