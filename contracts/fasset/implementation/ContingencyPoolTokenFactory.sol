// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../interface/IContingencyPoolTokenFactory.sol";
import "./ContingencyPoolToken.sol";


contract ContingencyPoolTokenFactory is IContingencyPoolTokenFactory, IERC165 {
    function create(IIContingencyPool _pool)
        external override
        returns (address)
    {
        ContingencyPoolToken poolToken = new ContingencyPoolToken(payable(address(_pool)));
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
            || _interfaceId == type(IContingencyPoolTokenFactory).interfaceId;
    }
}
