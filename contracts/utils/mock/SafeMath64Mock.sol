// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import {SafeMath64} from "../../utils/lib/SafeMath64.sol";

/**
 * @title SafeMath64 mock contract
 * @notice A contract to expose the SafeMath64 library for unit testing.
 **/
contract SafeMath64Mock {

    function toUint64(int256 a) public pure returns (uint64) {
        return SafeMath64.toUint64(a);
    }

    function toInt64(uint256 a) public pure returns (int64) {
        return SafeMath64.toInt64(a);
    }

    function sub64(uint64 a, uint64 b, string memory message) public pure returns (uint64) {
        return SafeMath64.sub64(a, b, message);
    }

}
