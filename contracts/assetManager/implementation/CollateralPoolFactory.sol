// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../interfaces/ICollateralPoolFactory.sol";
import "./CollateralPool.sol";


contract CollateralPoolFactory is ICollateralPoolFactory, IERC165 {
    using SafeCast for uint256;

    address public implementation;

    constructor(address _implementation) {
        implementation = _implementation;
    }

    function create(
        IIAssetManager _assetManager,
        address _agentVault,
        AgentSettings.Data memory _settings
    )
        external override
        returns (IICollateralPool)
    {
        address fAsset = address(_assetManager.fAsset());
        ERC1967Proxy proxy = new ERC1967Proxy(implementation, new bytes(0));
        CollateralPool pool = CollateralPool(payable(address(proxy)));
        pool.initialize(_agentVault, address(_assetManager), fAsset,
            _settings.poolExitCollateralRatioBIPS.toUint32(),
            _settings.poolTopupCollateralRatioBIPS.toUint32(),
            _settings.poolTopupTokenPriceFactorBIPS.toUint16());
        return pool;
    }

    /**
     * Returns the encoded init call, to be used in ERC1967 upgradeToAndCall.
     */
    function upgradeInitCall(address /* _proxy */) external pure override returns (bytes memory) {
        // This is the simplest upgrade implementation - no init method needed on upgrade.
        // Future versions of the factory might return a non-trivial call.
        return new bytes(0);
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
