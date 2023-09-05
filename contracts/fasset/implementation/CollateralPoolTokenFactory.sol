// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../interface/ICollateralPoolTokenFactory.sol";
import "./CollateralPoolToken.sol";


contract CollateralPoolTokenFactory is ICollateralPoolTokenFactory, IERC165 {
    function create(IICollateralPool _pool, string memory _suffix)
        external override
        returns (address)
    {
        CollateralPoolToken poolToken = new CollateralPoolToken(payable(address(_pool)), _suffix);
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
