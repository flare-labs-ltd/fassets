// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

library MathUtils {
    /**
     * Increases the value `x` to a whole multiple of `rounding`.
     */
    function roundUp(uint256 x, uint256 rounding) internal pure returns (uint256) {
        // division by 0 and overflow checks preformed by Solidity >= 0.8
        uint256 remainder = x % rounding;
        return remainder == 0 ? x : x - remainder + rounding;
    }
}
