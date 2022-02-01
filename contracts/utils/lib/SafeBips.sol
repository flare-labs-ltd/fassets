// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./SafePct.sol";
import "./SafeMath64.sol";
import "./SafeMath128.sol";


library SafeBips {
    uint256 internal constant MAX_BIPS = 10000;
    
    function mulBips(uint256 x, uint256 y) internal pure returns (uint256) {
        return SafePct.mulDiv(x, y, MAX_BIPS);
    }

    function mulBips128(uint128 x, uint128 y) internal pure returns (uint256) {
        return SafeMath128.mulDiv(x, y, MAX_BIPS);
    }
    
    function mulBips64(uint64 x, uint64 y) internal pure returns (uint256) {
        return SafeMath64.mulDiv(x, y, MAX_BIPS);
    }
}
