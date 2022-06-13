// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {SafePct} from "../../utils/lib/SafePct.sol";


/**
 * @title SafePct mock contract
 * @notice A contract to expose the SafePct library for unit testing.
 **/
contract SafePctMock {
    
    function mulDiv(uint256 x, uint256 y, uint256 z) public pure returns (uint256) {
        return SafePct.mulDiv(x, y, z);
    }
}