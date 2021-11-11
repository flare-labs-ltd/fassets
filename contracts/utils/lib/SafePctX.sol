// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";


library SafePctX {
    uint256 internal constant MAX_BIPS = 10000;
    
    function mulBips(uint256 x, uint256 y) internal pure returns (uint256) {
        return SafePct.mulDiv(x, y, MAX_BIPS);
    }
}
