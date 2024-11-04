// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
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
        ERC1967Proxy proxy = new ERC1967Proxy(implementation, new bytes(0));
        CollateralPoolToken poolToken = CollateralPoolToken(address(proxy));
        poolToken.initialize(address(_pool), tokenName, tokenSymbol);
        return address(poolToken);
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
            || _interfaceId == type(ICollateralPoolTokenFactory).interfaceId;
    }
}
