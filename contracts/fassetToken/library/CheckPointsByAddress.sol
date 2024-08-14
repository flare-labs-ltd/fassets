// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./CheckPointHistory.sol";


/**
 * @title Check Points By Address library
 * @notice A contract to manage checkpoint history for a collection of addresses.
 * @dev Store value history by address, and then by block number.
 **/
library CheckPointsByAddress {
    using SafeMath for uint256;
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;

    struct CheckPointsByAddressState {
        // `historyByAddress` is the map that stores the check point history of each address
        mapping(address => CheckPointHistory.CheckPointHistoryState) historyByAddress;
    }

    /**
    /**
     * @notice Send `amount` value to `to` address from `from` address.
     * @param _self A CheckPointsByAddressState instance to manage.
     * @param _from Address of the history of from values
     * @param _to Address of the history of to values
     * @param _amount The amount of value to be transferred
     **/
    function transmit(
        CheckPointsByAddressState storage _self,
        address _from,
        address _to,
        uint256 _amount
    )
        internal
    {
        // Shortcut
        if (_amount == 0) return;

        // Both from and to can never be zero
        assert(!(_from == address(0) && _to == address(0)));

        // Update transferer value
        if (_from != address(0)) {
            // Compute the new from balance
            uint256 newValueFrom = valueOfAtNow(_self, _from).sub(_amount);
            writeValue(_self, _from, newValueFrom);
        }

        // Update transferee value
        if (_to != address(0)) {
            // Compute the new to balance
            uint256 newValueTo = valueOfAtNow(_self, _to).add(_amount);
            writeValue(_self, _to, newValueTo);
        }
    }

    /**
     * @notice Queries the value of `_owner` at a specific `_blockNumber`.
     * @param _self A CheckPointsByAddressState instance to manage.
     * @param _owner The address from which the value will be retrieved.
     * @param _blockNumber The block number to query for the then current value.
     * @return The value at `_blockNumber` for `_owner`.
     **/
    function valueOfAt(
        CheckPointsByAddressState storage _self,
        address _owner,
        uint256 _blockNumber
    )
        internal view
        returns (uint256)
    {
        // Get history for _owner
        CheckPointHistory.CheckPointHistoryState storage history = _self.historyByAddress[_owner];
        // Return value at given block
        return history.valueAt(_blockNumber);
    }

    /**
     * @notice Get the value of the `_owner` at the current `block.number`.
     * @param _self A CheckPointsByAddressState instance to manage.
     * @param _owner The address of the value is being requested.
     * @return The value of `_owner` at the current block.
     **/
    function valueOfAtNow(CheckPointsByAddressState storage _self, address _owner) internal view returns (uint256) {
        // Get history for _owner
        CheckPointHistory.CheckPointHistoryState storage history = _self.historyByAddress[_owner];
        // Return value at now
        return history.valueAtNow();
    }

    /**
     * @notice Writes the `value` at the current block number for `_owner`.
     * @param _self A CheckPointsByAddressState instance to manage.
     * @param _owner The address of `_owner` to write.
     * @param _value The value to write.
     * @dev Sender must be the owner of the contract.
     **/
    function writeValue(
        CheckPointsByAddressState storage _self,
        address _owner,
        uint256 _value
    )
        internal
    {
        // Get history for _owner
        CheckPointHistory.CheckPointHistoryState storage history = _self.historyByAddress[_owner];
        // Write the value
        history.writeValue(_value);
    }

    /**
     * Delete at most `_count` of the oldest checkpoints.
     * At least one checkpoint at or before `_cleanupBlockNumber` will remain
     * (unless the history was empty to start with).
     */
    function cleanupOldCheckpoints(
        CheckPointsByAddressState storage _self,
        address _owner,
        uint256 _count,
        uint256 _cleanupBlockNumber
    )
        internal
        returns (uint256)
    {
        if (_owner != address(0)) {
            return _self.historyByAddress[_owner].cleanupOldCheckpoints(_count, _cleanupBlockNumber);
        }
        return 0;
    }
}
