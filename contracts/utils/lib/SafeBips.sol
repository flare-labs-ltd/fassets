// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./SafePct.sol";


library SafeBips {
    uint256 internal constant MAX_BIPS = 10000;
    
    function mulBips(uint256 x, uint256 y) internal pure returns (uint256) {
        return SafePct.mulDiv(x, y, MAX_BIPS);
    }
}
