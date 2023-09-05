// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IICollateralPool.sol";


/**
 * @title Collateral pool token factory
 */
interface ICollateralPoolTokenFactory {
    function create(
        IICollateralPool pool,
        string memory _systemSuffix,
        string memory _agentSuffix
    ) external
        returns (address);
}
