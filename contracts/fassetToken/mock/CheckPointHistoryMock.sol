// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {CheckPointHistory} from "../library/CheckPointHistory.sol";

/**
 * @title Check Point History Mock contract
 * @notice A contract to stub the CheckPointHistory library for testing.
 **/
contract CheckPointHistoryMock {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;

    CheckPointHistory.CheckPointHistoryState private state;

    function valueAt(uint256 _blockNumber) public view returns (uint256 _value) {
        return state.valueAt(_blockNumber);
    }

    function valueAtNow() public view returns (uint256 _value) {
        return state.valueAtNow();
    }

    function writeValue(uint256 _value) public {
        state.writeValue(_value);
    }

    function cleanupOldCheckpoints(uint256 _count, uint256 _cleanupBlockNumber) public {
        state.cleanupOldCheckpoints(_count, _cleanupBlockNumber);
    }
}
