// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

library MathUtils {
    /**
     * Returns x when it is positive, otherwise 0.
     */
    function positivePart(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : 0;
    }

    /**
     * Increases the value `x` to a whole multiple of `rounding`.
     */
    function roundUp(uint256 x, uint256 rounding) internal pure returns (uint256) {
        // division by 0 and overflow checks preformed by Solidity >= 0.8
        uint256 remainder = x % rounding;
        return remainder == 0 ? x : x - remainder + rounding;
    }
}
