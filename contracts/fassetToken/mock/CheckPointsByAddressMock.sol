// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {CheckPointsByAddress} from "../library/CheckPointsByAddress.sol";

/**
 * @title Check Points By Address Mock contract
 * @notice A contract to stub checkpoint history for a collection of addresses library
 *  for unit testing.
 **/
contract CheckPointsByAddressMock {
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;

    CheckPointsByAddress.CheckPointsByAddressState private state;

    function valueOfAtNow(address _owner) public view returns (uint256) {
        return state.valueOfAtNow(_owner);
    }

    function valueOfAt(address _owner, uint256 _blockNumber) public view returns (uint256) {
        return state.valueOfAt(_owner, _blockNumber);
    }

    function transmit(address _from, address _to, uint256 _amount) public {
        state.transmit(_from, _to, _amount);
    }

    function writeValue(address _owner, uint256 _value) public {
        state.writeValue(_owner, _value);
    }

    function cleanupOldCheckpoints(address _owner, uint256 _count, uint256 _cleanupBlockNumber) public {
        state.cleanupOldCheckpoints(_owner, _count, _cleanupBlockNumber);
    }
}
