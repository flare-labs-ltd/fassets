// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {CheckPointable} from "../implementation/CheckPointable.sol";

/**
 * @title CheckPointable mock contract
 * @notice A contract to instantiate the abstract CheckPointable contract for unit testing.
 **/
contract CheckPointableMock is CheckPointable {
    function burnForAtNow(address _owner, uint256 _amount) public {
        _burnForAtNow(_owner, _amount);
    }

    function mintForAtNow(address _owner, uint256 _amount) public {
        _mintForAtNow(_owner, _amount);
    }

    function transmitAtNow(address from, address to, uint256 _amount) public {
        _transmitAtNow(from, to, _amount);
    }

    function setCleanupBlockNumber(uint256 _blockNumber) public {
        _setCleanupBlockNumber(_blockNumber);
    }

    function getCleanupBlockNumber() public view returns (uint256) {
        return _cleanupBlockNumber();
    }
}
