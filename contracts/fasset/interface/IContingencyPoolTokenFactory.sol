// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IIContingencyPool.sol";


/**
 * @title Collateral pool token factory
 */
interface IContingencyPoolTokenFactory {
    function create(IIContingencyPool pool)
        external
        returns (address);
}
