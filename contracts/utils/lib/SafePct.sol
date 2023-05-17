// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

/**
 * @dev Compute percentages safely without phantom overflows.
 *
 * Intermediate operations can overflow even when the result will always
 * fit into computed type. Developers usually
 * assume that overflows raise errors. `SafePct` restores this intuition by
 * reverting the transaction when such an operation overflows.
 *
 * Using this library instead of the unchecked operations eliminates an entire
 * class of bugs, so it's recommended to use it always.
 */
library SafePct {
    uint256 internal constant MAX_BIPS = 10_000;

    /**
     * Calculates `floor(x * y / z)`, reverting on overflow, but only if the result overflows.
     * Requirement: intermediate operations must revert on overflow.
     */
    function mulDiv(uint256 x, uint256 y, uint256 z) internal pure returns (uint256) {
        require(z > 0, "Division by zero");

        if (x == 0) return 0;
        unchecked {
            uint256 xy = x * y;
            if (xy / x == y) { // no overflow happened (works in unchecked)
                return xy / z;
            }
        }

        //slither-disable-next-line divide-before-multiply
        uint256 a = x / z;
        uint256 b = x % z; // x = a * z + b

        //slither-disable-next-line divide-before-multiply
        uint256 c = y / z;
        uint256 d = y % z; // y = c * z + d

        return (a * c * z) + (a * d) + (b * c) + (b * d / z);
    }

    /**
     * Calculates `ceiling(x * y / z)`.
     */
    function mulDivRoundUp(uint256 x, uint256 y, uint256 z) internal pure returns (uint256) {
        uint256 resultRoundDown = mulDiv(x, y, z);
        unchecked {
            // safe - if z == 0, above mulDiv call would revert
            uint256 remainder = mulmod(x, y, z);
            // safe - overflow only possible if z == 1, but then remainder == 0
            return remainder == 0 ? resultRoundDown : resultRoundDown + 1;
        }
    }

    /**
     * Return `x * y BIPS` = `x * y / 10_000`, rounded down.
     */
    function mulBips(uint256 x, uint256 y) internal pure returns (uint256) {
        return mulDiv(x, y, MAX_BIPS);
    }
}
