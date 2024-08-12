// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "../interfaces/ICollateralPoolTokenFactory.sol";
import "./CollateralPoolToken.sol";


contract CollateralPoolTokenFactory is ICollateralPoolTokenFactory, IERC165 {
    string internal constant TOKEN_NAME_PREFIX = "FAsset Collateral Pool Token ";
    string internal constant TOKEN_SYMBOL_PREFIX = "FCPT-";

    address public implementation;

    constructor(address _implementation) {
        implementation = _implementation;
    }

    function create(IICollateralPool _pool, string memory _systemSuffix, string memory _agentSuffix)
        external override
        returns (address)
    {
        string memory tokenName = string.concat(TOKEN_NAME_PREFIX, _systemSuffix, "-", _agentSuffix);
        string memory tokenSymbol = string.concat(TOKEN_SYMBOL_PREFIX, _systemSuffix, "-", _agentSuffix);
        address clone = Clones.clone(implementation);
        CollateralPoolToken poolToken = CollateralPoolToken(clone);
        poolToken.initialize(address(_pool), tokenName, tokenSymbol);
        return address(poolToken);
    }

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(ICollateralPoolTokenFactory).interfaceId;
    }
}
