// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {MathUtils} from "../../utils/lib/MathUtils.sol";


/**
 * @title MathUtils mock contract
 * @notice A contract to expose the MathUtils library for unit testing.
 **/
contract MathUtilsMock {
    function roundUp(uint256 x, uint256 rounding) external pure returns (uint256) {
        return MathUtils.roundUp(x, rounding);
    }
}
