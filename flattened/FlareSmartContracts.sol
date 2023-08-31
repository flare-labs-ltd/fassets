// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

// Sources flattened with hardhat v2.4.3 https://hardhat.org

// File @openzeppelin/contracts/introspection/IERC165.sol@v3.4.0



/**
 * @dev Interface of the ERC165 standard, as defined in the
 * https://eips.ethereum.org/EIPS/eip-165[EIP].
 *
 * Implementers can declare support of contract interfaces, which can then be
 * queried by others ({ERC165Checker}).
 *
 * For an implementation, see {ERC165}.
 */
interface IERC165 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[EIP section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}


// File contracts/extra-imports.sol



// File @openzeppelin/contracts/math/Math.sol@v3.4.0



/**
 * @dev Standard math utilities missing in the Solidity language.
 */
library Math {
    /**
     * @dev Returns the largest of two numbers.
     */
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a : b;
    }

    /**
     * @dev Returns the smallest of two numbers.
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /**
     * @dev Returns the average of two numbers. The result is rounded towards
     * zero.
     */
    function average(uint256 a, uint256 b) internal pure returns (uint256) {
        // (a + b) / 2 can overflow, so we distribute
        return (a / 2) + (b / 2) + ((a % 2 + b % 2) / 2);
    }
}


// File @openzeppelin/contracts/math/SafeMath.sol@v3.4.0



/**
 * @dev Wrappers over Solidity's arithmetic operations with added overflow
 * checks.
 *
 * Arithmetic operations in Solidity wrap on overflow. This can easily result
 * in bugs, because programmers usually assume that an overflow raises an
 * error, which is the standard behavior in high level programming languages.
 * `SafeMath` restores this intuition by reverting the transaction when an
 * operation overflows.
 *
 * Using this library instead of the unchecked operations eliminates an entire
 * class of bugs, so it's recommended to use it always.
 */
library SafeMath {
    /**
     * @dev Returns the addition of two unsigned integers, with an overflow flag.
     *
     * _Available since v3.4._
     */
    function tryAdd(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        uint256 c = a + b;
        if (c < a) return (false, 0);
        return (true, c);
    }

    /**
     * @dev Returns the substraction of two unsigned integers, with an overflow flag.
     *
     * _Available since v3.4._
     */
    function trySub(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        if (b > a) return (false, 0);
        return (true, a - b);
    }

    /**
     * @dev Returns the multiplication of two unsigned integers, with an overflow flag.
     *
     * _Available since v3.4._
     */
    function tryMul(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        // Gas optimization: this is cheaper than requiring 'a' not being zero, but the
        // benefit is lost if 'b' is also tested.
        // See: https://github.com/OpenZeppelin/openzeppelin-contracts/pull/522
        if (a == 0) return (true, 0);
        uint256 c = a * b;
        if (c / a != b) return (false, 0);
        return (true, c);
    }

    /**
     * @dev Returns the division of two unsigned integers, with a division by zero flag.
     *
     * _Available since v3.4._
     */
    function tryDiv(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        if (b == 0) return (false, 0);
        return (true, a / b);
    }

    /**
     * @dev Returns the remainder of dividing two unsigned integers, with a division by zero flag.
     *
     * _Available since v3.4._
     */
    function tryMod(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        if (b == 0) return (false, 0);
        return (true, a % b);
    }

    /**
     * @dev Returns the addition of two unsigned integers, reverting on
     * overflow.
     *
     * Counterpart to Solidity's `+` operator.
     *
     * Requirements:
     *
     * - Addition cannot overflow.
     */
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "SafeMath: addition overflow");
        return c;
    }

    /**
     * @dev Returns the subtraction of two unsigned integers, reverting on
     * overflow (when the result is negative).
     *
     * Counterpart to Solidity's `-` operator.
     *
     * Requirements:
     *
     * - Subtraction cannot overflow.
     */
    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b <= a, "SafeMath: subtraction overflow");
        return a - b;
    }

    /**
     * @dev Returns the multiplication of two unsigned integers, reverting on
     * overflow.
     *
     * Counterpart to Solidity's `*` operator.
     *
     * Requirements:
     *
     * - Multiplication cannot overflow.
     */
    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        uint256 c = a * b;
        require(c / a == b, "SafeMath: multiplication overflow");
        return c;
    }

    /**
     * @dev Returns the integer division of two unsigned integers, reverting on
     * division by zero. The result is rounded towards zero.
     *
     * Counterpart to Solidity's `/` operator. Note: this function uses a
     * `revert` opcode (which leaves remaining gas untouched) while Solidity
     * uses an invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     *
     * - The divisor cannot be zero.
     */
    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b > 0, "SafeMath: division by zero");
        return a / b;
    }

    /**
     * @dev Returns the remainder of dividing two unsigned integers. (unsigned integer modulo),
     * reverting when dividing by zero.
     *
     * Counterpart to Solidity's `%` operator. This function uses a `revert`
     * opcode (which leaves remaining gas untouched) while Solidity uses an
     * invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     *
     * - The divisor cannot be zero.
     */
    function mod(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b > 0, "SafeMath: modulo by zero");
        return a % b;
    }

    /**
     * @dev Returns the subtraction of two unsigned integers, reverting with custom message on
     * overflow (when the result is negative).
     *
     * CAUTION: This function is deprecated because it requires allocating memory for the error
     * message unnecessarily. For custom revert reasons use {trySub}.
     *
     * Counterpart to Solidity's `-` operator.
     *
     * Requirements:
     *
     * - Subtraction cannot overflow.
     */
    function sub(uint256 a, uint256 b, string memory errorMessage) internal pure returns (uint256) {
        require(b <= a, errorMessage);
        return a - b;
    }

    /**
     * @dev Returns the integer division of two unsigned integers, reverting with custom message on
     * division by zero. The result is rounded towards zero.
     *
     * CAUTION: This function is deprecated because it requires allocating memory for the error
     * message unnecessarily. For custom revert reasons use {tryDiv}.
     *
     * Counterpart to Solidity's `/` operator. Note: this function uses a
     * `revert` opcode (which leaves remaining gas untouched) while Solidity
     * uses an invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     *
     * - The divisor cannot be zero.
     */
    function div(uint256 a, uint256 b, string memory errorMessage) internal pure returns (uint256) {
        require(b > 0, errorMessage);
        return a / b;
    }

    /**
     * @dev Returns the remainder of dividing two unsigned integers. (unsigned integer modulo),
     * reverting with custom message when dividing by zero.
     *
     * CAUTION: This function is deprecated because it requires allocating memory for the error
     * message unnecessarily. For custom revert reasons use {tryMod}.
     *
     * Counterpart to Solidity's `%` operator. This function uses a `revert`
     * opcode (which leaves remaining gas untouched) while Solidity uses an
     * invalid opcode to revert (consuming all remaining gas).
     *
     * Requirements:
     *
     * - The divisor cannot be zero.
     */
    function mod(uint256 a, uint256 b, string memory errorMessage) internal pure returns (uint256) {
        require(b > 0, errorMessage);
        return a % b;
    }
}


// File @openzeppelin/contracts/utils/SafeCast.sol@v3.4.0




/**
 * @dev Wrappers over Solidity's uintXX/intXX casting operators with added overflow
 * checks.
 *
 * Downcasting from uint256/int256 in Solidity does not revert on overflow. This can
 * easily result in undesired exploitation or bugs, since developers usually
 * assume that overflows raise errors. `SafeCast` restores this intuition by
 * reverting the transaction when such an operation overflows.
 *
 * Using this library instead of the unchecked operations eliminates an entire
 * class of bugs, so it's recommended to use it always.
 *
 * Can be combined with {SafeMath} and {SignedSafeMath} to extend it to smaller types, by performing
 * all math on `uint256` and `int256` and then downcasting.
 */
library SafeCast {

    /**
     * @dev Returns the downcasted uint128 from uint256, reverting on
     * overflow (when the input is greater than largest uint128).
     *
     * Counterpart to Solidity's `uint128` operator.
     *
     * Requirements:
     *
     * - input must fit into 128 bits
     */
    function toUint128(uint256 value) internal pure returns (uint128) {
        require(value < 2**128, "SafeCast: value doesn\'t fit in 128 bits");
        return uint128(value);
    }

    /**
     * @dev Returns the downcasted uint64 from uint256, reverting on
     * overflow (when the input is greater than largest uint64).
     *
     * Counterpart to Solidity's `uint64` operator.
     *
     * Requirements:
     *
     * - input must fit into 64 bits
     */
    function toUint64(uint256 value) internal pure returns (uint64) {
        require(value < 2**64, "SafeCast: value doesn\'t fit in 64 bits");
        return uint64(value);
    }

    /**
     * @dev Returns the downcasted uint32 from uint256, reverting on
     * overflow (when the input is greater than largest uint32).
     *
     * Counterpart to Solidity's `uint32` operator.
     *
     * Requirements:
     *
     * - input must fit into 32 bits
     */
    function toUint32(uint256 value) internal pure returns (uint32) {
        require(value < 2**32, "SafeCast: value doesn\'t fit in 32 bits");
        return uint32(value);
    }

    /**
     * @dev Returns the downcasted uint16 from uint256, reverting on
     * overflow (when the input is greater than largest uint16).
     *
     * Counterpart to Solidity's `uint16` operator.
     *
     * Requirements:
     *
     * - input must fit into 16 bits
     */
    function toUint16(uint256 value) internal pure returns (uint16) {
        require(value < 2**16, "SafeCast: value doesn\'t fit in 16 bits");
        return uint16(value);
    }

    /**
     * @dev Returns the downcasted uint8 from uint256, reverting on
     * overflow (when the input is greater than largest uint8).
     *
     * Counterpart to Solidity's `uint8` operator.
     *
     * Requirements:
     *
     * - input must fit into 8 bits.
     */
    function toUint8(uint256 value) internal pure returns (uint8) {
        require(value < 2**8, "SafeCast: value doesn\'t fit in 8 bits");
        return uint8(value);
    }

    /**
     * @dev Converts a signed int256 into an unsigned uint256.
     *
     * Requirements:
     *
     * - input must be greater than or equal to 0.
     */
    function toUint256(int256 value) internal pure returns (uint256) {
        require(value >= 0, "SafeCast: value must be positive");
        return uint256(value);
    }

    /**
     * @dev Returns the downcasted int128 from int256, reverting on
     * overflow (when the input is less than smallest int128 or
     * greater than largest int128).
     *
     * Counterpart to Solidity's `int128` operator.
     *
     * Requirements:
     *
     * - input must fit into 128 bits
     *
     * _Available since v3.1._
     */
    function toInt128(int256 value) internal pure returns (int128) {
        require(value >= -2**127 && value < 2**127, "SafeCast: value doesn\'t fit in 128 bits");
        return int128(value);
    }

    /**
     * @dev Returns the downcasted int64 from int256, reverting on
     * overflow (when the input is less than smallest int64 or
     * greater than largest int64).
     *
     * Counterpart to Solidity's `int64` operator.
     *
     * Requirements:
     *
     * - input must fit into 64 bits
     *
     * _Available since v3.1._
     */
    function toInt64(int256 value) internal pure returns (int64) {
        require(value >= -2**63 && value < 2**63, "SafeCast: value doesn\'t fit in 64 bits");
        return int64(value);
    }

    /**
     * @dev Returns the downcasted int32 from int256, reverting on
     * overflow (when the input is less than smallest int32 or
     * greater than largest int32).
     *
     * Counterpart to Solidity's `int32` operator.
     *
     * Requirements:
     *
     * - input must fit into 32 bits
     *
     * _Available since v3.1._
     */
    function toInt32(int256 value) internal pure returns (int32) {
        require(value >= -2**31 && value < 2**31, "SafeCast: value doesn\'t fit in 32 bits");
        return int32(value);
    }

    /**
     * @dev Returns the downcasted int16 from int256, reverting on
     * overflow (when the input is less than smallest int16 or
     * greater than largest int16).
     *
     * Counterpart to Solidity's `int16` operator.
     *
     * Requirements:
     *
     * - input must fit into 16 bits
     *
     * _Available since v3.1._
     */
    function toInt16(int256 value) internal pure returns (int16) {
        require(value >= -2**15 && value < 2**15, "SafeCast: value doesn\'t fit in 16 bits");
        return int16(value);
    }

    /**
     * @dev Returns the downcasted int8 from int256, reverting on
     * overflow (when the input is less than smallest int8 or
     * greater than largest int8).
     *
     * Counterpart to Solidity's `int8` operator.
     *
     * Requirements:
     *
     * - input must fit into 8 bits.
     *
     * _Available since v3.1._
     */
    function toInt8(int256 value) internal pure returns (int8) {
        require(value >= -2**7 && value < 2**7, "SafeCast: value doesn\'t fit in 8 bits");
        return int8(value);
    }

    /**
     * @dev Converts an unsigned uint256 into a signed int256.
     *
     * Requirements:
     *
     * - input must be less than or equal to maxInt256.
     */
    function toInt256(uint256 value) internal pure returns (int256) {
        require(value < 2**255, "SafeCast: value doesn't fit in an int256");
        return int256(value);
    }
}


// File contracts/token/lib/CheckPointHistory.sol




/**
 * @title Check Point History library
 * @notice A contract to manage checkpoints as of a given block.
 * @dev Store value history by block number with detachable state.
 **/
library CheckPointHistory {
    using SafeMath for uint256;
    using SafeCast for uint256;

    /**
     * @dev `CheckPoint` is the structure that attaches a block number to a
     *  given value; the block number attached is the one that last changed the
     *  value
     **/
    struct CheckPoint {
        // `value` is the amount of tokens at a specific block number
        uint192 value;
        // `fromBlock` is the block number that the value was generated from
        uint64 fromBlock;
    }

    struct CheckPointHistoryState {
        // `checkpoints` is an array that tracks values at non-contiguous block numbers
        mapping(uint256 => CheckPoint) checkpoints;
        // `checkpoints` before `startIndex` have been deleted
        // INVARIANT: checkpoints.endIndex == 0 || startIndex < checkpoints.endIndex      (strict!)
        // startIndex and endIndex are both less then fromBlock, so 64 bits is enough
        uint64 startIndex;
        // the index AFTER last
        uint64 endIndex;
    }

    /**
     * @notice Binary search of _checkpoints array.
     * @param _checkpoints An array of CheckPoint to search.
     * @param _startIndex Smallest possible index to be returned.
     * @param _blockNumber The block number to search for.
     */
    function _indexOfGreatestBlockLessThan(
        mapping(uint256 => CheckPoint) storage _checkpoints, 
        uint256 _startIndex,
        uint256 _endIndex,
        uint256 _blockNumber
    )
        private view 
        returns (uint256 index)
    {
        // Binary search of the value by given block number in the array
        uint256 min = _startIndex;
        uint256 max = _endIndex.sub(1);
        while (max > min) {
            uint256 mid = (max.add(min).add(1)).div(2);
            if (_checkpoints[mid].fromBlock <= _blockNumber) {
                min = mid;
            } else {
                max = mid.sub(1);
            }
        }
        return min;
    }

    /**
     * @notice Queries the value at a specific `_blockNumber`
     * @param _self A CheckPointHistoryState instance to manage.
     * @param _blockNumber The block number of the value active at that time
     * @return _value The value at `_blockNumber`     
     **/
    function valueAt(
        CheckPointHistoryState storage _self, 
        uint256 _blockNumber
    )
        internal view 
        returns (uint256 _value)
    {
        uint256 historyCount = _self.endIndex;

        // No _checkpoints, return 0
        if (historyCount == 0) return 0;

        // Shortcut for the actual value (extra optimized for current block, to save one storage read)
        // historyCount - 1 is safe, since historyCount != 0
        if (_blockNumber >= block.number || _blockNumber >= _self.checkpoints[historyCount - 1].fromBlock) {
            return _self.checkpoints[historyCount - 1].value;
        }
        
        // guard values at start    
        uint256 startIndex = _self.startIndex;
        if (_blockNumber < _self.checkpoints[startIndex].fromBlock) {
            // reading data before `startIndex` is only safe before first cleanup
            require(startIndex == 0, "CheckPointHistory: reading from cleaned-up block");
            return 0;
        }

        // Find the block with number less than or equal to block given
        uint256 index = _indexOfGreatestBlockLessThan(_self.checkpoints, startIndex, _self.endIndex, _blockNumber);

        return _self.checkpoints[index].value;
    }

    /**
     * @notice Queries the value at `block.number`
     * @param _self A CheckPointHistoryState instance to manage.
     * @return _value The value at `block.number`
     **/
    function valueAtNow(CheckPointHistoryState storage _self) internal view returns (uint256 _value) {
        uint256 historyCount = _self.endIndex;
        // No _checkpoints, return 0
        if (historyCount == 0) return 0;
        // Return last value
        return _self.checkpoints[historyCount - 1].value;
    }

    /**
     * @notice Writes the value at the current block.
     * @param _self A CheckPointHistoryState instance to manage.
     * @param _value Value to write.
     **/
    function writeValue(
        CheckPointHistoryState storage _self, 
        uint256 _value
    )
        internal
    {
        uint256 historyCount = _self.endIndex;
        if (historyCount == 0) {
            // checkpoints array empty, push new CheckPoint
            _self.checkpoints[0] = 
                CheckPoint({ fromBlock: block.number.toUint64(), value: _toUint192(_value) });
            _self.endIndex = 1;
        } else {
            // historyCount - 1 is safe, since historyCount != 0
            CheckPoint storage lastCheckpoint = _self.checkpoints[historyCount - 1];
            uint256 lastBlock = lastCheckpoint.fromBlock;
            // slither-disable-next-line incorrect-equality
            if (block.number == lastBlock) {
                // If last check point is the current block, just update
                lastCheckpoint.value = _toUint192(_value);
            } else {
                // we should never have future blocks in history
                assert (block.number > lastBlock);
                // push new CheckPoint
                _self.checkpoints[historyCount] = 
                    CheckPoint({ fromBlock: block.number.toUint64(), value: _toUint192(_value) });
                _self.endIndex = uint64(historyCount + 1);  // 64 bit safe, because historyCount <= block.number
            }
        }
    }
    
    /**
     * Delete at most `_count` of the oldest checkpoints.
     * At least one checkpoint at or before `_cleanupBlockNumber` will remain 
     * (unless the history was empty to start with).
     */    
    function cleanupOldCheckpoints(
        CheckPointHistoryState storage _self, 
        uint256 _count,
        uint256 _cleanupBlockNumber
    )
        internal
        returns (uint256)
    {
        if (_cleanupBlockNumber == 0) return 0;   // optimization for when cleaning is not enabled
        uint256 length = _self.endIndex;
        if (length == 0) return 0;
        uint256 startIndex = _self.startIndex;
        // length - 1 is safe, since length != 0 (check above)
        uint256 endIndex = Math.min(startIndex.add(_count), length - 1);    // last element can never be deleted
        uint256 index = startIndex;
        // we can delete `checkpoint[index]` while the next checkpoint is at `_cleanupBlockNumber` or before
        while (index < endIndex && _self.checkpoints[index + 1].fromBlock <= _cleanupBlockNumber) {
            delete _self.checkpoints[index];
            index++;
        }
        if (index > startIndex) {   // index is the first not deleted index
            _self.startIndex = index.toUint64();
        }
        return index - startIndex;  // safe: index >= startIndex at start and then increases
    }

    // SafeCast lib is missing cast to uint192    
    function _toUint192(uint256 _value) internal pure returns (uint192) {
        require(_value < 2**192, "value doesn't fit in 192 bits");
        return uint192(_value);
    }
}


// File contracts/token/lib/CheckPointsByAddress.sol



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


// File contracts/token/lib/CheckPointHistoryCache.sol



library CheckPointHistoryCache {
    using SafeMath for uint256;
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    
    struct CacheState {
        // mapping blockNumber => (value + 1)
        mapping(uint256 => uint256) cache;
    }
    
    function valueAt(
        CacheState storage _self,
        CheckPointHistory.CheckPointHistoryState storage _checkPointHistory,
        uint256 _blockNumber
    )
        internal returns (uint256 _value, bool _cacheCreated)
    {
        // is it in cache?
        uint256 cachedValue = _self.cache[_blockNumber];
        if (cachedValue != 0) {
            return (cachedValue - 1, false);    // safe, cachedValue != 0
        }
        // read from _checkPointHistory
        uint256 historyValue = _checkPointHistory.valueAt(_blockNumber);
        _self.cache[_blockNumber] = historyValue.add(1);  // store to cache (add 1 to differentiate from empty)
        return (historyValue, true);
    }
    
    function deleteAt(
        CacheState storage _self,
        uint256 _blockNumber
    )
        internal returns (uint256 _deleted)
    {
        if (_self.cache[_blockNumber] != 0) {
            _self.cache[_blockNumber] = 0;
            return 1;
        }
        return 0;
    }
}


// File contracts/token/implementation/CheckPointable.sol





/**
 * @title Check Pointable ERC20 Behavior
 * @notice ERC20 behavior which adds balance check point features.
 **/
abstract contract CheckPointable {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;
    using CheckPointHistoryCache for CheckPointHistoryCache.CacheState;
    using SafeMath for uint256;

    // The number of history cleanup steps executed for every write operation.
    // It is more than 1 to make as certain as possible that all history gets cleaned eventually.
    uint256 private constant CLEANUP_COUNT = 2;
    
    // Private member variables
    CheckPointsByAddress.CheckPointsByAddressState private balanceHistory;
    CheckPointHistory.CheckPointHistoryState private totalSupply;
    CheckPointHistoryCache.CacheState private totalSupplyCache;

    // Historic data for the blocks before `cleanupBlockNumber` can be erased,
    // history before that block should never be used since it can be inconsistent.
    uint256 private cleanupBlockNumber;
    
    // Address of the contract that is allowed to call methods for history cleaning.
    address public cleanerContract;
    
    /**
     * Emitted when a total supply cache entry is created.
     * Allows history cleaners to track total supply cache cleanup opportunities off-chain.
     */
    event CreatedTotalSupplyCache(uint256 _blockNumber);
    
    // Most cleanup opportunities can be deduced from standard event 
    // Transfer(from, to, amount):
    //   - balance history for `from` (if nonzero) and `to` (if nonzero)
    //   - total supply history when either `from` or `to` is zero
    
    modifier notBeforeCleanupBlock(uint256 _blockNumber) {
        require(_blockNumber >= cleanupBlockNumber, "CheckPointable: reading from cleaned-up block");
        _;
    }
    
    modifier onlyCleaner {
        require(msg.sender == cleanerContract, "Only cleaner contract");
        _;
    }
    
    /**
     * @dev Queries the token balance of `_owner` at a specific `_blockNumber`.
     * @param _owner The address from which the balance will be retrieved.
     * @param _blockNumber The block number when the balance is queried.
     * @return _balance The balance at `_blockNumber`.
     **/
    function balanceOfAt(address _owner, uint256 _blockNumber)
        public virtual view 
        notBeforeCleanupBlock(_blockNumber) 
        returns (uint256 _balance)
    {
        return balanceHistory.valueOfAt(_owner, _blockNumber);
    }

    /**
     * @notice Burn current token `amount` for `owner` of checkpoints at current block.
     * @param _owner The address of the owner to burn tokens.
     * @param _amount The amount to burn.
     */
    function _burnForAtNow(address _owner, uint256 _amount) internal virtual {
        uint256 newBalance = balanceOfAt(_owner, block.number).sub(_amount, "Burn too big for owner");
        balanceHistory.writeValue(_owner, newBalance);
        balanceHistory.cleanupOldCheckpoints(_owner, CLEANUP_COUNT, cleanupBlockNumber);
        totalSupply.writeValue(totalSupplyAt(block.number).sub(_amount, "Burn too big for total supply"));
        totalSupply.cleanupOldCheckpoints(CLEANUP_COUNT, cleanupBlockNumber);
    }

    /**
     * @notice Mint current token `amount` for `owner` of checkpoints at current block.
     * @param _owner The address of the owner to burn tokens.
     * @param _amount The amount to burn.
     */
    function _mintForAtNow(address _owner, uint256 _amount) internal virtual {
        uint256 newBalance = balanceOfAt(_owner, block.number).add(_amount);
        balanceHistory.writeValue(_owner, newBalance);
        balanceHistory.cleanupOldCheckpoints(_owner, CLEANUP_COUNT, cleanupBlockNumber);
        totalSupply.writeValue(totalSupplyAt(block.number).add(_amount));
        totalSupply.cleanupOldCheckpoints(CLEANUP_COUNT, cleanupBlockNumber);
    }

    /**
     * @notice Total amount of tokens at a specific `_blockNumber`.
     * @param _blockNumber The block number when the _totalSupply is queried
     * @return _totalSupply The total amount of tokens at `_blockNumber`
     **/
    function totalSupplyAt(uint256 _blockNumber)
        public virtual view 
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256 _totalSupply)
    {
        return totalSupply.valueAt(_blockNumber);
    }

    /**
     * @notice Total amount of tokens at a specific `_blockNumber`.
     * @param _blockNumber The block number when the _totalSupply is queried
     * @return _totalSupply The total amount of tokens at `_blockNumber`
     **/
    function _totalSupplyAtCached(uint256 _blockNumber) internal 
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256 _totalSupply)
    {
        // use cache only for the past (the value will never change)
        require(_blockNumber < block.number, "Can only be used for past blocks");
        (uint256 value, bool cacheCreated) = totalSupplyCache.valueAt(totalSupply, _blockNumber);
        if (cacheCreated) emit CreatedTotalSupplyCache(_blockNumber);
        return value;
    }

    /**
     * @notice Transmit token `_amount` `_from` address `_to` address of checkpoints at current block.
     * @param _from The address of the sender.
     * @param _to The address of the receiver.
     * @param _amount The amount to transmit.
     */
    function _transmitAtNow(address _from, address _to, uint256 _amount) internal virtual {
        balanceHistory.transmit(_from, _to, _amount);
        balanceHistory.cleanupOldCheckpoints(_from, CLEANUP_COUNT, cleanupBlockNumber);
        balanceHistory.cleanupOldCheckpoints(_to, CLEANUP_COUNT, cleanupBlockNumber);
    }
    
    /**
     * Set the cleanup block number.
     */
    function _setCleanupBlockNumber(uint256 _blockNumber) internal {
        require(_blockNumber >= cleanupBlockNumber, "Cleanup block number must never decrease");
        require(_blockNumber < block.number, "Cleanup block must be in the past");
        cleanupBlockNumber = _blockNumber;
    }

    /**
     * Get the cleanup block number.
     */
    function _cleanupBlockNumber() internal view returns (uint256) {
        return cleanupBlockNumber;
    }
    
    /**
     * @notice Update history at token transfer, the CheckPointable part of `_beforeTokenTransfer` hook.
     * @param _from The address of the sender.
     * @param _to The address of the receiver.
     * @param _amount The amount to transmit.
     */
    function _updateBalanceHistoryAtTransfer(address _from, address _to, uint256 _amount) internal virtual {
        if (_from == address(0)) {
            // mint checkpoint balance data for transferee
            _mintForAtNow(_to, _amount);
        } else if (_to == address(0)) {
            // burn checkpoint data for transferer
            _burnForAtNow(_from, _amount);
        } else {
            // transfer checkpoint balance data
            _transmitAtNow(_from, _to, _amount);
        }
    }

    // history cleanup methods

    /**
     * Set the contract that is allowed to call history cleaning methods.
     */
    function _setCleanerContract(address _cleanerContract) internal {
        cleanerContract = _cleanerContract;
    }

    /**
     * Delete balance checkpoints that expired (i.e. are before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _owner balance owner account address
     * @param _count maximum number of checkpoints to delete
     * @return the number of checkpoints deleted
     */    
    function balanceHistoryCleanup(address _owner, uint256 _count) external onlyCleaner returns (uint256) {
        return balanceHistory.cleanupOldCheckpoints(_owner, _count, cleanupBlockNumber);
    }
    
    /**
     * Delete total supply checkpoints that expired (i.e. are before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _count maximum number of checkpoints to delete
     * @return the number of checkpoints deleted
     */    
    function totalSupplyHistoryCleanup(uint256 _count) external onlyCleaner returns (uint256) {
        return totalSupply.cleanupOldCheckpoints(_count, cleanupBlockNumber);
    }
    
    /**
     * Delete total supply cache entry that expired (i.e. is before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _blockNumber the block number for which total supply value was cached
     * @return the number of cache entries deleted (always 0 or 1)
     */    
    function totalSupplyCacheCleanup(uint256 _blockNumber) external onlyCleaner returns (uint256) {
        require(_blockNumber < cleanupBlockNumber, "No cleanup after cleanup block");
        return totalSupplyCache.deleteAt(_blockNumber);
    }
}


// File @openzeppelin/contracts/utils/Context.sol@v3.4.0



/*
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with GSN meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address payable) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes memory) {
        this; // silence state mutability warning without generating bytecode - see https://github.com/ethereum/solidity/issues/2691
        return msg.data;
    }
}


// File @openzeppelin/contracts/token/ERC20/IERC20.sol@v3.4.0



/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface IERC20 {
    /**
     * @dev Returns the amount of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the amount of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves `amount` tokens from the caller's account to `recipient`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address recipient, uint256 amount) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets `amount` as the allowance of `spender` over the caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 amount) external returns (bool);

    /**
     * @dev Moves `amount` tokens from `sender` to `recipient` using the
     * allowance mechanism. `amount` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);
}


// File @openzeppelin/contracts/token/ERC20/ERC20.sol@v3.4.0





/**
 * @dev Implementation of the {IERC20} interface.
 *
 * This implementation is agnostic to the way tokens are created. This means
 * that a supply mechanism has to be added in a derived contract using {_mint}.
 * For a generic mechanism see {ERC20PresetMinterPauser}.
 *
 * TIP: For a detailed writeup see our guide
 * https://forum.zeppelin.solutions/t/how-to-implement-erc20-supply-mechanisms/226[How
 * to implement supply mechanisms].
 *
 * We have followed general OpenZeppelin guidelines: functions revert instead
 * of returning `false` on failure. This behavior is nonetheless conventional
 * and does not conflict with the expectations of ERC20 applications.
 *
 * Additionally, an {Approval} event is emitted on calls to {transferFrom}.
 * This allows applications to reconstruct the allowance for all accounts just
 * by listening to said events. Other implementations of the EIP may not emit
 * these events, as it isn't required by the specification.
 *
 * Finally, the non-standard {decreaseAllowance} and {increaseAllowance}
 * functions have been added to mitigate the well-known issues around setting
 * allowances. See {IERC20-approve}.
 */
contract ERC20 is Context, IERC20 {
    using SafeMath for uint256;

    mapping (address => uint256) private _balances;

    mapping (address => mapping (address => uint256)) private _allowances;

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    /**
     * @dev Sets the values for {name} and {symbol}, initializes {decimals} with
     * a default value of 18.
     *
     * To select a different value for {decimals}, use {_setupDecimals}.
     *
     * All three of these values are immutable: they can only be set once during
     * construction.
     */
    constructor (string memory name_, string memory symbol_) public {
        _name = name_;
        _symbol = symbol_;
        _decimals = 18;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5,05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei. This is the value {ERC20} uses, unless {_setupDecimals} is
     * called.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view virtual returns (uint8) {
        return _decimals;
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(address account) public view virtual override returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `recipient` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     */
    function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    /**
     * @dev See {IERC20-allowance}.
     */
    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        return _allowances[owner][spender];
    }

    /**
     * @dev See {IERC20-approve}.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Emits an {Approval} event indicating the updated allowance. This is not
     * required by the EIP. See the note at the beginning of {ERC20}.
     *
     * Requirements:
     *
     * - `sender` and `recipient` cannot be the zero address.
     * - `sender` must have a balance of at least `amount`.
     * - the caller must have allowance for ``sender``'s tokens of at least
     * `amount`.
     */
    function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(sender, recipient, amount);
        _approve(sender, _msgSender(), _allowances[sender][_msgSender()].sub(amount, "ERC20: transfer amount exceeds allowance"));
        return true;
    }

    /**
     * @dev Atomically increases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function increaseAllowance(address spender, uint256 addedValue) public virtual returns (bool) {
        _approve(_msgSender(), spender, _allowances[_msgSender()][spender].add(addedValue));
        return true;
    }

    /**
     * @dev Atomically decreases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `spender` must have allowance for the caller of at least
     * `subtractedValue`.
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) public virtual returns (bool) {
        _approve(_msgSender(), spender, _allowances[_msgSender()][spender].sub(subtractedValue, "ERC20: decreased allowance below zero"));
        return true;
    }

    /**
     * @dev Moves tokens `amount` from `sender` to `recipient`.
     *
     * This is internal function is equivalent to {transfer}, and can be used to
     * e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     * Emits a {Transfer} event.
     *
     * Requirements:
     *
     * - `sender` cannot be the zero address.
     * - `recipient` cannot be the zero address.
     * - `sender` must have a balance of at least `amount`.
     */
    function _transfer(address sender, address recipient, uint256 amount) internal virtual {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");

        _beforeTokenTransfer(sender, recipient, amount);

        _balances[sender] = _balances[sender].sub(amount, "ERC20: transfer amount exceeds balance");
        _balances[recipient] = _balances[recipient].add(amount);
        emit Transfer(sender, recipient, amount);
    }

    /** @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     */
    function _mint(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");

        _beforeTokenTransfer(address(0), account, amount);

        _totalSupply = _totalSupply.add(amount);
        _balances[account] = _balances[account].add(amount);
        emit Transfer(address(0), account, amount);
    }

    /**
     * @dev Destroys `amount` tokens from `account`, reducing the
     * total supply.
     *
     * Emits a {Transfer} event with `to` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     * - `account` must have at least `amount` tokens.
     */
    function _burn(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: burn from the zero address");

        _beforeTokenTransfer(account, address(0), amount);

        _balances[account] = _balances[account].sub(amount, "ERC20: burn amount exceeds balance");
        _totalSupply = _totalSupply.sub(amount);
        emit Transfer(account, address(0), amount);
    }

    /**
     * @dev Sets `amount` as the allowance of `spender` over the `owner` s tokens.
     *
     * This internal function is equivalent to `approve`, and can be used to
     * e.g. set automatic allowances for certain subsystems, etc.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `owner` cannot be the zero address.
     * - `spender` cannot be the zero address.
     */
    function _approve(address owner, address spender, uint256 amount) internal virtual {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    /**
     * @dev Sets {decimals} to a value other than the default one of 18.
     *
     * WARNING: This function should only be called from the constructor. Most
     * applications that interact with token contracts will not expect
     * {decimals} to ever change, and may work incorrectly if it does.
     */
    function _setupDecimals(uint8 decimals_) internal virtual {
        _decimals = decimals_;
    }

    /**
     * @dev Hook that is called before any transfer of tokens. This includes
     * minting and burning.
     *
     * Calling conditions:
     *
     * - when `from` and `to` are both non-zero, `amount` of ``from``'s tokens
     * will be to transferred to `to`.
     * - when `from` is zero, `amount` tokens will be minted for `to`.
     * - when `to` is zero, `amount` of ``from``'s tokens will be burned.
     * - `from` and `to` are never both zero.
     *
     * To learn more about hooks, head to xref:ROOT:extending-contracts.adoc#using-hooks[Using Hooks].
     */
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual { }
}


// File contracts/utils/implementation/SafePct.sol



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
 *
 * Can be combined with {SafeMath} and {SignedSafeMath} to extend it to smaller types, by performing
 * all math on `uint256` and `int256` and then downcasting.
 */
library SafePct {
    using SafeMath for uint256;
    /**
     * Requirements:
     *
     * - intermediate operations must revert on overflow
     */
    function mulDiv(uint256 x, uint256 y, uint256 z) internal pure returns (uint256) {
        require(z > 0, "Division by zero");

        if (x == 0) return 0;
        uint256 xy = x * y;
        if (xy / x == y) { // no overflow happened - same as in SafeMath mul
            return xy / z;
        }

        //slither-disable-next-line divide-before-multiply
        uint256 a = x / z;
        uint256 b = x % z; // x = a * z + b

        //slither-disable-next-line divide-before-multiply
        uint256 c = y / z;
        uint256 d = y % z; // y = c * z + d

        return (a.mul(c).mul(z)).add(a.mul(d)).add(b.mul(c)).add(b.mul(d).div(z));
    }
}


// File contracts/userInterfaces/IGovernanceVotePower.sol


interface IGovernanceVotePower {
    /**
     * @notice Delegate all governance vote power of `msg.sender` to `_to`.
     * @param _to The address of the recipient
     **/
    function delegate(address _to) external;

    /**
     * @notice Undelegate all governance vote power of `msg.sender``.
     **/
    function undelegate() external;

    /**
    * @notice Get the governance vote power of `_who` at block `_blockNumber`
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return _votePower    Governance vote power of `_who` at `_blockNumber`.
    */
    function votePowerOfAt(address _who, uint256 _blockNumber) external view returns(uint256);

    /**
    * @notice Get the vote power of `account` at the current block.
    * @param account The address to get voting power.
    * @return Vote power of `account` at the current block number.
    */    
    function getVotes(address account) external view returns (uint256);

    /**
    * @notice Get the delegate's address of `_who` at block `_blockNumber`
    * @param _who The address to get delegate's address.
    * @param _blockNumber The block number at which to fetch.
    * @return Delegate's address of `_who` at `_blockNumber`.
    */
    function getDelegateOfAt(address _who, uint256 _blockNumber) external view returns (address);

    /**
    * @notice Get the delegate's address of `_who` at the current block.
    * @param _who The address to get delegate's address.
    * @return Delegate's address of `_who` at the current block number.
    */    
    function getDelegateOfAtNow(address _who) external  view returns (address);

}


// File contracts/userInterfaces/IVPContractEvents.sol


interface IVPContractEvents {
    /**
     * Event triggered when an account delegates or undelegates another account. 
     * Definition: `votePowerFromTo(from, to)` is `changed` from `priorVotePower` to `newVotePower`.
     * For undelegation, `newVotePower` is 0.
     *
     * Note: the event is always emitted from VPToken's `writeVotePowerContract`.
     */
    event Delegate(address indexed from, address indexed to, uint256 priorVotePower, uint256 newVotePower);
    
    /**
     * Event triggered only when account `delegator` revokes delegation to `delegatee`
     * for a single block in the past (typically the current vote block).
     *
     * Note: the event is always emitted from VPToken's `writeVotePowerContract` and/or `readVotePowerContract`.
     */
    event Revoke(address indexed delegator, address indexed delegatee, uint256 votePower, uint256 blockNumber);
}


// File contracts/userInterfaces/IVPToken.sol




interface IVPToken is IERC20 {
    /**
     * @notice Delegate by percentage `_bips` of voting power to `_to` from `msg.sender`.
     * @param _to The address of the recipient
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cumulative - every call resets the delegation value (and value of 0 undelegates `to`).
     **/
    function delegate(address _to, uint256 _bips) external;
    
    /**
     * @notice Undelegate all percentage delegations from the sender and then delegate corresponding 
     *   `_bips` percentage of voting power from the sender to each member of `_delegatees`.
     * @param _delegatees The addresses of the new recipients.
     * @param _bips The percentages of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Total of all `_bips` values must be at most 10000.
     **/
    function batchDelegate(address[] memory _delegatees, uint256[] memory _bips) external;
        
    /**
     * @notice Explicitly delegate `_amount` of voting power to `_to` from `msg.sender`.
     * @param _to The address of the recipient
     * @param _amount An explicit vote power amount to be delegated.
     *   Not cumulative - every call resets the delegation value (and value of 0 undelegates `to`).
     **/    
    function delegateExplicit(address _to, uint _amount) external;

    /**
    * @notice Revoke all delegation from sender to `_who` at given block. 
    *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
    *    Block `_blockNumber` must be in the past. 
    *    This method should be used only to prevent rogue delegate voting in the current voting block.
    *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
    * @param _who Address of the delegatee
    * @param _blockNumber The block number at which to revoke delegation.
    */
    function revokeDelegationAt(address _who, uint _blockNumber) external;
    
    /**
     * @notice Undelegate all voting power for delegates of `msg.sender`
     *    Can only be used with percentage delegation.
     *    Does not reset delegation mode back to NOTSET.
     **/
    function undelegateAll() external;
    
    /**
     * @notice Undelegate all explicit vote power by amount delegates for `msg.sender`.
     *    Can only be used with explicit delegation.
     *    Does not reset delegation mode back to NOTSET.
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     * @return The amount still delegated (in case the list of delegates was incomplete).
     */
    function undelegateAllExplicit(address[] memory _delegateAddresses) external returns (uint256);


    /**
     * @dev Should be compatible with ERC20 method
     */
    function name() external view returns (string memory);

    /**
     * @dev Should be compatible with ERC20 method
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Should be compatible with ERC20 method
     */
    function decimals() external view returns (uint8);
    

    /**
     * @notice Total amount of tokens at a specific `_blockNumber`.
     * @param _blockNumber The block number when the totalSupply is queried
     * @return The total amount of tokens at `_blockNumber`
     **/
    function totalSupplyAt(uint _blockNumber) external view returns(uint256);

    /**
     * @dev Queries the token balance of `_owner` at a specific `_blockNumber`.
     * @param _owner The address from which the balance will be retrieved.
     * @param _blockNumber The block number when the balance is queried.
     * @return The balance at `_blockNumber`.
     **/
    function balanceOfAt(address _owner, uint _blockNumber) external view returns (uint256);

    
    /**
     * @notice Get the current total vote power.
     * @return The current total vote power (sum of all accounts' vote powers).
     */
    function totalVotePower() external view returns(uint256);
    
    /**
    * @notice Get the total vote power at block `_blockNumber`
    * @param _blockNumber The block number at which to fetch.
    * @return The total vote power at the block  (sum of all accounts' vote powers).
    */
    function totalVotePowerAt(uint _blockNumber) external view returns(uint256);

    /**
     * @notice Get the current vote power of `_owner`.
     * @param _owner The address to get voting power.
     * @return Current vote power of `_owner`.
     */
    function votePowerOf(address _owner) external view returns(uint256);
    
    /**
    * @notice Get the vote power of `_owner` at block `_blockNumber`
    * @param _owner The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_owner` at `_blockNumber`.
    */
    function votePowerOfAt(address _owner, uint256 _blockNumber) external view returns(uint256);

    /**
    * @notice Get the vote power of `_owner` at block `_blockNumber`, ignoring revocation information (and cache).
    * @param _owner The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_owner` at `_blockNumber`. Result doesn't change if vote power is revoked.
    */
    function votePowerOfAtIgnoringRevocation(address _owner, uint256 _blockNumber) external view returns(uint256);

    /**
     * @notice Get the delegation mode for '_who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value. Once the delegation mode is set, 
     *  it never changes, even if all delegations are removed.
     * @param _who The address to get delegation mode.
     * @return delegation mode: 0 = NOTSET, 1 = PERCENTAGE, 2 = AMOUNT (i.e. explicit)
     */
    function delegationModeOf(address _who) external view returns(uint256);
        
    /**
    * @notice Get current delegated vote power `_from` delegator delegated `_to` delegatee.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @return The delegated vote power.
    */
    function votePowerFromTo(address _from, address _to) external view returns(uint256);
    
    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _blockNumber The block number at which to fetch.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(address _from, address _to, uint _blockNumber) external view returns(uint256);
    
    /**
     * @notice Compute the current undelegated vote power of `_owner`
     * @param _owner The address to get undelegated voting power.
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOf(address _owner) external view returns(uint256);
    
    /**
     * @notice Get the undelegated vote power of `_owner` at given block.
     * @param _owner The address to get undelegated voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return The undelegated vote power of `_owner` (= owner's own balance minus all delegations from owner)
     */
    function undelegatedVotePowerOfAt(address _owner, uint256 _blockNumber) external view returns(uint256);
    
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `_bips` of `_who`. Returned in two separate positional arrays.
    * @param _who The address to get delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOf(address _who)
        external view 
        returns (
            address[] memory _delegateAddresses,
            uint256[] memory _bips,
            uint256 _count, 
            uint256 _delegationMode
        );
        
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `pcts` of `_who`. Returned in two separate positional arrays.
    * @param _who The address to get delegations.
    * @param _blockNumber The block for which we want to know the delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOfAt(address _who, uint256 _blockNumber)
        external view 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips, 
            uint256 _count, 
            uint256 _delegationMode
        );

    /**
     * Returns VPContract used for readonly operations (view methods).
     * The only non-view method that might be called on it is `revokeDelegationAt`.
     *
     * @notice `readVotePowerContract` is almost always equal to `writeVotePowerContract`
     * except during upgrade from one VPContract to a new version (which should happen
     * rarely or never and will be anounced before).
     *
     * @notice You shouldn't call any methods on VPContract directly, all are exposed
     * via VPToken (and state changing methods are forbidden from direct calls). 
     * This is the reason why this method returns `IVPContractEvents` - it should only be used
     * for listening to events (`Revoke` only).
     */
    function readVotePowerContract() external view returns (IVPContractEvents);

    /**
     * Returns VPContract used for state changing operations (non-view methods).
     * The only non-view method that might be called on it is `revokeDelegationAt`.
     *
     * @notice `writeVotePowerContract` is almost always equal to `readVotePowerContract`
     * except during upgrade from one VPContract to a new version (which should happen
     * rarely or never and will be anounced before). In the case of upgrade,
     * `writeVotePowerContract` will be replaced first to establish delegations, and
     * after some perio (e.g. after a reward epoch ends) `readVotePowerContract` will be set equal to it.
     *
     * @notice You shouldn't call any methods on VPContract directly, all are exposed
     * via VPToken (and state changing methods are forbidden from direct calls). 
     * This is the reason why this method returns `IVPContractEvents` - it should only be used
     * for listening to events (`Delegate` and `Revoke` only).
     */
    function writeVotePowerContract() external view returns (IVPContractEvents);
    
    /**
     * When set, allows token owners to participate in governance voting
     * and delegate governance vote power.
     */
    function governanceVotePower() external view returns (IGovernanceVotePower);
}


// File contracts/token/interface/IICleanable.sol


interface IICleanable {
    /**
     * Set the contract that is allowed to call history cleaning methods.
     */
    function setCleanerContract(address _cleanerContract) external;
    
    /**
     * Set the cleanup block number.
     * Historic data for the blocks before `cleanupBlockNumber` can be erased,
     * history before that block should never be used since it can be inconsistent.
     * In particular, cleanup block number must be before current vote power block.
     * @param _blockNumber The new cleanup block number.
     */
    function setCleanupBlockNumber(uint256 _blockNumber) external;
    
    /**
     * Get the current cleanup block number.
     */
    function cleanupBlockNumber() external view returns (uint256);
}


// File contracts/token/interface/IIVPContract.sol




interface IIVPContract is IICleanable, IVPContractEvents {
    /**
     * Update vote powers when tokens are transfered.
     * Also update delegated vote powers for percentage delegation
     * and check for enough funds for explicit delegations.
     **/
    function updateAtTokenTransfer(
        address _from, 
        address _to, 
        uint256 _fromBalance,
        uint256 _toBalance,
        uint256 _amount
    ) external;

    /**
     * @notice Delegate `_bips` percentage of voting power to `_to` from `_from`
     * @param _from The address of the delegator
     * @param _to The address of the recipient
     * @param _balance The delegator's current balance
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cumulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/
    function delegate(
        address _from, 
        address _to, 
        uint256 _balance, 
        uint256 _bips
    ) external;
    
    /**
     * @notice Explicitly delegate `_amount` of voting power to `_to` from `msg.sender`.
     * @param _from The address of the delegator
     * @param _to The address of the recipient
     * @param _balance The delegator's current balance
     * @param _amount An explicit vote power amount to be delegated.
     *   Not cumulative - every call resets the delegation value (and value of 0 undelegates `to`).
     **/    
    function delegateExplicit(
        address _from, 
        address _to, 
        uint256 _balance, 
        uint _amount
    ) external;    

    /**
     * @notice Revoke all delegation from sender to `_who` at given block. 
     *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
     *    Block `_blockNumber` must be in the past. 
     *    This method should be used only to prevent rogue delegate voting in the current voting block.
     *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
     * @param _from The address of the delegator
     * @param _who Address of the delegatee
     * @param _balance The delegator's current balance
     * @param _blockNumber The block number at which to revoke delegation.
     **/
    function revokeDelegationAt(
        address _from, 
        address _who, 
        uint256 _balance,
        uint _blockNumber
    ) external;
    
        /**
     * @notice Undelegate all voting power for delegates of `msg.sender`
     *    Can only be used with percentage delegation.
     *    Does not reset delegation mode back to NOTSET.
     * @param _from The address of the delegator
     **/
    function undelegateAll(
        address _from,
        uint256 _balance
    ) external;
    
    /**
     * @notice Undelegate all explicit vote power by amount delegates for `msg.sender`.
     *    Can only be used with explicit delegation.
     *    Does not reset delegation mode back to NOTSET.
     * @param _from The address of the delegator
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     * @return The amount still delegated (in case the list of delegates was incomplete).
     */
    function undelegateAllExplicit(
        address _from, 
        address[] memory _delegateAddresses
    ) external returns (uint256);
    
    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`
    *   Reads/updates cache and upholds revocations.
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function votePowerOfAtCached(address _who, uint256 _blockNumber) external returns(uint256);
    
    /**
     * @notice Get the current vote power of `_who`.
     * @param _who The address to get voting power.
     * @return Current vote power of `_who`.
     */
    function votePowerOf(address _who) external view returns(uint256);
    
    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function votePowerOfAt(address _who, uint256 _blockNumber) external view returns(uint256);

    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`, ignoring revocation information (and cache).
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`. Result doesn't change if vote power is revoked.
    */
    function votePowerOfAtIgnoringRevocation(address _who, uint256 _blockNumber) external view returns(uint256);

    /**
     * Return vote powers for several addresses in a batch.
     * @param _owners The list of addresses to fetch vote power of.
     * @param _blockNumber The block number at which to fetch.
     * @return A list of vote powers.
     */    
    function batchVotePowerOfAt(
        address[] memory _owners, 
        uint256 _blockNumber
    )
        external view returns(uint256[] memory);

    /**
    * @notice Get current delegated vote power `_from` delegator delegated `_to` delegatee.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _balance The delegator's current balance
    * @return The delegated vote power.
    */
    function votePowerFromTo(
        address _from, 
        address _to, 
        uint256 _balance
    ) external view returns(uint256);
    
    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _balance The delegator's current balance
    * @param _blockNumber The block number at which to fetch.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(
        address _from, 
        address _to, 
        uint256 _balance,
        uint _blockNumber
    ) external view returns(uint256);

    /**
     * @notice Compute the current undelegated vote power of `_owner`
     * @param _owner The address to get undelegated voting power.
     * @param _balance Owner's current balance
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOf(
        address _owner,
        uint256 _balance
    ) external view returns(uint256);

    /**
     * @notice Get the undelegated vote power of `_owner` at given block.
     * @param _owner The address to get undelegated voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return The undelegated vote power of `_owner` (= owner's own balance minus all delegations from owner)
     */
    function undelegatedVotePowerOfAt(
        address _owner, 
        uint256 _balance,
        uint256 _blockNumber
    ) external view returns(uint256);

    /**
     * @notice Get the delegation mode for '_who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value.
     * @param _who The address to get delegation mode.
     * @return Delegation mode (NOTSET=0, PERCENTAGE=1, AMOUNT=2))
     */
    function delegationModeOf(address _who) external view returns (uint256);
    
    /**
    * @notice Get the vote power delegation `_delegateAddresses` 
    *  and `pcts` of an `_owner`. Returned in two separate positional arrays.
    * @param _owner The address to get delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOf(
        address _owner
    )
        external view 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        );

    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `pcts` of an `_owner`. Returned in two separate positional arrays.
    * @param _owner The address to get delegations.
    * @param _blockNumber The block for which we want to know the delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOfAt(
        address _owner,
        uint256 _blockNumber
    )
        external view 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        );

    /**
     * The VPToken (or some other contract) that owns this VPContract.
     * All state changing methods may be called only from this address.
     * This is because original msg.sender is sent in `_from` parameter
     * and we must be sure that it cannot be faked by directly calling VPContract.
     * Owner token is also used in case of replacement to recover vote powers from balances.
     */
    function ownerToken() external view returns (IVPToken);
    
    /**
     * Return true if this IIVPContract is configured to be used as a replacement for other contract.
     * It means that vote powers are not necessarily correct at the initialization, therefore
     * every method that reads vote power must check whether it is initialized for that address and block.
     */
    function isReplacement() external view returns (bool);
}


// File contracts/token/interface/IIGovernanceVotePower.sol



interface IIGovernanceVotePower is IGovernanceVotePower {
    /**
     * Event triggered when an delegator's balance changes.
     *
     * Note: the event is always emitted from `GovernanceVotePower`.
     */
    event DelegateVotesChanged(
    address indexed delegate, 
    uint256 previousBalance, 
    uint256 newBalance
    );

    /**
     * Event triggered when an account delegates to another account.
     *
     * Note: the event is always emitted from `GovernanceVotePower`.
     */
    event DelegateChanged(
    address indexed delegator, 
    address indexed fromDelegate, 
    address indexed toDelegate
    );

    /**
     * Update vote powers when tokens are transfered.
     **/
    function updateAtTokenTransfer(
        address _from,
        address _to,
        uint256 _fromBalance,
        uint256 _toBalance,
        uint256 _amount
    ) external;

    /**
     * Set the cleanup block number.
     * Historic data for the blocks before `cleanupBlockNumber` can be erased,
     * history before that block should never be used since it can be inconsistent.
     * In particular, cleanup block number must be before current vote power block.
     * @param _blockNumber The new cleanup block number.
     */
    function setCleanupBlockNumber(uint256 _blockNumber) external;

    /**
     * Set the contract that is allowed to call history cleaning methods.
     */
    function setCleanerContract(address _cleanerContract) external;

    /**
     * @notice Get the token that this governance vote power contract belongs to.
     */
    function ownerToken() external view returns (IVPToken);

    function getCleanupBlockNumber() external view returns(uint256);
}


// File contracts/token/interface/IIVPToken.sol






interface IIVPToken is IVPToken, IICleanable {
    /**
     * Set the contract that is allowed to set cleanupBlockNumber.
     * Usually this will be an instance of CleanupBlockNumberManager.
     */
    function setCleanupBlockNumberManager(address _cleanupBlockNumberManager) external;
    
    /**
     * Sets new governance vote power contract that allows token owners to participate in governance voting
     * and delegate governance vote power. 
     */
    function setGovernanceVotePower(IIGovernanceVotePower _governanceVotePower) external;
    
    /**
    * @notice Get the total vote power at block `_blockNumber` using cache.
    *   It tries to read the cached value and if not found, reads the actual value and stores it in cache.
    *   Can only be used if `_blockNumber` is in the past, otherwise reverts.    
    * @param _blockNumber The block number at which to fetch.
    * @return The total vote power at the block (sum of all accounts' vote powers).
    */
    function totalVotePowerAtCached(uint256 _blockNumber) external returns(uint256);
    
    /**
    * @notice Get the vote power of `_owner` at block `_blockNumber` using cache.
    *   It tries to read the cached value and if not found, reads the actual value and stores it in cache.
    *   Can only be used if _blockNumber is in the past, otherwise reverts.    
    * @param _owner The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_owner` at `_blockNumber`.
    */
    function votePowerOfAtCached(address _owner, uint256 _blockNumber) external returns(uint256);

    /**
     * Return vote powers for several addresses in a batch.
     * @param _owners The list of addresses to fetch vote power of.
     * @param _blockNumber The block number at which to fetch.
     * @return A list of vote powers.
     */    
    function batchVotePowerOfAt(
        address[] memory _owners, 
        uint256 _blockNumber
    ) external view returns(uint256[] memory);
}


// File contracts/userInterfaces/IGovernanceSettings.sol



/**
 * A special contract that holds Flare governance address.
 * This contract enables updating governance address and timelock only by hard forking the network,
 * meaning only by updating validator code.
 */
interface IGovernanceSettings {
    /**
     * Get the governance account address.
     * The governance address can only be changed by a hardfork.
     */
    function getGovernanceAddress() external view returns (address);
    
    /**
     * Get the time in seconds that must pass between a governance call and execution.
     * The timelock value can only be changed by a hardfork.
     */
    function getTimelock() external view returns (uint256);
    
    /**
     * Get the addresses of the accounts that are allowed to execute the timelocked governance calls
     * once the timelock period expires.
     * Executors can be changed without a hardfork, via a normal governance call.
     */
    function getExecutors() external view returns (address[] memory);
    
    /**
     * Check whether an address is one of the executors.
     */
    function isExecutor(address _address) external view returns (bool);
}


// File contracts/governance/implementation/GovernedBase.sol


/**
 * @title Governed Base
 * @notice This abstract base class defines behaviors for a governed contract.
 * @dev This class is abstract so that specific behaviors can be defined for the constructor.
 *   Contracts should not be left ungoverned, but not all contract will have a constructor
 *   (for example those pre-defined in genesis).
 **/
abstract contract GovernedBase {
    struct TimelockedCall {
        uint256 allowedAfterTimestamp;
        bytes encodedCall;
    }
    
    // solhint-disable-next-line const-name-snakecase
    IGovernanceSettings public constant governanceSettings = 
        IGovernanceSettings(0x1000000000000000000000000000000000000007);

    address private initialGovernance;

    bool private initialised;
    
    bool public productionMode;
    
    bool private executing;
    
    mapping(bytes4 => TimelockedCall) public timelockedCalls;
    
    event GovernanceCallTimelocked(bytes4 selector, uint256 allowedAfterTimestamp, bytes encodedCall);
    event TimelockedGovernanceCallExecuted(bytes4 selector, uint256 timestamp);
    event TimelockedGovernanceCallCanceled(bytes4 selector, uint256 timestamp);
    
    event GovernanceInitialised(address initialGovernance);
    event GovernedProductionModeEntered(address governanceSettings);
    
    modifier onlyGovernance {
        if (executing || !productionMode) {
            _beforeExecute();
            _;
        } else {
            _recordTimelockedCall(msg.data);
        }
    }
    
    modifier onlyImmediateGovernance () {
        _checkOnlyGovernance();
        _;
    }

    constructor(address _initialGovernance) {
        if (_initialGovernance != address(0)) {
            initialise(_initialGovernance);
        }
    }

    /**
     * @notice Execute the timelocked governance calls once the timelock period expires.
     * @dev Only executor can call this method.
     * @param _selector The method selector (only one timelocked call per method is stored).
     */
    function executeGovernanceCall(bytes4 _selector) external {
        require(governanceSettings.isExecutor(msg.sender), "only executor");
        TimelockedCall storage call = timelockedCalls[_selector];
        require(call.allowedAfterTimestamp != 0, "timelock: invalid selector");
        require(block.timestamp >= call.allowedAfterTimestamp, "timelock: not allowed yet");
        bytes memory encodedCall = call.encodedCall;
        delete timelockedCalls[_selector];
        executing = true;
        //solhint-disable-next-line avoid-low-level-calls
        (bool success,) = address(this).call(encodedCall);
        executing = false;
        emit TimelockedGovernanceCallExecuted(_selector, block.timestamp);
        _passReturnOrRevert(success);
    }
    
    /**
     * Cancel a timelocked governance call before it has been executed.
     * @dev Only governance can call this method.
     * @param _selector The method selector.
     */
    function cancelGovernanceCall(bytes4 _selector) external onlyImmediateGovernance {
        require(timelockedCalls[_selector].allowedAfterTimestamp != 0, "timelock: invalid selector");
        emit TimelockedGovernanceCallCanceled(_selector, block.timestamp);
        delete timelockedCalls[_selector];
    }
    
    /**
     * Enter the production mode after all the initial governance settings have been set.
     * This enables timelocks and the governance is afterwards obtained by calling 
     * governanceSettings.getGovernanceAddress(). 
     */
    function switchToProductionMode() external {
        _checkOnlyGovernance();
        require(!productionMode, "already in production mode");
        initialGovernance = address(0);
        productionMode = true;
        emit GovernedProductionModeEntered(address(governanceSettings));
    }

    /**
     * @notice Initialize the governance address if not first initialized.
     */
    function initialise(address _initialGovernance) public virtual {
        require(initialised == false, "initialised != false");
        initialised = true;
        initialGovernance = _initialGovernance;
        emit GovernanceInitialised(_initialGovernance);
    }
    
    /**
     * Returns the current effective governance address.
     */
    function governance() public view returns (address) {
        return productionMode ? governanceSettings.getGovernanceAddress() : initialGovernance;
    }

    function _beforeExecute() private {
        if (executing) {
            // can only be run from executeGovernanceCall(), where we check that only executor can call
            // make sure nothing else gets executed, even in case of reentrancy
            assert(msg.sender == address(this));
            executing = false;
        } else {
            // must be called with: productionMode=false
            // must check governance in this case
            _checkOnlyGovernance();
        }
    }

    function _recordTimelockedCall(bytes calldata _data) private {
        _checkOnlyGovernance();
        bytes4 selector;
        //solhint-disable-next-line no-inline-assembly
        assembly {
            selector := calldataload(_data.offset)
        }
        uint256 timelock = governanceSettings.getTimelock();
        uint256 allowedAt = block.timestamp + timelock;
        timelockedCalls[selector] = TimelockedCall({
            allowedAfterTimestamp: allowedAt,
            encodedCall: _data
        });
        emit GovernanceCallTimelocked(selector, allowedAt, _data);
    }
    
    function _checkOnlyGovernance() private view {
        require(msg.sender == governance(), "only governance");
    }
    
    function _passReturnOrRevert(bool _success) private pure {
        // pass exact return or revert data - needs to be done in assembly
        //solhint-disable-next-line no-inline-assembly
        assembly {
            let size := returndatasize()
            let ptr := mload(0x40)
            mstore(0x40, add(ptr, size))
            returndatacopy(ptr, 0, size)
            if _success {
                return(ptr, size)
            }
            revert(ptr, size)
        }
    }
}


// File contracts/governance/implementation/Governed.sol


/**
 * @title Governed
 * @dev For deployed, governed contracts, enforce a non-zero address at create time.
 **/
contract Governed is GovernedBase {
    constructor(address _governance) GovernedBase(_governance) {
        require(_governance != address(0), "_governance zero");
    }
}


// File contracts/token/implementation/VPToken.sol












/**
 * @title Vote Power Token
 * @dev An ERC20 token to enable the holder to delegate voting power
 *  equal 1-1 to their balance, with history tracking by block.
 **/
contract VPToken is IIVPToken, ERC20, CheckPointable, Governed {
    using SafeMath for uint256;
    using SafePct for uint256;

    // the VPContract to use for reading vote powers and delegations
    IIVPContract private readVpContract;

    // the VPContract to use for writing vote powers and delegations
    // normally same as `readVpContract` except during switch
    // when reading happens from the old and writing goes to the new VPContract
    IIVPContract private writeVpContract;
    
    // the contract to use for governance vote power and delegation
    // here only to properly update governance vp during transfers -
    // all actual operations go directly to governance vp contract
    IIGovernanceVotePower private governanceVP;
    
    // the contract that is allowed to set cleanupBlockNumber
    // usually this will be an instance of CleanupBlockNumberManager
    address public cleanupBlockNumberManager;
    
    /**
     * When true, the argument to `setWriteVpContract` must be a vpContract
     * with `isReplacement` set to `true`. To be used for creating the correct VPContract.
     */
    bool public vpContractInitialized = false;

    /**
     * Event used to track history of VPToken -> VPContract / GovernanceVotePower 
     * associations (e.g. by external cleaners).
     * @param _contractType 0 = read VPContract, 1 = write VPContract, 2 = governance vote power
     * @param _oldContractAddress vote power contract address before change
     * @param _newContractAddress vote power contract address after change
     */ 
    event VotePowerContractChanged(uint256 _contractType, address _oldContractAddress, address _newContractAddress);
    
    constructor(
        address _governance,
        //slither-disable-next-line shadowing-local
        string memory _name, 
        //slither-disable-next-line shadowing-local
        string memory _symbol
    )
        Governed(_governance) ERC20(_name, _symbol) 
    {
        /* empty block */
    }
    
    /**
     * @dev Should be compatible with ERC20 method
     */
    function name() public view override(ERC20, IVPToken) returns (string memory) {
        return ERC20.name();
    }

    /**
     * @dev Should be compatible with ERC20 method
     */
    function symbol() public view override(ERC20, IVPToken) returns (string memory) {
        return ERC20.symbol();
    }

    /**
     * @dev Should be compatible with ERC20 method
     */
    function decimals() public view override(ERC20, IVPToken) returns (uint8) {
        return ERC20.decimals();
    }

    /**
     * @notice Total amount of tokens at a specific `_blockNumber`.
     * @param _blockNumber The block number when the totalSupply is queried
     * @return The total amount of tokens at `_blockNumber`
     **/
    function totalSupplyAt(uint256 _blockNumber) public view override(CheckPointable, IVPToken) returns(uint256) {
        return CheckPointable.totalSupplyAt(_blockNumber);
    }

    /**
     * @dev Queries the token balance of `_owner` at a specific `_blockNumber`.
     * @param _owner The address from which the balance will be retrieved.
     * @param _blockNumber The block number when the balance is queried.
     * @return The balance at `_blockNumber`.
     **/
    function balanceOfAt(
        address _owner, 
        uint256 _blockNumber
    )
        public view 
        override(CheckPointable, IVPToken)
        returns (uint256)
    {
        return CheckPointable.balanceOfAt(_owner, _blockNumber);
    }
    
    /**
     * @notice Delegate `_bips` of voting power to `_to` from `msg.sender`
     * @param _to The address of the recipient
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cumulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/
    function delegate(address _to, uint256 _bips) external override {
        // Get the current balance of sender and delegate by percentage _to recipient
        _checkWriteVpContract().delegate(msg.sender, _to, balanceOf(msg.sender), _bips);
    }

    /**
     * @notice Undelegate all percentage delegations from the sender and then delegate corresponding 
     *   `_bips` percentage of voting power from the sender to each member of `_delegatees`.
     * @param _delegatees The addresses of the new recipients.
     * @param _bips The percentages of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Total of all `_bips` values must be at most 10000.
     **/
    function batchDelegate(address[] memory _delegatees, uint256[] memory _bips) external override {
        require(_delegatees.length == _bips.length, "Array length mismatch");
        IIVPContract vpContract = _checkWriteVpContract();
        uint256 balance = balanceOf(msg.sender);
        vpContract.undelegateAll(msg.sender, balance);
        for (uint256 i = 0; i < _delegatees.length; i++) {
            vpContract.delegate(msg.sender, _delegatees[i], balance, _bips[i]);
        }
    }
    
    /**
     * @notice Delegate `_amount` of voting power to `_to` from `msg.sender`
     * @param _to The address of the recipient
     * @param _amount An explicit vote power amount to be delegated.
     *   Not cumulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/    
    function delegateExplicit(address _to, uint256 _amount) external override {
        _checkWriteVpContract().delegateExplicit(msg.sender, _to, balanceOf(msg.sender), _amount);
    }

    /**
     * @notice Compute the current undelegated vote power of `_owner`
     * @param _owner The address to get undelegated voting power.
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOf(address _owner) external view override returns(uint256) {
        return _checkReadVpContract().undelegatedVotePowerOf(_owner, balanceOf(_owner));
    }

    /**
     * @notice Get the undelegated vote power of `_owner` at given block.
     * @param _owner The address to get undelegated voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOfAt(address _owner, uint256 _blockNumber) external view override returns (uint256) {
        return _checkReadVpContract()
            .undelegatedVotePowerOfAt(_owner, balanceOfAt(_owner, _blockNumber), _blockNumber);
    }

    /**
     * @notice Undelegate all voting power for delegates of `msg.sender`
     **/
    function undelegateAll() external override {
        _checkWriteVpContract().undelegateAll(msg.sender, balanceOf(msg.sender));
    }

    /**
     * @notice Undelegate all explicit vote power by amount delegates for `msg.sender`.
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     * @return _remainingDelegation The amount still delegated (in case the list of delegates was incomplete).
     */
    function undelegateAllExplicit(
        address[] memory _delegateAddresses
    )
        external override 
        returns (uint256 _remainingDelegation)
    {
        return _checkWriteVpContract().undelegateAllExplicit(msg.sender, _delegateAddresses);
    }
    
    /**
    * @notice Revoke all delegation from sender to `_who` at given block. 
    *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
    *    Block `_blockNumber` must be in the past. 
    *    This method should be used only to prevent rogue delegate voting in the current voting block.
    *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
    */
    function revokeDelegationAt(address _who, uint256 _blockNumber) public override {
        IIVPContract writeVPC = writeVpContract;
        IIVPContract readVPC = readVpContract;
        if (address(writeVPC) != address(0)) {
            writeVPC.revokeDelegationAt(msg.sender, _who, balanceOfAt(msg.sender, _blockNumber), _blockNumber);
        }
        if (address(readVPC) != address(writeVPC) && address(readVPC) != address(0)) {
            try readVPC.revokeDelegationAt(msg.sender, _who, balanceOfAt(msg.sender, _blockNumber), _blockNumber) {
            } catch {
                // do nothing
            }
        }
    }

    /**
    * @notice Get current delegated vote power `_from` delegator delegated `_to` delegatee.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @return votePower The delegated vote power.
    */
    function votePowerFromTo(
        address _from, 
        address _to
    )
        external view override 
        returns(uint256)
    {
        return _checkReadVpContract().votePowerFromTo(_from, _to, balanceOf(_from));
    }
    
    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _blockNumber The block number at which to fetch.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(
        address _from, 
        address _to, 
        uint256 _blockNumber
    )
        external view override 
        returns(uint256)
    {
        return _checkReadVpContract().votePowerFromToAt(_from, _to, balanceOfAt(_from, _blockNumber), _blockNumber);
    }
    
    /**
     * @notice Get the current total vote power.
     * @return The current total vote power (sum of all accounts' vote powers).
     */
    function totalVotePower() external view override returns(uint256) {
        return totalSupply();
    }

    /**
    * @notice Get the total vote power at block `_blockNumber`
    * @param _blockNumber The block number at which to fetch.
    * @return The total vote power at the block  (sum of all accounts' vote powers).
    */
    function totalVotePowerAt(uint256 _blockNumber) external view override returns(uint256) {
        return totalSupplyAt(_blockNumber);
    }

    /**
    * @notice Get the total vote power at block `_blockNumber` using cache.
    *   It tries to read the cached value and if not found, reads the actual value and stores it in cache.
    *   Can only be used if `_blockNumber` is in the past, otherwise reverts.    
    * @param _blockNumber The block number at which to fetch.
    * @return The total vote power at the block (sum of all accounts' vote powers).
    */
    function totalVotePowerAtCached(uint256 _blockNumber) public override returns(uint256) {
        return _totalSupplyAtCached(_blockNumber);
    }
    
    /**
     * @notice Get the delegation mode for '_who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value. Once the delegation mode is set, 
     *  it never changes, even if all delegations are removed.
     * @param _who The address to get delegation mode.
     * @return delegation mode: 0 = NOTSET, 1 = PERCENTAGE, 2 = AMOUNT (i.e. explicit)
     */
    function delegationModeOf(address _who) external view override returns (uint256) {
        return _checkReadVpContract().delegationModeOf(_who);
    }

    /**
     * @notice Get the current vote power of `_owner`.
     * @param _owner The address to get voting power.
     * @return Current vote power of `_owner`.
     */
    function votePowerOf(address _owner) external view override returns(uint256) {
        return _checkReadVpContract().votePowerOf(_owner);
    }


    /**
    * @notice Get the vote power of `_owner` at block `_blockNumber`
    * @param _owner The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_owner` at `_blockNumber`.
    */
    function votePowerOfAt(address _owner, uint256 _blockNumber) external view override returns(uint256) {
        return _checkReadVpContract().votePowerOfAt(_owner, _blockNumber);
    }

    /**
    * @notice Get the vote power of `_owner` at block `_blockNumber`, ignoring revocation information (and cache).
    * @param _owner The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_owner` at `_blockNumber`. Result doesn't change if vote power is revoked.
    */
    function votePowerOfAtIgnoringRevocation(address _owner, uint256 _blockNumber)
        external view override
        returns(uint256) 
    {
        return _checkReadVpContract().votePowerOfAtIgnoringRevocation(_owner, _blockNumber);
    }

    /**
     * Return vote powers for several addresses in a batch.
     * @param _owners The list of addresses to fetch vote power of.
     * @param _blockNumber The block number at which to fetch.
     * @return A list of vote powers.
     */    
    function batchVotePowerOfAt(
        address[] memory _owners, 
        uint256 _blockNumber
    )
        external view override 
        returns(uint256[] memory)
    {
        return _checkReadVpContract().batchVotePowerOfAt(_owners, _blockNumber);
    }
    
    /**
    * @notice Get the vote power of `_owner` at block `_blockNumber` using cache.
    *   It tries to read the cached value and if not found, reads the actual value and stores it in cache.
    *   Can only be used if _blockNumber is in the past, otherwise reverts.    
    * @param _owner The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_owner` at `_blockNumber`.
    */
    function votePowerOfAtCached(address _owner, uint256 _blockNumber) public override returns(uint256) {
        return _checkReadVpContract().votePowerOfAtCached(_owner, _blockNumber);
    }
    
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `_bips` of `_who`. Returned in two separate positional arrays.
    * @param _owner The address to get delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOf(
        address _owner
    )
        external view override 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
        return _checkReadVpContract().delegatesOf(_owner);
    }
    
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `pcts` of `_who`. Returned in two separate positional arrays.
    * @param _owner The address to get delegations.
    * @param _blockNumber The block for which we want to know the delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOfAt(
        address _owner,
        uint256 _blockNumber
    )
        external view override 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
        return _checkReadVpContract().delegatesOfAt(_owner, _blockNumber);
    }

    // Update vote power and balance checkpoints before balances are modified. This is implemented
    // in the _beforeTokenTransfer hook, which is executed for _mint, _burn, and _transfer operations.
    function _beforeTokenTransfer(
        address _from, 
        address _to, 
        uint256 _amount
    )
        internal virtual 
        override(ERC20)
    {
        require(_from != _to, "Cannot transfer to self");
        
        uint256 fromBalance = _from != address(0) ? balanceOf(_from) : 0;
        uint256 toBalance = _to != address(0) ? balanceOf(_to) : 0;
        
        // update vote powers
        IIVPContract vpc = writeVpContract;
        if (address(vpc) != address(0)) {
            vpc.updateAtTokenTransfer(_from, _to, fromBalance, toBalance, _amount);
        } else if (!vpContractInitialized) {
            // transfers without vpcontract are allowed, but after they are made
            // any added vpcontract must have isReplacement set
            vpContractInitialized = true;
        }
        
        // update governance vote powers
        IIGovernanceVotePower gvp = governanceVP;
        if (address(gvp) != address(0)) {
            gvp.updateAtTokenTransfer(_from, _to, fromBalance, toBalance, _amount);
        }

        // update balance history
        _updateBalanceHistoryAtTransfer(_from, _to, _amount);
    }

    /**
     * Call from governance to set read VpContract on token, e.g. 
     * `vpToken.setReadVpContract(new VPContract(vpToken))`
     * Read VPContract must be set before any of the VPToken delegation or vote power reading methods are called, 
     * otherwise they will revert.
     * NOTE: If readVpContract differs from writeVpContract all reads will be "frozen" and will not reflect
     * changes (not even revokes; they may or may not reflect balance transfers).
     * @param _vpContract Read vote power contract to be used by this token.
     */
    function setReadVpContract(IIVPContract _vpContract) external onlyGovernance {
        if (address(_vpContract) != address(0)) {
            require(address(_vpContract.ownerToken()) == address(this),
                "VPContract not owned by this token");
            // set contract's cleanup block
            _vpContract.setCleanupBlockNumber(_cleanupBlockNumber());
        }
        emit VotePowerContractChanged(0, address(readVpContract), address(_vpContract));
        readVpContract = _vpContract;
    }

    /**
     * Call from governance to set write VpContract on token, e.g. 
     * `vpToken.setWriteVpContract(new VPContract(vpToken))`
     * Write VPContract must be set before any of the VPToken delegation modifying methods are called, 
     * otherwise they will revert.
     * @param _vpContract Write vote power contract to be used by this token.
     */
    function setWriteVpContract(IIVPContract _vpContract) external onlyGovernance {
        if (address(_vpContract) != address(0)) {
            require(address(_vpContract.ownerToken()) == address(this),
                "VPContract not owned by this token");
            require(!vpContractInitialized || _vpContract.isReplacement(),
                "VPContract not configured for replacement");
            // set contract's cleanup block
            _vpContract.setCleanupBlockNumber(_cleanupBlockNumber());
            // once a non-null vpcontract is set, every other has to have isReplacement flag set
            vpContractInitialized = true;
        }
        emit VotePowerContractChanged(1, address(writeVpContract), address(_vpContract));
        writeVpContract = _vpContract;
    }
    
    /**
     * Return read vpContract, ensuring that it is not zero.
     */
    function _checkReadVpContract() internal view returns (IIVPContract) {
        IIVPContract vpc = readVpContract;
        require(address(vpc) != address(0), "Token missing read VPContract");
        return vpc;
    }

    /**
     * Return write vpContract, ensuring that it is not zero.
     */
    function _checkWriteVpContract() internal view returns (IIVPContract) {
        IIVPContract vpc = writeVpContract;
        require(address(vpc) != address(0), "Token missing write VPContract");
        return vpc;
    }
    
    /**
     * Return vpContract use for reading, may be zero.
     */
    function _getReadVpContract() internal view returns (IIVPContract) {
        return readVpContract;
    }

    /**
     * Return vpContract use for writing, may be zero.
     */
    function _getWriteVpContract() internal view returns (IIVPContract) {
        return writeVpContract;
    }

    /**
     * Returns VPContract event interface used for readonly operations (view methods).
     */
    function readVotePowerContract() external view override returns (IVPContractEvents) {
        return readVpContract;
    }

    /**
     * Returns VPContract event interface used for state changing operations (non-view methods).
     */
    function writeVotePowerContract() external view override returns (IVPContractEvents) {
        return writeVpContract;
    }

    /**
     * Set the cleanup block number.
     * Historic data for the blocks before `cleanupBlockNumber` can be erased,
     * history before that block should never be used since it can be inconsistent.
     * In particular, cleanup block number must be before current vote power block.
     * @param _blockNumber The new cleanup block number.
     */
    function setCleanupBlockNumber(uint256 _blockNumber) external override {
        require(msg.sender == cleanupBlockNumberManager, "only cleanup block manager");
        _setCleanupBlockNumber(_blockNumber);
        if (address(readVpContract) != address(0)) {
            readVpContract.setCleanupBlockNumber(_blockNumber);
        }
        if (address(writeVpContract) != address(0) && address(writeVpContract) != address(readVpContract)) {
            writeVpContract.setCleanupBlockNumber(_blockNumber);
        }
        if (address(governanceVP) != address(0)) {
            governanceVP.setCleanupBlockNumber(_blockNumber);
        }
    }
    
    /**
     * Get the current cleanup block number.
     */
    function cleanupBlockNumber() external view override returns (uint256) {
        return _cleanupBlockNumber();
    }
    
    /**
     * Set the contract that is allowed to set cleanupBlockNumber.
     * Usually this will be an instance of CleanupBlockNumberManager.
     */
    function setCleanupBlockNumberManager(address _cleanupBlockNumberManager) external override onlyGovernance {
        cleanupBlockNumberManager = _cleanupBlockNumberManager;
    }
    
    /**
     * Set the contract that is allowed to call history cleaning methods.
     */
    function setCleanerContract(address _cleanerContract) external override onlyGovernance {
        _setCleanerContract(_cleanerContract);
        if (address(readVpContract) != address(0)) {
            readVpContract.setCleanerContract(_cleanerContract);
        }
        if (address(writeVpContract) != address(0) && address(writeVpContract) != address(readVpContract)) {
            writeVpContract.setCleanerContract(_cleanerContract);
        }
        if (address(governanceVP) != address(0)) {
            governanceVP.setCleanerContract(_cleanerContract);
        }
    }
    
    /**
     * Sets new governance vote power contract that allows token owners to participate in governance voting
     * and delegate governance vote power. 
     */
    function setGovernanceVotePower(IIGovernanceVotePower _governanceVotePower) external override onlyGovernance {
        require(address(_governanceVotePower.ownerToken()) == address(this), 
            "Governance vote power contract does not belong to this token.");
        emit VotePowerContractChanged(2, address(governanceVP), address(_governanceVotePower));
        governanceVP = _governanceVotePower;
    }

    /**
     * When set, allows token owners to participate in governance voting
     * and delegate governance vote power. 
     */
     function governanceVotePower() external view override returns (IGovernanceVotePower) {
         return governanceVP;
     }
}


// File contracts/token/lib/DelegationHistory.sol





/**
 * @title DelegationHistory library
 * @notice A contract to manage checkpoints as of a given block.
 * @dev Store value history by block number with detachable state.
 **/
library DelegationHistory {
    using SafeMath for uint256;
    using SafePct for uint256;
    using SafeCast for uint256;

    uint256 public constant MAX_DELEGATES_BY_PERCENT = 2;
    string private constant MAX_DELEGATES_MSG = "Max delegates exceeded";
    
    struct Delegation {
        address delegate;
        uint16 value;
        
        // delegations[0] will also hold length and blockNumber to save 1 slot of storage per checkpoint
        // for all other indexes these fields will be 0
        // also, when checkpoint is empty, `length` will automatically be 0, which is ok
        uint64 fromBlock;
        uint8 length;       // length is limited to MAX_DELEGATES_BY_PERCENT which fits in 8 bits
    }
    
    /**
     * @dev `CheckPoint` is the structure that attaches a block number to a
     *  given value; the block number attached is the one that last changed the
     *  value
     **/
    struct CheckPoint {
        // the list of delegations at the time
        mapping(uint256 => Delegation) delegations;
    }

    struct CheckPointHistoryState {
        // `checkpoints` is an array that tracks delegations at non-contiguous block numbers
        mapping(uint256 => CheckPoint) checkpoints;
        // `checkpoints` before `startIndex` have been deleted
        // INVARIANT: checkpoints.length == 0 || startIndex < checkpoints.length      (strict!)
        uint64 startIndex;
        uint64 length;
    }

    /**
     * @notice Queries the value at a specific `_blockNumber`
     * @param _self A CheckPointHistoryState instance to manage.
     * @param _delegate The delegate for which we need value.
     * @param _blockNumber The block number of the value active at that time
     * @return _value The value of the `_delegate` at `_blockNumber`     
     **/
    function valueOfAt(
        CheckPointHistoryState storage _self, 
        address _delegate, 
        uint256 _blockNumber
    )
        internal view 
        returns (uint256 _value)
    {
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self, _blockNumber);
        if (!found) return 0;
        return _getValueForDelegate(_self.checkpoints[index], _delegate);
    }

    /**
     * @notice Queries the value at `block.number`
     * @param _self A CheckPointHistoryState instance to manage.
     * @param _delegate The delegate for which we need value.
     * @return _value The value at `block.number`
     **/
    function valueOfAtNow(
        CheckPointHistoryState storage _self, 
        address _delegate
    )
        internal view
        returns (uint256 _value)
    {
        uint256 length = _self.length;
        if (length == 0) return 0;
        return _getValueForDelegate(_self.checkpoints[length - 1], _delegate);
    }

    /**
     * @notice Writes the value at the current block.
     * @param _self A CheckPointHistoryState instance to manage.
     * @param _delegate The delegate tu update.
     * @param _value The new value to set for this delegate (value `0` deletes `_delegate` from the list).
     **/
    function writeValue(
        CheckPointHistoryState storage _self, 
        address _delegate, 
        uint256 _value
    )
        internal
    {
        uint256 historyCount = _self.length;
        if (historyCount == 0) {
            // checkpoints array empty, push new CheckPoint
            if (_value != 0) {
                CheckPoint storage cp = _self.checkpoints[historyCount];
                _self.length = SafeCast.toUint64(historyCount + 1);
                cp.delegations[0] = Delegation({ 
                    delegate: _delegate,
                    value: _value.toUint16(),
                    fromBlock:  block.number.toUint64(),
                    length: 1 
                });
            }
        } else {
            // historyCount - 1 is safe, since historyCount != 0
            CheckPoint storage lastCheckpoint = _self.checkpoints[historyCount - 1];
            uint256 lastBlock = lastCheckpoint.delegations[0].fromBlock;
            // slither-disable-next-line incorrect-equality
            if (block.number == lastBlock) {
                // If last check point is the current block, just update
                _updateDelegates(lastCheckpoint, _delegate, _value);
            } else {
                // we should never have future blocks in history
                assert(block.number > lastBlock); 
                // last check point block is before
                CheckPoint storage cp = _self.checkpoints[historyCount];
                _self.length = SafeCast.toUint64(historyCount + 1);
                _copyAndUpdateDelegates(cp, lastCheckpoint, _delegate, _value);
                cp.delegations[0].fromBlock = block.number.toUint64();
            }
        }
    }
    
    /**
     * Get all percentage delegations active at a time.
     * @param _self A CheckPointHistoryState instance to manage.
     * @param _blockNumber The block number to query. 
     * @return _delegates The active percentage delegates at the time. 
     * @return _values The delegates' values at the time. 
     **/
    function delegationsAt(
        CheckPointHistoryState storage _self,
        uint256 _blockNumber
    )
        internal view
        returns (
            address[] memory _delegates,
            uint256[] memory _values
        )
    {
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self, _blockNumber);
        if (!found) {
            return (new address[](0), new uint256[](0));
        }

        // copy delegates and values to memory arrays
        // (to prevent caller updating the stored value)
        CheckPoint storage cp = _self.checkpoints[index];
        uint256 length = cp.delegations[0].length;
        _delegates = new address[](length);
        _values = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            Delegation storage dlg = cp.delegations[i];
            _delegates[i] = dlg.delegate;
            _values[i] = dlg.value;
        }
    }
    
    /**
     * Get all percentage delegations active now.
     * @param _self A CheckPointHistoryState instance to manage.
     * @return _delegates The active percentage delegates. 
     * @return _values The delegates' values. 
     **/
    function delegationsAtNow(
        CheckPointHistoryState storage _self
    )
        internal view
        returns (address[] memory _delegates, uint256[] memory _values)
    {
        return delegationsAt(_self, block.number);
    }
    
    /**
     * Get all percentage delegations active now.
     * @param _self A CheckPointHistoryState instance to manage.
     * @return _length The number of delegations. 
     * @return _delegations . 
     **/
    function delegationsAtNowRaw(
        CheckPointHistoryState storage _self
    )
        internal view
        returns (
            uint256 _length, 
            mapping(uint256 => Delegation) storage _delegations
        )
    {
        uint256 length = _self.length;
        if (length == 0) {
            return (0, _self.checkpoints[0].delegations);
        }
        CheckPoint storage cp = _self.checkpoints[length - 1];
        return (cp.delegations[0].length, cp.delegations);
    }
    
    /**
     * Get the number of delegations.
     * @param _self A CheckPointHistoryState instance to query.
     * @param _blockNumber The block number to query. 
     * @return _count Count of delegations at the time.
     **/
    function countAt(
        CheckPointHistoryState storage _self,
        uint256 _blockNumber
    )
        internal view
        returns (uint256 _count)
    {
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self, _blockNumber);
        if (!found) return 0;
        return _self.checkpoints[index].delegations[0].length;
    }
    
    /**
     * Get the sum of all delegation values.
     * @param _self A CheckPointHistoryState instance to query.
     * @param _blockNumber The block number to query. 
     * @return _total Total delegation value at the time.
     **/
    function totalValueAt(
        CheckPointHistoryState storage _self, 
        uint256 _blockNumber
    )
        internal view
        returns (uint256 _total)
    {
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self, _blockNumber);
        if (!found) return 0;
        
        CheckPoint storage cp = _self.checkpoints[index];
        uint256 length = cp.delegations[0].length;
        _total = 0;
        for (uint256 i = 0; i < length; i++) {
            _total = _total.add(cp.delegations[i].value);
        }
    }

    /**
     * Get the sum of all delegation values.
     * @param _self A CheckPointHistoryState instance to query.
     * @return _total Total delegation value at the time.
     **/
    function totalValueAtNow(
        CheckPointHistoryState storage _self
    )
        internal view
        returns (uint256 _total)
    {
        return totalValueAt(_self, block.number);
    }

    /**
     * Get the sum of all delegation values, every one scaled by `_mul/_div`.
     * @param _self A CheckPointHistoryState instance to query.
     * @param _mul The multiplier.
     * @param _div The divisor.
     * @param _blockNumber The block number to query. 
     * @return _total Total scaled delegation value at the time.
     **/
    function scaledTotalValueAt(
        CheckPointHistoryState storage _self, 
        uint256 _mul,
        uint256 _div,
        uint256 _blockNumber
    )
        internal view
        returns (uint256 _total)
    {
        (bool found, uint256 index) = _findGreatestBlockLessThan(_self, _blockNumber);
        if (!found) return 0;
        
        CheckPoint storage cp = _self.checkpoints[index];
        uint256 length = cp.delegations[0].length;
        _total = 0;
        for (uint256 i = 0; i < length; i++) {
            _total = _total.add(uint256(cp.delegations[i].value).mulDiv(_mul, _div));
        }
    }

    /**
     * Clear all delegations at this moment.
     * @param _self A CheckPointHistoryState instance to manage.
     */    
    function clear(CheckPointHistoryState storage _self) internal {
        uint256 historyCount = _self.length;
        if (historyCount > 0) {
            // add an empty checkpoint
            CheckPoint storage cp = _self.checkpoints[historyCount];
            _self.length = SafeCast.toUint64(historyCount + 1);
            // create empty checkpoint = only set fromBlock
            cp.delegations[0] = Delegation({ 
                delegate: address(0),
                value: 0,
                fromBlock: block.number.toUint64(),
                length: 0
            });
        }
    }

    /**
     * Delete at most `_count` of the oldest checkpoints.
     * At least one checkpoint at or before `_cleanupBlockNumber` will remain 
     * (unless the history was empty to start with).
     */    
    function cleanupOldCheckpoints(
        CheckPointHistoryState storage _self, 
        uint256 _count,
        uint256 _cleanupBlockNumber
    )
        internal
        returns (uint256)
    {
        if (_cleanupBlockNumber == 0) return 0;   // optimization for when cleaning is not enabled
        uint256 length = _self.length;
        if (length == 0) return 0;
        uint256 startIndex = _self.startIndex;
        // length - 1 is safe, since length != 0 (check above)
        uint256 endIndex = Math.min(startIndex.add(_count), length - 1);    // last element can never be deleted
        uint256 index = startIndex;
        // we can delete `checkpoint[index]` while the next checkpoint is at `_cleanupBlockNumber` or before
        while (index < endIndex && _self.checkpoints[index + 1].delegations[0].fromBlock <= _cleanupBlockNumber) {
            CheckPoint storage cp = _self.checkpoints[index];
            uint256 cplength = cp.delegations[0].length;
            for (uint256 i = 0; i < cplength; i++) {
                delete cp.delegations[i];
            }
            index++;
        }
        if (index > startIndex) {   // index is the first not deleted index
            _self.startIndex = SafeCast.toUint64(index);
        }
        return index - startIndex;  // safe: index = startIndex at start and increases in loop
    }

    /////////////////////////////////////////////////////////////////////////////////
    // helper functions for writeValueAt
    
    function _copyAndUpdateDelegates(
        CheckPoint storage _cp, 
        CheckPoint storage _orig, 
        address _delegate, 
        uint256 _value
    )
        private
    {
        uint256 length = _orig.delegations[0].length;
        bool updated = false;
        uint256 newlength = 0;
        for (uint256 i = 0; i < length; i++) {
            Delegation memory origDlg = _orig.delegations[i];
            if (origDlg.delegate == _delegate) {
                // copy delegate, but with new value
                newlength = _appendDelegate(_cp, origDlg.delegate, _value, newlength);
                updated = true;
            } else {
                // just copy the delegate with original value
                newlength = _appendDelegate(_cp, origDlg.delegate, origDlg.value, newlength);
            }
        }
        if (!updated) {
            // delegate is not in the original list, so add it
            newlength = _appendDelegate(_cp, _delegate, _value, newlength);
        }
        // safe - newlength <= length + 1 <= MAX_DELEGATES_BY_PERCENT
        _cp.delegations[0].length = uint8(newlength);
    }

    function _updateDelegates(CheckPoint storage _cp, address _delegate, uint256 _value) private {
        uint256 length = _cp.delegations[0].length;
        uint256 i = 0;
        while (i < length && _cp.delegations[i].delegate != _delegate) ++i;
        if (i < length) {
            if (_value != 0) {
                _cp.delegations[i].value = _value.toUint16();
            } else {
                _deleteDelegate(_cp, i, length - 1);  // length - 1 is safe:  0 <= i < length
                _cp.delegations[0].length = uint8(length - 1);
            }
        } else {
            uint256 newlength = _appendDelegate(_cp, _delegate, _value, length);
            _cp.delegations[0].length = uint8(newlength);  // safe - length <= MAX_DELEGATES_BY_PERCENT
        }
    }
    
    function _appendDelegate(CheckPoint storage _cp, address _delegate, uint256 _value, uint256 _length) 
        private 
        returns (uint256)
    {
        if (_value != 0) {
            require(_length < MAX_DELEGATES_BY_PERCENT, MAX_DELEGATES_MSG);
            Delegation storage dlg = _cp.delegations[_length];
            dlg.delegate = _delegate;
            dlg.value = _value.toUint16();
            // for delegations[0], fromBlock and length are assigned outside
            return _length + 1;
        }
        return _length;
    }
    
    function _deleteDelegate(CheckPoint storage _cp, uint256 _index, uint256 _last) private {
        Delegation storage dlg = _cp.delegations[_index];
        Delegation storage lastDlg = _cp.delegations[_last];
        if (_index < _last) {
            dlg.delegate = lastDlg.delegate;
            dlg.value = lastDlg.value;
        }
        lastDlg.delegate = address(0);
        lastDlg.value = 0;
    }
    
    /////////////////////////////////////////////////////////////////////////////////
    // helper functions for querying
    
    /**
     * @notice Binary search of _checkpoints array.
     * @param _checkpoints An array of CheckPoint to search.
     * @param _startIndex Smallest possible index to be returned.
     * @param _blockNumber The block number to search for.
     */
    function _binarySearchGreatestBlockLessThan(
        mapping(uint256 => CheckPoint) storage _checkpoints, 
        uint256 _startIndex,
        uint256 _endIndex,
        uint256 _blockNumber
    )
        private view
        returns (uint256 _index)
    {
        // Binary search of the value by given block number in the array
        uint256 min = _startIndex;
        uint256 max = _endIndex.sub(1);
        while (max > min) {
            uint256 mid = (max.add(min).add(1)).div(2);
            if (_checkpoints[mid].delegations[0].fromBlock <= _blockNumber) {
                min = mid;
            } else {
                max = mid.sub(1);
            }
        }
        return min;
    }

    /**
     * @notice Binary search of _checkpoints array. Extra optimized for the common case when we are 
     *   searching for the last block.
     * @param _self The state to query.
     * @param _blockNumber The block number to search for.
     * @return _found true if value was found (only `false` if `_blockNumber` is before first 
     *   checkpoint or the checkpoint array is empty)
     * @return _index index of the newest block with number less than or equal `_blockNumber`
     */
    function _findGreatestBlockLessThan(
        CheckPointHistoryState storage _self, 
        uint256 _blockNumber
    )
        private view
        returns (
            bool _found,
            uint256 _index
        )
    {
        uint256 startIndex = _self.startIndex;
        uint256 historyCount = _self.length;
        if (historyCount == 0) {
            _found = false;
        } else if (_blockNumber >= _self.checkpoints[historyCount - 1].delegations[0].fromBlock) {
            _found = true;
            _index = historyCount - 1;  // safe, historyCount != 0 in this branch
        } else if (_blockNumber < _self.checkpoints[startIndex].delegations[0].fromBlock) {
            // reading data before `_startIndex` is only safe before first cleanup
            require(startIndex == 0, "DelegationHistory: reading from cleaned-up block");
            _found = false;
        } else {
            _found = true;
            _index = _binarySearchGreatestBlockLessThan(_self.checkpoints, startIndex, historyCount, _blockNumber);
        }
    }
    
    /**
     * Find delegate and return its value or 0 if not found.
     */
    function _getValueForDelegate(CheckPoint storage _cp, address _delegate) internal view returns (uint256) {
        uint256 length = _cp.delegations[0].length;
        for (uint256 i = 0; i < length; i++) {
            Delegation storage dlg = _cp.delegations[i];
            if (dlg.delegate == _delegate) {
                return dlg.value;
            }
        }
        return 0;   // _delegate not found
    }
}


// File contracts/token/lib/PercentageDelegation.sol





/**
 * @title PercentageDelegation library
 * @notice Only handles percentage delegation  
 * @notice A library to manage a group of _delegates for allocating voting power by a delegator.
 **/
library PercentageDelegation {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using DelegationHistory for DelegationHistory.CheckPointHistoryState;
    using SafeMath for uint256;
    using SafePct for uint256;

    uint256 public constant MAX_BIPS = 10000;
    string private constant MAX_BIPS_MSG = "Max delegation bips exceeded";
    
    /**
     * @dev `DelegationState` is the state structure used by this library to contain/manage
     *  a grouing of _delegates (a PercentageDelegation) for a delegator.
     */
    struct DelegationState {
        // percentages by _delegates
        DelegationHistory.CheckPointHistoryState delegation;
    }

    /**
     * @notice Add or replace an existing _delegate with allocated vote power in basis points.
     * @param _self A DelegationState instance to manage.
     * @param _delegate The address of the _delegate to add/replace
     * @param _bips Allocation of the delegation specified in basis points (1/100 of 1 percent)
     * @dev If you send a `_bips` of zero, `_delegate` will be deleted if one
     *  exists in the delegation; if zero and `_delegate` does not exist, it will not be added.
     */
    function addReplaceDelegate(
        DelegationState storage _self, 
        address _delegate, 
        uint256 _bips
    )
        internal
    {
        // Check for max delegation basis points
        assert(_bips <= MAX_BIPS);

        // Change the delegate's percentage
        _self.delegation.writeValue(_delegate, _bips);
        
        // check the total
        require(_self.delegation.totalValueAtNow() <= MAX_BIPS, MAX_BIPS_MSG);
    }

    /**
     * @notice Get the total of the explicit vote power delegation bips of all delegates at given block.
     * @param _self A DelegationState instance to manage.
     * @param _blockNumber The block to query.
     * @return _totalBips The total vote power bips delegated.
     */
    function getDelegatedTotalAt(
        DelegationState storage _self,
        uint256 _blockNumber
    )
        internal view
        returns (uint256 _totalBips)
    {
        return _self.delegation.totalValueAt(_blockNumber);
    }

    /**
     * @notice Get the total of the bips vote power delegation bips of all _delegates.
     * @param _self A DelegationState instance to manage.
     * @return _totalBips The total vote power bips delegated.
     */
    function getDelegatedTotal(
        DelegationState storage _self
    )
        internal view
        returns (uint256 _totalBips)
    {
        return _self.delegation.totalValueAtNow();
    }

    /**
     * @notice Given a _delegate address, return the bips of the vote power delegation.
     * @param _self A DelegationState instance to manage.
     * @param _delegate The delegate address to find.
     * @param _blockNumber The block to query.
     * @return _bips The percent of vote power allocated to the delegate address.
     */
    function getDelegatedValueAt(
        DelegationState storage _self, 
        address _delegate,
        uint256 _blockNumber
    )
        internal view 
        returns (uint256 _bips)
    {
        return _self.delegation.valueOfAt(_delegate, _blockNumber);
    }

    /**
     * @notice Given a delegate address, return the bips of the vote power delegation.
     * @param _self A DelegationState instance to manage.
     * @param _delegate The delegate address to find.
     * @return _bips The percent of vote power allocated to the delegate address.
     */
    function getDelegatedValue(
        DelegationState storage _self, 
        address _delegate
    )
        internal view
        returns (uint256 _bips)
    {
        return _self.delegation.valueOfAtNow(_delegate);
    }

    /**
     * @notice Returns lists of delegate addresses and corresponding values at given block.
     * @param _self A DelegationState instance to manage.
     * @param _blockNumber The block to query.
     * @return _delegates Positional array of delegation addresses.
     * @return _values Positional array of delegation percents specified in basis points (1/100 or 1 percent)
     */
    function getDelegationsAt(
        DelegationState storage _self,
        uint256 _blockNumber
    )
        internal view 
        returns (
            address[] memory _delegates,
            uint256[] memory _values
        )
    {
        return _self.delegation.delegationsAt(_blockNumber);
    }
    
    /**
     * @notice Returns lists of delegate addresses and corresponding values.
     * @param _self A DelegationState instance to manage.
     * @return _delegates Positional array of delegation addresses.
     * @return _values Positional array of delegation percents specified in basis points (1/100 or 1 percent)
     */
    function getDelegations(
        DelegationState storage _self
    )
        internal view
        returns (
            address[] memory _delegates,
            uint256[] memory _values
        ) 
    {
        return _self.delegation.delegationsAtNow();
    }
    
    /**
     * Get all percentage delegations active now.
     * @param _self A CheckPointHistoryState instance to manage.
     * @return _length The number of delegations. 
     * @return _delegations . 
     **/
    function getDelegationsRaw(
        DelegationState storage _self
    )
        internal view
        returns (
            uint256 _length, 
            mapping(uint256 => DelegationHistory.Delegation) storage _delegations
        )
    {
        return _self.delegation.delegationsAtNowRaw();
    }
    
    /**
     * Get the number of delegations.
     * @param _self A DelegationState instance to manage.
     * @param _blockNumber The block number to query. 
     * @return _count Count of delegations at the time.
     **/
    function getCountAt(
        DelegationState storage _self,
        uint256 _blockNumber
    )
        internal view 
        returns (uint256 _count)
    {
        return _self.delegation.countAt(_blockNumber);
    }

    /**
     * Get the number of delegations.
     * @param _self A DelegationState instance to manage.
     * @return _count Count of delegations at the time.
     **/
    function getCount(
        DelegationState storage _self
    )
        internal view
        returns (uint256 _count)
    {
        return _self.delegation.countAt(block.number);
    }
    
    /**
     * @notice Get the total amount (absolute) of the vote power delegation of all delegates.
     * @param _self A DelegationState instance to manage.
     * @param _balance Owner's balance.
     * @return _totalAmount The total vote power amount delegated.
     */
    function getDelegatedTotalAmountAt(
        DelegationState storage _self, 
        uint256 _balance,
        uint256 _blockNumber
    )
        internal view 
        returns (uint256 _totalAmount)
    {
        return _self.delegation.scaledTotalValueAt(_balance, MAX_BIPS, _blockNumber);
    }
    
    /**
     * @notice Clears all delegates.
     * @param _self A DelegationState instance to manage.
     * @dev Delegation mode remains PERCENTAGE, even though the delgation is now empty.
     */
    function clear(DelegationState storage _self) internal {
        _self.delegation.clear();
    }


    /**
     * Delete at most `_count` of the oldest checkpoints.
     * At least one checkpoint at or before `_cleanupBlockNumber` will remain 
     * (unless the history was empty to start with).
     */    
    function cleanupOldCheckpoints(
        DelegationState storage _self, 
        uint256 _count,
        uint256 _cleanupBlockNumber
    )
        internal
        returns (uint256)
    {
        return _self.delegation.cleanupOldCheckpoints(_count, _cleanupBlockNumber);
    }
}


// File contracts/token/lib/ExplicitDelegation.sol





/**
 * @title ExplicitDelegation library
 * @notice A library to manage a group of delegates for allocating voting power by a delegator.
 **/
library ExplicitDelegation {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;
    using SafeMath for uint256;
    using SafePct for uint256;

    /**
     * @dev `DelegationState` is the state structure used by this library to contain/manage
     *  a grouing of delegates (a ExplicitDelegation) for a delegator.
     */
    struct DelegationState {
        CheckPointHistory.CheckPointHistoryState delegatedTotal;

        // `delegatedVotePower` is a map of delegators pointing to a map of delegates
        // containing a checkpoint history of delegated vote power balances.
        CheckPointsByAddress.CheckPointsByAddressState delegatedVotePower;
    }

    /**
     * @notice Add or replace an existing _delegate with new vote power (explicit).
     * @param _self A DelegationState instance to manage.
     * @param _delegate The address of the _delegate to add/replace
     * @param _amount Allocation of the delegation as explicit amount
     */
    function addReplaceDelegate(
        DelegationState storage _self, 
        address _delegate, 
        uint256 _amount
    )
        internal
    {
        uint256 prevAmount = _self.delegatedVotePower.valueOfAtNow(_delegate);
        uint256 newTotal = _self.delegatedTotal.valueAtNow().sub(prevAmount, "Total < 0").add(_amount);
        _self.delegatedVotePower.writeValue(_delegate, _amount);
        _self.delegatedTotal.writeValue(newTotal);
    }
    

    /**
     * Delete at most `_count` of the oldest checkpoints.
     * At least one checkpoint at or before `_cleanupBlockNumber` will remain 
     * (unless the history was empty to start with).
     */    
    function cleanupOldCheckpoints(
        DelegationState storage _self, 
        address _owner, 
        uint256 _count,
        uint256 _cleanupBlockNumber
    )
        internal
        returns(uint256 _deleted)
    {
        _deleted = _self.delegatedTotal.cleanupOldCheckpoints(_count, _cleanupBlockNumber);
        // safe: cleanupOldCheckpoints always returns the number of deleted elements which is small, so no owerflow
        _deleted += _self.delegatedVotePower.cleanupOldCheckpoints(_owner, _count, _cleanupBlockNumber);
    }
    
    /**
     * @notice Get the _total of the explicit vote power delegation amount.
     * @param _self A DelegationState instance to manage.
     * @param _blockNumber The block to query.
     * @return _total The _total vote power amount delegated.
     */
    function getDelegatedTotalAt(
        DelegationState storage _self, uint256 _blockNumber
    )
        internal view 
        returns (uint256 _total)
    {
        return _self.delegatedTotal.valueAt(_blockNumber);
    }
    
    /**
     * @notice Get the _total of the explicit vote power delegation amount.
     * @param _self A DelegationState instance to manage.
     * @return _total The total vote power amount delegated.
     */
    function getDelegatedTotal(
        DelegationState storage _self
    )
        internal view 
        returns (uint256 _total)
    {
        return _self.delegatedTotal.valueAtNow();
    }
    
    /**
     * @notice Given a delegate address, return the explicit amount of the vote power delegation.
     * @param _self A DelegationState instance to manage.
     * @param _delegate The _delegate address to find.
     * @param _blockNumber The block to query.
     * @return _value The percent of vote power allocated to the _delegate address.
     */
    function getDelegatedValueAt(
        DelegationState storage _self, 
        address _delegate,
        uint256 _blockNumber
    )
        internal view
        returns (uint256 _value)
    {
        return _self.delegatedVotePower.valueOfAt(_delegate, _blockNumber);
    }

    /**
     * @notice Given a delegate address, return the explicit amount of the vote power delegation.
     * @param _self A DelegationState instance to manage.
     * @param _delegate The _delegate address to find.
     * @return _value The percent of vote power allocated to the _delegate address.
     */
    function getDelegatedValue(
        DelegationState storage _self, 
        address _delegate
    )
        internal view 
        returns (uint256 _value)
    {
        return _self.delegatedVotePower.valueOfAtNow(_delegate);
    }
}


// File contracts/token/lib/VotePower.sol




/**
 * @title Vote power library
 * @notice A library to record delegate vote power balances by delegator 
 *  and delegatee.
 **/
library VotePower {
    using CheckPointHistory for CheckPointHistory.CheckPointHistoryState;
    using CheckPointsByAddress for CheckPointsByAddress.CheckPointsByAddressState;
    using SafeMath for uint256;

    /**
     * @dev `VotePowerState` is state structure used by this library to manage vote
     *  power amounts by delegator and it's delegates.
     */
    struct VotePowerState {
        // `votePowerByAddress` is the map that tracks the voting power balance
        //  of each address, by block.
        CheckPointsByAddress.CheckPointsByAddressState votePowerByAddress;
    }

    /**
     * @notice This modifier checks that both addresses are non-zero.
     * @param _delegator A delegator address.
     * @param _delegatee A delegatee address.
     */
    modifier addressesNotZero(address _delegator, address _delegatee) {
        // Both addresses cannot be zero
        assert(!(_delegator == address(0) && _delegatee == address(0)));
        _;
    }


    /**
     * @notice Delegate vote power `_amount` to `_delegatee` address from `_delegator` address.
     * @param _delegator Delegator address 
     * @param _delegatee Delegatee address
     * @param _amount The _amount of vote power to send from _delegator to _delegatee
     * @dev Amount recorded at the current block.
     **/
    function delegate(
        VotePowerState storage _self, 
        address _delegator, 
        address _delegatee,
        uint256 _amount
    )
        internal 
        addressesNotZero(_delegator, _delegatee)
    {
        // Shortcut
        if (_amount == 0) {
            return;
        }

        // Transmit vote power
        _self.votePowerByAddress.transmit(_delegator, _delegatee, _amount);
    }

    /**
     * @notice Change the current vote power value.
     * @param _owner Address of vote power owner.
     * @param _add The amount to add to the vote power.
     * @param _sub The amount to subtract from the vote power.
     */
    function changeValue(
        VotePowerState storage _self, 
        address _owner,
        uint256 _add,
        uint256 _sub
    )
        internal
    {
        assert(_owner != address(0));
        if (_add == _sub) return;
        uint256 value = _self.votePowerByAddress.valueOfAtNow(_owner);
        value = value.add(_add).sub(_sub);
        _self.votePowerByAddress.writeValue(_owner, value);
    }
    
    /**
     * @notice Undelegate vote power `_amount` from `_delegatee` address 
     *  to `_delegator` address
     * @param _delegator Delegator address 
     * @param _delegatee Delegatee address
     * @param _amount The amount of vote power recovered by delegator from delegatee
     **/
    function undelegate(
        VotePowerState storage _self, 
        address _delegator, 
        address _delegatee,
        uint256 _amount
    )
        internal
        addressesNotZero(_delegator, _delegatee)
    {
        // Shortcut
        if (_amount == 0) {
            return;
        }

        // Recover vote power
        _self.votePowerByAddress.transmit(_delegatee, _delegator, _amount);
    }

    /**
     * Delete at most `_count` of the oldest checkpoints.
     * At least one checkpoint at or before `_cleanupBlockNumber` will remain 
     * (unless the history was empty to start with).
     */    
    function cleanupOldCheckpoints(
        VotePowerState storage _self, 
        address _owner, 
        uint256 _count,
        uint256 _cleanupBlockNumber
    )
        internal
        returns (uint256)
    {
        return _self.votePowerByAddress.cleanupOldCheckpoints(_owner, _count, _cleanupBlockNumber);
    }

    /**
     * @notice Get the vote power of `_who` at `_blockNumber`.
     * @param _self A VotePowerState instance to manage.
     * @param _who Address to get vote power.
     * @param _blockNumber Block number of the block to fetch vote power.
     * @return _votePower The fetched vote power.
     */
    function votePowerOfAt(
        VotePowerState storage _self, 
        address _who, 
        uint256 _blockNumber
    )
        internal view 
        returns(uint256 _votePower)
    {
        return _self.votePowerByAddress.valueOfAt(_who, _blockNumber);
    }

    /**
     * @notice Get the current vote power of `_who`.
     * @param _self A VotePowerState instance to manage.
     * @param _who Address to get vote power.
     * @return _votePower The fetched vote power.
     */
    function votePowerOfAtNow(
        VotePowerState storage _self, 
        address _who
    )
        internal view
        returns(uint256 _votePower)
    {
        return _self.votePowerByAddress.valueOfAtNow(_who);
    }
}


// File contracts/token/lib/VotePowerCache.sol



/**
 * @title Vote power library
 * @notice A library to record delegate vote power balances by delegator 
 *  and delegatee.
 **/
library VotePowerCache {
    using SafeMath for uint256;
    using VotePower for VotePower.VotePowerState;

    struct RevocationCacheRecord {
        // revoking delegation only affects cached value therefore we have to track
        // the revocation in order not to revoke twice
        // mapping delegatee => revokedValue
        mapping(address => uint256) revocations;
    }
    
    /**
     * @dev `CacheState` is state structure used by this library to manage vote
     *  power amounts by delegator and it's delegates.
     */
    struct CacheState {
        // map keccak256([address, _blockNumber]) -> (value + 1)
        mapping(bytes32 => uint256) valueCache;
        
        // map keccak256([address, _blockNumber]) -> RevocationCacheRecord
        mapping(bytes32 => RevocationCacheRecord) revocationCache;
    }

    /**
    * @notice Get the cached value at given block. If there is no cached value, original
    *    value is returned and stored to cache. Cache never gets stale, because original
    *    value can never change in a past block.
    * @param _self A VotePowerCache instance to manage.
    * @param _votePower A VotePower instance to read from if cache is empty.
    * @param _who Address to get vote power.
    * @param _blockNumber Block number of the block to fetch vote power.
    * precondition: _blockNumber < block.number
    */
    function valueOfAt(
        CacheState storage _self,
        VotePower.VotePowerState storage _votePower,
        address _who,
        uint256 _blockNumber
    )
        internal 
        returns (uint256 _value, bool _createdCache)
    {
        bytes32 key = keccak256(abi.encode(_who, _blockNumber));
        // is it in cache?
        uint256 cachedValue = _self.valueCache[key];
        if (cachedValue != 0) {
            return (cachedValue - 1, false);    // safe, cachedValue != 0
        }
        // read from _votePower
        uint256 votePowerValue = _votePower.votePowerOfAt(_who, _blockNumber);
        _writeCacheValue(_self, key, votePowerValue);
        return (votePowerValue, true);
    }

    /**
    * @notice Get the cached value at given block. If there is no cached value, original
    *    value is returned. Cache is never modified.
    * @param _self A VotePowerCache instance to manage.
    * @param _votePower A VotePower instance to read from if cache is empty.
    * @param _who Address to get vote power.
    * @param _blockNumber Block number of the block to fetch vote power.
    * precondition: _blockNumber < block.number
    */
    function valueOfAtReadonly(
        CacheState storage _self,
        VotePower.VotePowerState storage _votePower,
        address _who,
        uint256 _blockNumber
    )
        internal view 
        returns (uint256 _value)
    {
        bytes32 key = keccak256(abi.encode(_who, _blockNumber));
        // is it in cache?
        uint256 cachedValue = _self.valueCache[key];
        if (cachedValue != 0) {
            return cachedValue - 1;     // safe, cachedValue != 0
        }
        // read from _votePower
        return _votePower.votePowerOfAt(_who, _blockNumber);
    }
    
    /**
    * @notice Delete cached value for `_who` at given block.
    *   Only used for history cleanup.
    * @param _self A VotePowerCache instance to manage.
    * @param _who Address to get vote power.
    * @param _blockNumber Block number of the block to fetch vote power.
    * @return _deleted The number of cache items deleted (always 0 or 1).
    * precondition: _blockNumber < cleanupBlockNumber
    */
    function deleteValueAt(
        CacheState storage _self,
        address _who,
        uint256 _blockNumber
    )
        internal
        returns (uint256 _deleted)
    {
        bytes32 key = keccak256(abi.encode(_who, _blockNumber));
        if (_self.valueCache[key] != 0) {
            delete _self.valueCache[key];
            return 1;
        }
        return 0;
    }
    
    /**
    * @notice Revoke vote power delegation from `from` to `to` at given block.
    *   Updates cached values for the block, so they are the only vote power values respecting revocation.
    * @dev Only delegatees cached value is changed, delegator doesn't get the vote power back; so
    *   the revoked vote power is forfeit for as long as this vote power block is in use. This is needed to
    *   prevent double voting.
    * @param _self A VotePowerCache instance to manage.
    * @param _votePower A VotePower instance to read from if cache is empty.
    * @param _from The delegator.
    * @param _to The delegatee.
    * @param _revokedValue Value of delegation is not stored here, so it must be supplied by caller.
    * @param _blockNumber Block number of the block to modify.
    * precondition: _blockNumber < block.number
    */
    function revokeAt(
        CacheState storage _self,
        VotePower.VotePowerState storage _votePower,
        address _from,
        address _to,
        uint256 _revokedValue,
        uint256 _blockNumber
    )
        internal
    {
        if (_revokedValue == 0) return;
        bytes32 keyFrom = keccak256(abi.encode(_from, _blockNumber));
        if (_self.revocationCache[keyFrom].revocations[_to] != 0) {
            revert("Already revoked");
        }
        // read values and prime cacheOf
        (uint256 valueTo,) = valueOfAt(_self, _votePower, _to, _blockNumber);
        // write new values
        bytes32 keyTo = keccak256(abi.encode(_to, _blockNumber));
        _writeCacheValue(_self, keyTo, valueTo.sub(_revokedValue, "Revoked value too large"));
        // mark as revoked
        _self.revocationCache[keyFrom].revocations[_to] = _revokedValue;
    }
    
    /**
    * @notice Delete revocation from `_from` to `_to` at block `_blockNumber`.
    *   Only used for history cleanup.
    * @param _self A VotePowerCache instance to manage.
    * @param _from The delegator.
    * @param _to The delegatee.
    * @param _blockNumber Block number of the block to modify.
    * precondition: _blockNumber < cleanupBlockNumber
    */
    function deleteRevocationAt(
        CacheState storage _self,
        address _from,
        address _to,
        uint256 _blockNumber
    )
        internal
        returns (uint256 _deleted)
    {
        bytes32 keyFrom = keccak256(abi.encode(_from, _blockNumber));
        RevocationCacheRecord storage revocationRec = _self.revocationCache[keyFrom];
        uint256 value = revocationRec.revocations[_to];
        if (value != 0) {
            delete revocationRec.revocations[_to];
            return 1;
        }
        return 0;
    }

    /**
    * @notice Returns true if `from` has revoked vote pover delgation of `to` in block `_blockNumber`.
    * @param _self A VotePowerCache instance to manage.
    * @param _from The delegator.
    * @param _to The delegatee.
    * @param _blockNumber Block number of the block to fetch result.
    * precondition: _blockNumber < block.number
    */
    function revokedFromToAt(
        CacheState storage _self,
        address _from,
        address _to,
        uint256 _blockNumber
    )
        internal view
        returns (bool revoked)
    {
        bytes32 keyFrom = keccak256(abi.encode(_from, _blockNumber));
        return _self.revocationCache[keyFrom].revocations[_to] != 0;
    }
    
    function _writeCacheValue(CacheState storage _self, bytes32 _key, uint256 _value) private {
        // store to cacheOf (add 1 to differentiate from empty)
        _self.valueCache[_key] = _value.add(1);
    }
}


// File contracts/token/implementation/Delegatable.sol








/**
 * @title Delegateable ERC20 behavior
 * @notice An ERC20 Delegateable behavior to delegate voting power
 *  of a token to delegates. This contract orchestrates interaction between
 *  managing a delegation and the vote power allocations that result.
 **/
contract Delegatable is IVPContractEvents {
    using PercentageDelegation for PercentageDelegation.DelegationState;
    using ExplicitDelegation for ExplicitDelegation.DelegationState;
    using SafeMath for uint256;
    using SafePct for uint256;
    using VotePower for VotePower.VotePowerState;
    using VotePowerCache for VotePowerCache.CacheState;

    enum DelegationMode { 
        NOTSET, 
        PERCENTAGE, 
        AMOUNT
    }

    // The number of history cleanup steps executed for every write operation.
    // It is more than 1 to make as certain as possible that all history gets cleaned eventually.
    uint256 private constant CLEANUP_COUNT = 2;
    
    string constant private UNDELEGATED_VP_TOO_SMALL_MSG = 
        "Undelegated vote power too small";

    // Map that tracks delegation mode of each address.
    mapping(address => DelegationMode) private delegationModes;

    // `percentageDelegations` is the map that tracks the percentage voting power delegation of each address.
    // Explicit delegations are tracked directly through votePower.
    mapping(address => PercentageDelegation.DelegationState) private percentageDelegations;
    
    mapping(address => ExplicitDelegation.DelegationState) private explicitDelegations;

    // `votePower` tracks all voting power balances
    VotePower.VotePowerState private votePower;

    // `votePower` tracks all voting power balances
    VotePowerCache.CacheState private votePowerCache;

    // Historic data for the blocks before `cleanupBlockNumber` can be erased,
    // history before that block should never be used since it can be inconsistent.
    uint256 private cleanupBlockNumber;
    
    // Address of the contract that is allowed to call methods for history cleaning.
    address public cleanerContract;
    
    /**
     * Emitted when a vote power cache entry is created.
     * Allows history cleaners to track vote power cache cleanup opportunities off-chain.
     */
    event CreatedVotePowerCache(address _owner, uint256 _blockNumber);
    
    // Most history cleanup opportunities can be deduced from standard events:
    // Transfer(from, to, amount):
    //  - vote power checkpoints for `from` (if nonzero) and `to` (if nonzero)
    //  - vote power checkpoints for percentage delegatees of `from` and `to` are also created,
    //    but they don't have to be checked since Delegate events are also emitted in case of 
    //    percentage delegation vote power change due to delegators balance change
    //  - Note: Transfer event is emitted from VPToken but vote power checkpoint delegationModes
    //    must be called on its writeVotePowerContract
    // Delegate(from, to, priorVP, newVP):
    //  - vote power checkpoints for `from` and `to`
    //  - percentage delegation checkpoint for `from` (if `from` uses percentage delegation mode)
    //  - explicit delegation checkpoint from `from` to `to` (if `from` uses explicit delegation mode)
    // Revoke(from, to, vp, block):
    //  - vote power cache for `from` and `to` at `block`
    //  - revocation cache block from `from` to `to` at `block`
    
    /**
     * Reading from history is not allowed before `cleanupBlockNumber`, since data before that
     * might have been deleted and is thus unreliable.
     */    
    modifier notBeforeCleanupBlock(uint256 _blockNumber) {
        require(_blockNumber >= cleanupBlockNumber, "Delegatable: reading from cleaned-up block");
        _;
    }
    
    /**
     * History cleaning methods can be called only from the cleaner address.
     */
    modifier onlyCleaner {
        require(msg.sender == cleanerContract, "Only cleaner contract");
        _;
    }

    /**
     * @notice (Un)Allocate `_owner` vote power of `_amount` across owner delegate
     *  vote power percentages.
     * @param _owner The address of the vote power owner.
     * @param _priorBalance The owner's balance before change.
     * @param _newBalance The owner's balance after change.
     * @dev precondition: delegationModes[_owner] == DelegationMode.PERCENTAGE
     */
    function _allocateVotePower(address _owner, uint256 _priorBalance, uint256 _newBalance) private {
        // Get the voting delegation for the _owner
        PercentageDelegation.DelegationState storage delegation = percentageDelegations[_owner];
        // Track total owner vp change
        uint256 ownerVpAdd = _newBalance;
        uint256 ownerVpSub = _priorBalance;
        // Iterate over the delegates
        (uint256 length, mapping(uint256 => DelegationHistory.Delegation) storage delegations) = 
            delegation.getDelegationsRaw();
        for (uint256 i = 0; i < length; i++) {
            DelegationHistory.Delegation storage dlg = delegations[i];
            address delegatee = dlg.delegate;
            uint256 value = dlg.value;
            // Compute the delegated vote power for the delegatee
            uint256 priorValue = _priorBalance.mulDiv(value, PercentageDelegation.MAX_BIPS);
            uint256 newValue = _newBalance.mulDiv(value, PercentageDelegation.MAX_BIPS);
            ownerVpAdd = ownerVpAdd.add(priorValue);
            ownerVpSub = ownerVpSub.add(newValue);
            // could optimize next lines by checking that priorValue != newValue, but that can only happen
            // for the transfer of 0 amount, which is prevented by the calling function
            votePower.changeValue(delegatee, newValue, priorValue);
            votePower.cleanupOldCheckpoints(delegatee, CLEANUP_COUNT, cleanupBlockNumber);
            emit Delegate(_owner, delegatee, priorValue, newValue);
        }
        // (ownerVpAdd - ownerVpSub) is how much the owner vp changes - will be 0 if delegation is 100%
        if (ownerVpAdd != ownerVpSub) {
            votePower.changeValue(_owner, ownerVpAdd, ownerVpSub);
            votePower.cleanupOldCheckpoints(_owner, CLEANUP_COUNT, cleanupBlockNumber);    
        }
    }

    /**
     * @notice Burn `_amount` of vote power for `_owner`.
     * @param _owner The address of the _owner vote power to burn.
     * @param _ownerCurrentBalance The current token balance of the owner (which is their allocatable vote power).
     * @param _amount The amount of vote power to burn.
     */
    function _burnVotePower(address _owner, uint256 _ownerCurrentBalance, uint256 _amount) internal {
        // revert with the same error as ERC20 in case transfer exceeds balance
        uint256 newOwnerBalance = _ownerCurrentBalance.sub(_amount, "ERC20: transfer amount exceeds balance");
        if (delegationModes[_owner] == DelegationMode.PERCENTAGE) {
            // for PERCENTAGE delegation: reduce owner vote power allocations
            _allocateVotePower(_owner, _ownerCurrentBalance, newOwnerBalance);
        } else {
            // for AMOUNT delegation: is there enough unallocated VP _to burn if explicitly delegated?
            require(_isTransmittable(_owner, _ownerCurrentBalance, _amount), UNDELEGATED_VP_TOO_SMALL_MSG);
            // burn vote power
            votePower.changeValue(_owner, 0, _amount);
            votePower.cleanupOldCheckpoints(_owner, CLEANUP_COUNT, cleanupBlockNumber);
        }
    }

    /**
     * @notice Get whether `_owner` current delegation can be delegated by percentage.
     * @param _owner Address of delegation to check.
     * @return True if delegation can be delegated by percentage.
     */
    function _canDelegateByPct(address _owner) internal view returns(bool) {
        // Get the delegation mode.
        DelegationMode delegationMode = delegationModes[_owner];
        // Return true if delegation is safe _to store percents, which can also
        // apply if there is not delegation mode set.
        return delegationMode == DelegationMode.NOTSET || delegationMode == DelegationMode.PERCENTAGE;
    }

    /**
     * @notice Get whether `_owner` current delegation can be delegated by amount.
     * @param _owner Address of delegation to check.
     * @return True if delegation can be delegated by amount.
     */
    function _canDelegateByAmount(address _owner) internal view returns(bool) {
        // Get the delegation mode.
        DelegationMode delegationMode = delegationModes[_owner];
        // Return true if delegation is safe to store explicit amounts, which can also
        // apply if there is not delegation mode set.
        return delegationMode == DelegationMode.NOTSET || delegationMode == DelegationMode.AMOUNT;
    }

    /**
     * @notice Delegate `_amount` of voting power to `_to` from `_from`
     * @param _from The address of the delegator
     * @param _to The address of the recipient
     * @param _senderCurrentBalance The senders current balance (not their voting power)
     * @param _amount The amount of voting power to be delegated
     **/
    function _delegateByAmount(
        address _from, 
        address _to, 
        uint256 _senderCurrentBalance, 
        uint256 _amount
    )
        internal virtual 
    {
        require (_to != address(0), "Cannot delegate to zero");
        require (_to != _from, "Cannot delegate to self");
        require (_canDelegateByAmount(_from), "Cannot delegate by amount");
        
        // Get the vote power delegation for the sender
        ExplicitDelegation.DelegationState storage delegation = explicitDelegations[_from];
        
        // the prior value
        uint256 priorAmount = delegation.getDelegatedValue(_to);
        
        // Delegate new power
        if (_amount < priorAmount) {
            // Prior amount is greater, just reduce the delegated amount.
            // subtraction is safe since _amount < priorAmount
            votePower.undelegate(_from, _to, priorAmount - _amount);
        } else {
            // Is there enough undelegated vote power?
            uint256 availableAmount = _undelegatedVotePowerOf(_from, _senderCurrentBalance).add(priorAmount);
            require(availableAmount >= _amount, UNDELEGATED_VP_TOO_SMALL_MSG);
            // Increase the delegated amount of vote power.
            // subtraction is safe since _amount >= priorAmount
            votePower.delegate(_from, _to, _amount - priorAmount);
        }
        votePower.cleanupOldCheckpoints(_from, CLEANUP_COUNT, cleanupBlockNumber);
        votePower.cleanupOldCheckpoints(_to, CLEANUP_COUNT, cleanupBlockNumber);
        
        // Add/replace delegate
        delegation.addReplaceDelegate(_to, _amount);
        delegation.cleanupOldCheckpoints(_to, CLEANUP_COUNT, cleanupBlockNumber);

        // update mode if needed
        if (delegationModes[_from] != DelegationMode.AMOUNT) {
            delegationModes[_from] = DelegationMode.AMOUNT;
        }
        
        // emit event for delegation change
        emit Delegate(_from, _to, priorAmount, _amount);
    }

    /**
     * @notice Delegate `_bips` of voting power to `_to` from `_from`
     * @param _from The address of the delegator
     * @param _to The address of the recipient
     * @param _senderCurrentBalance The senders current balance (not their voting power)
     * @param _bips The percentage of voting power in basis points (1/100 of 1 percent) to be delegated
     **/
    function _delegateByPercentage(
        address _from, 
        address _to, 
        uint256 _senderCurrentBalance, 
        uint256 _bips
    )
        internal virtual
    {
        require (_to != address(0), "Cannot delegate to zero");
        require (_to != _from, "Cannot delegate to self");
        require (_canDelegateByPct(_from), "Cannot delegate by percentage");
        
        // Get the vote power delegation for the sender
        PercentageDelegation.DelegationState storage delegation = percentageDelegations[_from];

        // Get prior percent for delegate if exists
        uint256 priorBips = delegation.getDelegatedValue(_to);
        uint256 reverseVotePower = 0;
        uint256 newVotePower = 0;

        // Add/replace delegate
        delegation.addReplaceDelegate(_to, _bips);
        delegation.cleanupOldCheckpoints(CLEANUP_COUNT, cleanupBlockNumber);
        
        // First, back out old voting power percentage, if not zero
        if (priorBips != 0) {
            reverseVotePower = _senderCurrentBalance.mulDiv(priorBips, PercentageDelegation.MAX_BIPS);
        }

        // Calculate the new vote power
        if (_bips != 0) {
            newVotePower = _senderCurrentBalance.mulDiv(_bips, PercentageDelegation.MAX_BIPS);
        }

        // Delegate new power
        if (newVotePower < reverseVotePower) {
            // subtraction is safe since newVotePower < reverseVotePower
            votePower.undelegate(_from, _to, reverseVotePower - newVotePower);
        } else {
            // subtraction is safe since newVotePower >= reverseVotePower
            votePower.delegate(_from, _to, newVotePower - reverseVotePower);
        }
        votePower.cleanupOldCheckpoints(_from, CLEANUP_COUNT, cleanupBlockNumber);
        votePower.cleanupOldCheckpoints(_to, CLEANUP_COUNT, cleanupBlockNumber);
        
        // update mode if needed
        if (delegationModes[_from] != DelegationMode.PERCENTAGE) {
            delegationModes[_from] = DelegationMode.PERCENTAGE;
        }

        // emit event for delegation change
        emit Delegate(_from, _to, reverseVotePower, newVotePower);
    }

    /**
     * @notice Get the delegation mode for '_who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value.
     * @param _who The address to get delegation mode.
     * @return Delegation mode
     */
    function _delegationModeOf(address _who) internal view returns (DelegationMode) {
        return delegationModes[_who];
    }

    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `_bips` of an `_owner`. Returned in two separate positional arrays.
    * @param _owner The address to get delegations.
    * @param _blockNumber The block for which we want to know the delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    */
    function _percentageDelegatesOfAt(
        address _owner,
        uint256 _blockNumber
    )
        internal view
        notBeforeCleanupBlock(_blockNumber) 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips
        )
    {
        PercentageDelegation.DelegationState storage delegation = percentageDelegations[_owner];
        address[] memory allDelegateAddresses;
        uint256[] memory allBips;
        (allDelegateAddresses, allBips) = delegation.getDelegationsAt(_blockNumber);
        // delete revoked addresses
        for (uint256 i = 0; i < allDelegateAddresses.length; i++) {
            if (votePowerCache.revokedFromToAt(_owner, allDelegateAddresses[i], _blockNumber)) {
                allBips[i] = 0;
            }
        }
        uint256 length = 0;
        for (uint256 i = 0; i < allDelegateAddresses.length; i++) {
            if (allBips[i] != 0) length++;
        }
        _delegateAddresses = new address[](length);
        _bips = new uint256[](length);
        uint256 destIndex = 0;
        for (uint256 i = 0; i < allDelegateAddresses.length; i++) {
            if (allBips[i] != 0) {
                _delegateAddresses[destIndex] = allDelegateAddresses[i];
                _bips[destIndex] = allBips[i];
                destIndex++;
            }
        }
    }

    /**
     * @notice Checks if enough undelegated vote power exists to allow a token
     *  transfer to occur if vote power is explicitly delegated.
     * @param _owner The address of transmittable vote power to check.
     * @param _ownerCurrentBalance The current balance of `_owner`.
     * @param _amount The amount to check.
     * @return True is `_amount` is transmittable.
     */
    function _isTransmittable(
        address _owner, 
        uint256 _ownerCurrentBalance, 
        uint256 _amount
    )
        private view returns(bool)
    {
        // Only proceed if we have a delegation by _amount
        if (delegationModes[_owner] == DelegationMode.AMOUNT) {
            // Return true if there is enough vote power _to cover the transfer
            return _undelegatedVotePowerOf(_owner, _ownerCurrentBalance) >= _amount;
        } else {
            // Not delegated by _amount, so transfer always allowed
            return true;
        }
    }

    /**
     * @notice Mint `_amount` of vote power for `_owner`.
     * @param _owner The address of the owner to receive new vote power.
     * @param _amount The amount of vote power to mint.
     */
    function _mintVotePower(address _owner, uint256 _ownerCurrentBalance, uint256 _amount) internal {
        if (delegationModes[_owner] == DelegationMode.PERCENTAGE) {
            // Allocate newly minted vote power over delegates
            _allocateVotePower(_owner, _ownerCurrentBalance, _ownerCurrentBalance.add(_amount));
        } else {
            votePower.changeValue(_owner, _amount, 0);
            votePower.cleanupOldCheckpoints(_owner, CLEANUP_COUNT, cleanupBlockNumber);
        }
    }
    
    /**
    * @notice Revoke the vote power of `_to` at block `_blockNumber`
    * @param _from The address of the delegator
    * @param _to The delegatee address of vote power to revoke.
    * @param _senderBalanceAt The sender's balance at the block to be revoked.
    * @param _blockNumber The block number at which to revoke.
    */
    function _revokeDelegationAt(
        address _from, 
        address _to, 
        uint256 _senderBalanceAt, 
        uint256 _blockNumber
    )
        internal 
        notBeforeCleanupBlock(_blockNumber)
    {
        require(_blockNumber < block.number, "Revoke is only for the past, use undelegate for the present");
        
        // Get amount revoked
        uint256 votePowerRevoked = _votePowerFromToAtNoRevokeCheck(_from, _to, _senderBalanceAt, _blockNumber);
        
        // Revoke vote power
        votePowerCache.revokeAt(votePower, _from, _to, votePowerRevoked, _blockNumber);

        // Emit revoke event
        emit Revoke(_from, _to, votePowerRevoked, _blockNumber);
    }

    /**
    * @notice Transmit `_amount` of vote power `_from` address `_to` address.
    * @param _from The address of the sender.
    * @param _to The address of the receiver.
    * @param _fromCurrentBalance The current token balance of the transmitter.
    * @param _toCurrentBalance The current token balance of the receiver.
    * @param _amount The amount of vote power to transmit.
    */
    function _transmitVotePower(
        address _from, 
        address _to, 
        uint256 _fromCurrentBalance, 
        uint256 _toCurrentBalance,
        uint256 _amount
    )
        internal
    {
        _burnVotePower(_from, _fromCurrentBalance, _amount);
        _mintVotePower(_to, _toCurrentBalance, _amount);
    }

    /**
     * @notice Undelegate all vote power by percentage for `delegation` of `_who`.
     * @param _from The address of the delegator
     * @param _senderCurrentBalance The current balance of message sender.
     * precondition: delegationModes[_who] == DelegationMode.PERCENTAGE
     */
    function _undelegateAllByPercentage(address _from, uint256 _senderCurrentBalance) internal {
        DelegationMode delegationMode = delegationModes[_from];
        if (delegationMode == DelegationMode.NOTSET) return;
        require(delegationMode == DelegationMode.PERCENTAGE,
            "undelegateAll can only be used in percentage delegation mode");
            
        PercentageDelegation.DelegationState storage delegation = percentageDelegations[_from];
        
        // Iterate over the delegates
        (address[] memory delegates, uint256[] memory _bips) = delegation.getDelegations();
        for (uint256 i = 0; i < delegates.length; i++) {
            address to = delegates[i];
            // Compute vote power to be reversed for the delegate
            uint256 reverseVotePower = _senderCurrentBalance.mulDiv(_bips[i], PercentageDelegation.MAX_BIPS);
            // Transmit vote power back to _owner
            votePower.undelegate(_from, to, reverseVotePower);
            votePower.cleanupOldCheckpoints(_from, CLEANUP_COUNT, cleanupBlockNumber);
            votePower.cleanupOldCheckpoints(to, CLEANUP_COUNT, cleanupBlockNumber);
            // Emit vote power reversal event
            emit Delegate(_from, to, reverseVotePower, 0);
        }

        // Clear delegates
        delegation.clear();
        delegation.cleanupOldCheckpoints(CLEANUP_COUNT, cleanupBlockNumber);
    }

    /**
     * @notice Undelegate all vote power by amount delegates for `_from`.
     * @param _from The address of the delegator
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     */
    function _undelegateAllByAmount(
        address _from,
        address[] memory _delegateAddresses
    ) 
        internal 
        returns (uint256 _remainingDelegation)
    {
        DelegationMode delegationMode = delegationModes[_from];
        if (delegationMode == DelegationMode.NOTSET) return 0;
        require(delegationMode == DelegationMode.AMOUNT,
            "undelegateAllExplicit can only be used in explicit delegation mode");
            
        ExplicitDelegation.DelegationState storage delegation = explicitDelegations[_from];
        
        // Iterate over the delegates
        for (uint256 i = 0; i < _delegateAddresses.length; i++) {
            address to = _delegateAddresses[i];
            // Compute vote power _to be reversed for the delegate
            uint256 reverseVotePower = delegation.getDelegatedValue(to);
            if (reverseVotePower == 0) continue;
            // Transmit vote power back _to _owner
            votePower.undelegate(_from, to, reverseVotePower);
            votePower.cleanupOldCheckpoints(_from, CLEANUP_COUNT, cleanupBlockNumber);
            votePower.cleanupOldCheckpoints(to, CLEANUP_COUNT, cleanupBlockNumber);
            // change delagation
            delegation.addReplaceDelegate(to, 0);
            delegation.cleanupOldCheckpoints(to, CLEANUP_COUNT, cleanupBlockNumber);
            // Emit vote power reversal event
            emit Delegate(_from, to, reverseVotePower, 0);
        }
        
        return delegation.getDelegatedTotal();
    }
    
    /**
     * @notice Check if the `_owner` has made any delegations.
     * @param _owner The address of owner to get delegated vote power.
     * @return The total delegated vote power at block.
     */
    function _hasAnyDelegations(address _owner) internal view returns(bool) {
        DelegationMode delegationMode = delegationModes[_owner];
        if (delegationMode == DelegationMode.NOTSET) {
            return false;
        } else if (delegationMode == DelegationMode.AMOUNT) {
            return explicitDelegations[_owner].getDelegatedTotal() > 0;
        } else { // delegationMode == DelegationMode.PERCENTAGE
            return percentageDelegations[_owner].getCount() > 0;
        }
    }

    /**
     * @notice Get the total delegated vote power of `_owner` at some block.
     * @param _owner The address of owner to get delegated vote power.
     * @param _ownerBalanceAt The balance of the owner at that block (not their vote power).
     * @param _blockNumber The block number at which to fetch.
     * @return _votePower The total delegated vote power at block.
     */
    function _delegatedVotePowerOfAt(
        address _owner, 
        uint256 _ownerBalanceAt,
        uint256 _blockNumber
    ) 
        internal view
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256 _votePower)
    {
        // Get the vote power delegation for the _owner
        DelegationMode delegationMode = delegationModes[_owner];
        if (delegationMode == DelegationMode.NOTSET) {
            return 0;
        } else if (delegationMode == DelegationMode.AMOUNT) {
            return explicitDelegations[_owner].getDelegatedTotalAt(_blockNumber);
        } else { // delegationMode == DelegationMode.PERCENTAGE
            return percentageDelegations[_owner].getDelegatedTotalAmountAt(_ownerBalanceAt, _blockNumber);
        }
    }

    /**
     * @notice Get the undelegated vote power of `_owner` at some block.
     * @param _owner The address of owner to get undelegated vote power.
     * @param _ownerBalanceAt The balance of the owner at that block (not their vote power).
     * @param _blockNumber The block number at which to fetch.
     * @return _votePower The undelegated vote power at block.
     */
    function _undelegatedVotePowerOfAt(
        address _owner, 
        uint256 _ownerBalanceAt,
        uint256 _blockNumber
    ) 
        internal view 
        notBeforeCleanupBlock(_blockNumber) 
        returns(uint256 _votePower)
    {
        // Return the current balance less delegations or zero if negative
        uint256 delegated = _delegatedVotePowerOfAt(_owner, _ownerBalanceAt, _blockNumber);
        bool overflow;
        uint256 result;
        (overflow, result) = _ownerBalanceAt.trySub(delegated);
        return result;
    }

    /**
     * @notice Get the undelegated vote power of `_owner`.
     * @param _owner The address of owner to get undelegated vote power.
     * @param _ownerCurrentBalance The current balance of the owner (not their vote power).
     * @return _votePower The undelegated vote power.
     */
    function _undelegatedVotePowerOf(
        address _owner, 
        uint256 _ownerCurrentBalance
    ) 
        internal view 
        returns(uint256 _votePower)
    {
        return _undelegatedVotePowerOfAt(_owner, _ownerCurrentBalance, block.number);
    }
    
    /**
    * @notice Get current delegated vote power `_from` delegator delegated `_to` delegatee.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @return _votePower The delegated vote power.
    */
    function _votePowerFromTo(
        address _from, 
        address _to, 
        uint256 _currentFromBalance
    ) 
        internal view 
        returns(uint256 _votePower)
    {
        DelegationMode delegationMode = delegationModes[_from];
        if (delegationMode == DelegationMode.NOTSET) {
            return 0;
        } else if (delegationMode == DelegationMode.PERCENTAGE) {
            uint256 _bips = percentageDelegations[_from].getDelegatedValue(_to);
            return _currentFromBalance.mulDiv(_bips, PercentageDelegation.MAX_BIPS);
        } else { // delegationMode == DelegationMode.AMOUNT
            return explicitDelegations[_from].getDelegatedValue(_to);
        }
    }

    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _fromBalanceAt From's balance at the block `_blockNumber`.
    * @param _blockNumber The block number at which to fetch.
    * @return _votePower The delegated vote power.
    */
    function _votePowerFromToAt(
        address _from, 
        address _to, 
        uint256 _fromBalanceAt, 
        uint256 _blockNumber
    ) 
        internal view 
        notBeforeCleanupBlock(_blockNumber) 
        returns(uint256 _votePower) 
    {
        // if revoked, return 0
        if (votePowerCache.revokedFromToAt(_from, _to, _blockNumber)) return 0;
        return _votePowerFromToAtNoRevokeCheck(_from, _to, _fromBalanceAt, _blockNumber);
    }

    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    *   Private use only - ignores revocations.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _fromBalanceAt From's balance at the block `_blockNumber`.
    * @param _blockNumber The block number at which to fetch.
    * @return _votePower The delegated vote power.
    */
    function _votePowerFromToAtNoRevokeCheck(
        address _from, 
        address _to, 
        uint256 _fromBalanceAt, 
        uint256 _blockNumber
    )
        private view 
        returns(uint256 _votePower)
    {
        // assumed: notBeforeCleanupBlock(_blockNumber)
        DelegationMode delegationMode = delegationModes[_from];
        if (delegationMode == DelegationMode.NOTSET) {
            return 0;
        } else if (delegationMode == DelegationMode.PERCENTAGE) {
            uint256 _bips = percentageDelegations[_from].getDelegatedValueAt(_to, _blockNumber);
            return _fromBalanceAt.mulDiv(_bips, PercentageDelegation.MAX_BIPS);
        } else { // delegationMode == DelegationMode.AMOUNT
            return explicitDelegations[_from].getDelegatedValueAt(_to, _blockNumber);
        }
    }

    /**
     * @notice Get the current vote power of `_who`.
     * @param _who The address to get voting power.
     * @return Current vote power of `_who`.
     */
    function _votePowerOf(address _who) internal view returns(uint256) {
        return votePower.votePowerOfAtNow(_who);
    }

    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function _votePowerOfAt(
        address _who, 
        uint256 _blockNumber
    )
        internal view 
        notBeforeCleanupBlock(_blockNumber) 
        returns(uint256)
    {
        // read cached value for past blocks to respect revocations (and possibly get a cache speedup)
        if (_blockNumber < block.number) {
            return votePowerCache.valueOfAtReadonly(votePower, _who, _blockNumber);
        } else {
            return votePower.votePowerOfAtNow(_who);
        }
    }

    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`, ignoring revocation information (and cache).
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`. Result doesn't change if vote power is revoked.
    */
    function _votePowerOfAtIgnoringRevocation(
        address _who, 
        uint256 _blockNumber
    )
        internal view 
        notBeforeCleanupBlock(_blockNumber) 
        returns(uint256)
    {
        return votePower.votePowerOfAt(_who, _blockNumber);
    }

    /**
     * Return vote powers for several addresses in a batch.
     * Only works for past blocks.
     * @param _owners The list of addresses to fetch vote power of.
     * @param _blockNumber The block number at which to fetch.
     * @return _votePowers A list of vote powers corresponding to _owners.
     */    
    function _batchVotePowerOfAt(
        address[] memory _owners, 
        uint256 _blockNumber
    ) 
        internal view 
        notBeforeCleanupBlock(_blockNumber) 
        returns(uint256[] memory _votePowers)
    {
        require(_blockNumber < block.number, "Can only be used for past blocks");
        _votePowers = new uint256[](_owners.length);
        for (uint256 i = 0; i < _owners.length; i++) {
            // read through cache, much faster if it has been set
            _votePowers[i] = votePowerCache.valueOfAtReadonly(votePower, _owners[i], _blockNumber);
        }
    }
    
    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`
    *   Reads/updates cache and upholds revocations.
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function _votePowerOfAtCached(
        address _who, 
        uint256 _blockNumber
    )
        internal 
        notBeforeCleanupBlock(_blockNumber)
        returns(uint256) 
    {
        require(_blockNumber < block.number, "Can only be used for past blocks");
        (uint256 vp, bool createdCache) = votePowerCache.valueOfAt(votePower, _who, _blockNumber);
        if (createdCache) emit CreatedVotePowerCache(_who, _blockNumber);
        return vp;
    }
    
    /**
     * Set the cleanup block number.
     */
    function _setCleanupBlockNumber(uint256 _blockNumber) internal {
        require(_blockNumber >= cleanupBlockNumber, "Cleanup block number must never decrease");
        require(_blockNumber < block.number, "Cleanup block must be in the past");
        cleanupBlockNumber = _blockNumber;
    }

    /**
     * Get the cleanup block number.
     */
    function _cleanupBlockNumber() internal view returns (uint256) {
        return cleanupBlockNumber;
    }
    
    /**
     * Set the contract that is allowed to call history cleaning methods.
     */
    function _setCleanerContract(address _cleanerContract) internal {
        cleanerContract = _cleanerContract;
    }
    
    // history cleanup methods
    
    /**
     * Delete vote power checkpoints that expired (i.e. are before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _owner vote power owner account address
     * @param _count maximum number of checkpoints to delete
     * @return the number of checkpoints deleted
     */    
    function votePowerHistoryCleanup(address _owner, uint256 _count) external onlyCleaner returns (uint256) {
        return votePower.cleanupOldCheckpoints(_owner, _count, cleanupBlockNumber);
    }

    /**
     * Delete vote power cache entry that expired (i.e. is before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _owner vote power owner account address
     * @param _blockNumber the block number for which total supply value was cached
     * @return the number of cache entries deleted (always 0 or 1)
     */    
    function votePowerCacheCleanup(address _owner, uint256 _blockNumber) external onlyCleaner returns (uint256) {
        require(_blockNumber < cleanupBlockNumber, "No cleanup after cleanup block");
        return votePowerCache.deleteValueAt(_owner, _blockNumber);
    }

    /**
     * Delete revocation entry that expired (i.e. is before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _from the delegator address
     * @param _to the delegatee address
     * @param _blockNumber the block number for which total supply value was cached
     * @return the number of revocation entries deleted (always 0 or 1)
     */    
    function revocationCleanup(
        address _from, 
        address _to, 
        uint256 _blockNumber
    )
        external onlyCleaner 
        returns (uint256)
    {
        require(_blockNumber < cleanupBlockNumber, "No cleanup after cleanup block");
        return votePowerCache.deleteRevocationAt(_from, _to, _blockNumber);
    }
    
    /**
     * Delete percentage delegation checkpoints that expired (i.e. are before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _owner balance owner account address
     * @param _count maximum number of checkpoints to delete
     * @return the number of checkpoints deleted
     */    
    function percentageDelegationHistoryCleanup(address _owner, uint256 _count)
        external onlyCleaner 
        returns (uint256)
    {
        return percentageDelegations[_owner].cleanupOldCheckpoints(_count, cleanupBlockNumber);
    }
    
    /**
     * Delete explicit delegation checkpoints that expired (i.e. are before `cleanupBlockNumber`).
     * Method can only be called from the `cleanerContract` (which may be a proxy to external cleaners).
     * @param _from the delegator address
     * @param _to the delegatee address
     * @param _count maximum number of checkpoints to delete
     * @return the number of checkpoints deleted
     */    
    function explicitDelegationHistoryCleanup(address _from, address _to, uint256 _count)
        external
        onlyCleaner 
        returns (uint256)
    {
        return explicitDelegations[_from].cleanupOldCheckpoints(_to, _count, cleanupBlockNumber);
    }
}


// File contracts/token/implementation/VPContract.sol







contract VPContract is IIVPContract, Delegatable {
    using SafeMath for uint256;
    
    /**
     * The VPToken (or some other contract) that owns this VPContract.
     * All state changing methods may be called only from this address.
     * This is because original msg.sender is sent in `_from` parameter
     * and we must be sure that it cannot be faked by directly calling VPContract.
     * Owner token is also used in case of replacement to recover vote powers from balances.
     */
    IVPToken public immutable override ownerToken;
    
    /**
     * Return true if this IIVPContract is configured to be used as a replacement for other contract.
     * It means that vote powers are not necessarily correct at the initialization, therefore
     * every method that reads vote power must check whether it is initialized for that address and block.
     */
    bool public immutable override isReplacement;

    // The block number when vote power for an address was first set.
    // Reading vote power before this block would return incorrect result and must revert.
    mapping (address => uint256) private votePowerInitializationBlock;

    // Vote power cache for past blocks when vote power was not initialized.
    // Reading vote power at that block would return incorrect result, so cache must be set by some other means.
    // No need for revocation info, since there can be no delegations at such block.
    mapping (bytes32 => uint256) private uninitializedVotePowerCache;
    
    string constant private ALREADY_EXPLICIT_MSG = "Already delegated explicitly";
    string constant private ALREADY_PERCENT_MSG = "Already delegated by percentage";
    
    string constant internal VOTE_POWER_NOT_INITIALIZED = "Vote power not initialized";

    /**
     * All external methods in VPContract can only be executed by the owner token.
     */
    modifier onlyOwnerToken {
        require(msg.sender == address(ownerToken), "only owner token");
        _;
    }

    modifier onlyPercent(address sender) {
        // If a delegate cannot be added by percentage, revert.
        require(_canDelegateByPct(sender), ALREADY_EXPLICIT_MSG);
        _;
    }

    modifier onlyExplicit(address sender) {
        // If a delegate cannot be added by explicit amount, revert.
        require(_canDelegateByAmount(sender), ALREADY_PERCENT_MSG);
        _;
    }

    /**
     * Construct VPContract for given VPToken.
     */
    constructor(IVPToken _ownerToken, bool _isReplacement) {
        require(address(_ownerToken) != address(0), "VPContract must belong to a VPToken");
        ownerToken = _ownerToken;
        isReplacement = _isReplacement;
    }
    
    /**
     * Set the cleanup block number.
     * Historic data for the blocks before `cleanupBlockNumber` can be erased,
     * history before that block should never be used since it can be inconsistent.
     * In particular, cleanup block number must be before current vote power block.
     * The method can be called only by the owner token.
     * @param _blockNumber The new cleanup block number.
     */
    function setCleanupBlockNumber(uint256 _blockNumber) external override onlyOwnerToken {
        _setCleanupBlockNumber(_blockNumber);
    }

    /**
     * Set the contract that is allowed to call history cleaning methods.
     * The method can be called only by the owner token.
     */
    function setCleanerContract(address _cleanerContract) external override onlyOwnerToken {
        _setCleanerContract(_cleanerContract);
    }
    
    /**
     * Update vote powers when tokens are transfered.
     * Also update delegated vote powers for percentage delegation
     * and check for enough funds for explicit delegations.
     **/
    function updateAtTokenTransfer(
        address _from, 
        address _to, 
        uint256 _fromBalance,
        uint256 _toBalance,
        uint256 _amount
    )
        external override 
        onlyOwnerToken 
    {
        if (_from == address(0)) {
            // mint new vote power
            _initializeVotePower(_to, _toBalance);
            _mintVotePower(_to, _toBalance, _amount);
        } else if (_to == address(0)) {
            // burn vote power
            _initializeVotePower(_from, _fromBalance);
            _burnVotePower(_from, _fromBalance, _amount);
        } else {
            // transmit vote power _to receiver
            _initializeVotePower(_from, _fromBalance);
            _initializeVotePower(_to, _toBalance);
            _transmitVotePower(_from, _to, _fromBalance, _toBalance, _amount);
        }
    }

    /**
     * @notice Delegate `_bips` percentage of voting power to `_to` from `_from`
     * @param _from The address of the delegator
     * @param _to The address of the recipient
     * @param _balance The delegator's current balance
     * @param _bips The percentage of voting power to be delegated expressed in basis points (1/100 of one percent).
     *   Not cumulative - every call resets the delegation value (and value of 0 revokes delegation).
     **/
    function delegate(
        address _from, 
        address _to, 
        uint256 _balance, 
        uint256 _bips
    )
        external override 
        onlyOwnerToken 
        onlyPercent(_from)
    {
        _initializeVotePower(_from, _balance);
        if (!_votePowerInitialized(_to)) {
            _initializeVotePower(_to, ownerToken.balanceOf(_to));
        }
        _delegateByPercentage(_from, _to, _balance, _bips);
    }
    
    /**
     * @notice Explicitly delegate `_amount` of voting power to `_to` from `_from`.
     * @param _from The address of the delegator
     * @param _to The address of the recipient
     * @param _balance The delegator's current balance
     * @param _amount An explicit vote power amount to be delegated.
     *   Not cumulative - every call resets the delegation value (and value of 0 undelegates `to`).
     **/    
    function delegateExplicit(
        address _from, 
        address _to, 
        uint256 _balance, 
        uint _amount
    )
        external override 
        onlyOwnerToken
        onlyExplicit(_from)
    {
        _initializeVotePower(_from, _balance);
        if (!_votePowerInitialized(_to)) {
            _initializeVotePower(_to, ownerToken.balanceOf(_to));
        }
        _delegateByAmount(_from, _to, _balance, _amount);
    }

    /**
     * @notice Revoke all delegation from `_from` to `_to` at given block. 
     *    Only affects the reads via `votePowerOfAtCached()` in the block `_blockNumber`.
     *    Block `_blockNumber` must be in the past. 
     *    This method should be used only to prevent rogue delegate voting in the current voting block.
     *    To stop delegating use delegate/delegateExplicit with value of 0 or undelegateAll/undelegateAllExplicit.
     * @param _from The address of the delegator
     * @param _to Address of the delegatee
     * @param _balance The delegator's current balance
     * @param _blockNumber The block number at which to revoke delegation.
     **/
    function revokeDelegationAt(
        address _from, 
        address _to, 
        uint256 _balance,
        uint _blockNumber
    )
        external override 
        onlyOwnerToken
    {
        // ASSERT: if there was a delegation, _from and _to must be initialized
        if (!isReplacement || 
            (_votePowerInitializedAt(_from, _blockNumber) && _votePowerInitializedAt(_to, _blockNumber))) {
            _revokeDelegationAt(_from, _to, _balance, _blockNumber);
        }
    }

    /**
     * @notice Undelegate all voting power for delegates of `_from`
     *    Can only be used with percentage delegation.
     *    Does not reset delegation mode back to NOTSET.
     * @param _from The address of the delegator
     **/
    function undelegateAll(
        address _from,
        uint256 _balance
    )
        external override 
        onlyOwnerToken 
        onlyPercent(_from)
    {
        if (_hasAnyDelegations(_from)) {
            // ASSERT: since there were delegations, _from and its targets must be initialized
            _undelegateAllByPercentage(_from, _balance);
        }
    }

    /**
     * @notice Undelegate all explicit vote power by amount delegates for `_from`.
     *    Can only be used with explicit delegation.
     *    Does not reset delegation mode back to NOTSET.
     * @param _from The address of the delegator
     * @param _delegateAddresses Explicit delegation does not store delegatees' addresses, 
     *   so the caller must supply them.
     * @return The amount still delegated (in case the list of delegates was incomplete).
     */
    function undelegateAllExplicit(
        address _from, 
        address[] memory _delegateAddresses
    )
        external override 
        onlyOwnerToken 
        onlyExplicit(_from) 
        returns (uint256)
    {
        if (_hasAnyDelegations(_from)) {
            // ASSERT: since there were delegations, _from and its targets must be initialized
            return _undelegateAllByAmount(_from, _delegateAddresses);
        }
        return 0;
    }
    
    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`
    *   Reads/updates cache and upholds revocations.
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function votePowerOfAtCached(address _who, uint256 _blockNumber) external override returns(uint256) {
        if (!isReplacement || _votePowerInitializedAt(_who, _blockNumber)) {
            // use standard method
            return _votePowerOfAtCached(_who, _blockNumber);
        } else {
            // use uninitialized vote power cache
            bytes32 key = keccak256(abi.encode(_who, _blockNumber));
            uint256 cached = uninitializedVotePowerCache[key];
            if (cached != 0) {
                return cached - 1;  // safe, cached != 0
            }
            uint256 balance = ownerToken.balanceOfAt(_who, _blockNumber);
            uninitializedVotePowerCache[key] = balance.add(1);
            return balance;
        }
    }
    
    /**
     * Get the current cleanup block number.
     */
    function cleanupBlockNumber() external view override returns (uint256) {
        return _cleanupBlockNumber();
    }
    
    /**
     * @notice Get the current vote power of `_who`.
     * @param _who The address to get voting power.
     * @return Current vote power of `_who`.
     */
    function votePowerOf(address _who) external view override returns(uint256) {
        if (_votePowerInitialized(_who)) {
            return _votePowerOf(_who);
        } else {
            return ownerToken.balanceOf(_who);
        }
    }
    
    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`.
    */
    function votePowerOfAt(address _who, uint256 _blockNumber) public view override returns(uint256) {
        if (!isReplacement || _votePowerInitializedAt(_who, _blockNumber)) {
            return _votePowerOfAt(_who, _blockNumber);
        } else {
            return ownerToken.balanceOfAt(_who, _blockNumber);
        }
    }

    /**
    * @notice Get the vote power of `_who` at block `_blockNumber`, ignoring revocation information (and cache).
    * @param _who The address to get voting power.
    * @param _blockNumber The block number at which to fetch.
    * @return Vote power of `_who` at `_blockNumber`. Result doesn't change if vote power is revoked.
    */
    function votePowerOfAtIgnoringRevocation(address _who, uint256 _blockNumber) 
        external view override 
        returns(uint256) 
    {
        if (!isReplacement || _votePowerInitializedAt(_who, _blockNumber)) {
            return _votePowerOfAtIgnoringRevocation(_who, _blockNumber);
        } else {
            return ownerToken.balanceOfAt(_who, _blockNumber);
        }
    }
    
    /**
     * Return vote powers for several addresses in a batch.
     * @param _owners The list of addresses to fetch vote power of.
     * @param _blockNumber The block number at which to fetch.
     * @return _votePowers A list of vote powers corresponding to _owners.
     */    
    function batchVotePowerOfAt(
        address[] memory _owners, 
        uint256 _blockNumber
    )
        external view override 
        returns(uint256[] memory _votePowers)
    {
        _votePowers = _batchVotePowerOfAt(_owners, _blockNumber);
        // zero results might not have been initialized
        if (isReplacement) {
            for (uint256 i = 0; i < _votePowers.length; i++) {
                if (_votePowers[i] == 0 && !_votePowerInitializedAt(_owners[i], _blockNumber)) {
                    _votePowers[i] = ownerToken.balanceOfAt(_owners[i], _blockNumber);
                }
            }
        }
    }
    
    /**
    * @notice Get current delegated vote power `_from` delegator delegated `_to` delegatee.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _balance The delegator's current balance
    * @return The delegated vote power.
    */
    function votePowerFromTo(
        address _from, 
        address _to, 
        uint256 _balance
    )
        external view override 
        returns (uint256)
    {
        // ASSERT: if the result is nonzero, _from and _to are initialized
        return _votePowerFromTo(_from, _to, _balance);
    }
    
    /**
    * @notice Get delegated the vote power `_from` delegator delegated `_to` delegatee at `_blockNumber`.
    * @param _from Address of delegator
    * @param _to Address of delegatee
    * @param _balance The delegator's current balance
    * @param _blockNumber The block number at which to fetch.
    * @return The delegated vote power.
    */
    function votePowerFromToAt(
        address _from, 
        address _to, 
        uint256 _balance,
        uint _blockNumber
    )
        external view override
        returns (uint256)
    {
        // ASSERT: if the result is nonzero, _from and _to were initialized at _blockNumber
        return _votePowerFromToAt(_from, _to, _balance, _blockNumber);
    }
    
    /**
     * @notice Get the delegation mode for '_who'. This mode determines whether vote power is
     *  allocated by percentage or by explicit value.
     * @param _who The address to get delegation mode.
     * @return Delegation mode (NOTSET=0, PERCENTAGE=1, AMOUNT=2))
     */
    function delegationModeOf(address _who) external view override returns (uint256) {
        return uint256(_delegationModeOf(_who));
    }

    /**
     * @notice Compute the current undelegated vote power of `_owner`
     * @param _owner The address to get undelegated voting power.
     * @param _balance Owner's current balance
     * @return The unallocated vote power of `_owner`
     */
    function undelegatedVotePowerOf(
        address _owner,
        uint256 _balance
    )
        external view override
        returns (uint256)
    {
        if (_votePowerInitialized(_owner)) {
            return _undelegatedVotePowerOf(_owner, _balance);
        } else {
            // ASSERT: there are no delegations
            return _balance;
        }
    }
    
    /**
     * @notice Get the undelegated vote power of `_owner` at given block.
     * @param _owner The address to get undelegated voting power.
     * @param _blockNumber The block number at which to fetch.
     * @return The undelegated vote power of `_owner` (= owner's own balance minus all delegations from owner)
     */
    function undelegatedVotePowerOfAt(
        address _owner, 
        uint256 _balance,
        uint256 _blockNumber
    )
        external view override
        returns (uint256)
    {
        if (_votePowerInitialized(_owner)) {
            return _undelegatedVotePowerOfAt(_owner, _balance, _blockNumber);
        } else {
            // ASSERT: there were no delegations at _blockNumber
            return _balance;
        }
    }

    /**
    * @notice Get the vote power delegation `_delegateAddresses` 
    *  and `pcts` of an `_owner`. Returned in two separate positional arrays.
    *  Also returns the count of delegates and delegation mode.
    * @param _owner The address to get delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOf(address _owner)
        external view override 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
        // ASSERT: either _owner is initialized or there are no delegations
        return delegatesOfAt(_owner, block.number);
    }
    
    /**
    * @notice Get the vote power delegation `delegationAddresses` 
    *  and `_bips` of an `_owner`. Returned in two separate positional arrays.
    *  Also returns the count of delegates and delegation mode.
    * @param _owner The address to get delegations.
    * @param _blockNumber The block for which we want to know the delegations.
    * @return _delegateAddresses Positional array of delegation addresses.
    * @return _bips Positional array of delegation percents specified in basis points (1/100 or 1 percent)
    * @return _count The number of delegates.
    * @return _delegationMode The mode of the delegation (NOTSET=0, PERCENTAGE=1, AMOUNT=2).
    */
    function delegatesOfAt(
        address _owner,
        uint256 _blockNumber
    )
        public view override 
        returns (
            address[] memory _delegateAddresses, 
            uint256[] memory _bips,
            uint256 _count,
            uint256 _delegationMode
        )
    {
        // ASSERT: either _owner was initialized or there were no delegations
        DelegationMode mode = _delegationModeOf(_owner);
        if (mode == DelegationMode.PERCENTAGE) {
            // Get the vote power delegation for the _owner
            (_delegateAddresses, _bips) = _percentageDelegatesOfAt(_owner, _blockNumber);
        } else if (mode == DelegationMode.NOTSET) {
            _delegateAddresses = new address[](0);
            _bips = new uint256[](0);
        } else {
            revert ("delegatesOf does not work in AMOUNT delegation mode");
        }
        _count = _delegateAddresses.length;
        _delegationMode = uint256(mode);
    }

    /**
     * Initialize vote power to current balance if not initialized already.
     * @param _owner The address to initialize voting power.
     * @param _balance The owner's current balance.
     */
    function _initializeVotePower(address _owner, uint256 _balance) internal {
        if (!isReplacement) return;
        if (_owner == address(0)) return;    // 0 address is special (usually marks no source/dest - no init needed)
        if (votePowerInitializationBlock[_owner] == 0) {
            // consistency check - no delegations should be made from or to owner before vote power is initialized
            // (that would be dangerous, because vote power would have been delegated incorrectly)
            assert(_votePowerOf(_owner) == 0 && !_hasAnyDelegations(_owner));
            _mintVotePower(_owner, 0, _balance);
            votePowerInitializationBlock[_owner] = block.number.add(1);
        }
    }
    
    /**
     * Has the vote power of `_owner` been initialized?
     * @param _owner The address to check.
     * @return true if vote power of _owner is initialized
     */
    function _votePowerInitialized(address _owner) internal view returns (bool) {
        if (!isReplacement) return true;
        return votePowerInitializationBlock[_owner] != 0;
    }

    /**
     * Was vote power of `_owner` initialized at some block?
     * @param _owner The address to check.
     * @param _blockNumber The block for which we want to check.
     * @return true if vote power of _owner was initialized at _blockNumber
     */
    function _votePowerInitializedAt(address _owner, uint256 _blockNumber) internal view returns (bool) {
        if (!isReplacement) return true;
        uint256 initblock = votePowerInitializationBlock[_owner];
        return initblock != 0 && initblock - 1 <= _blockNumber;
    }
}


// File contracts/userInterfaces/IWNat.sol


interface IWNat {
    /**
     * @notice Deposit native token and mint WNAT ERC20.
     */
    function deposit() external payable;

    /**
     * @notice Withdraw native token and burn WNAT ERC20.
     * @param _amount The amount to withdraw.
     */
    function withdraw(uint256 _amount) external;
    
    /**
     * @notice Deposit native token from msg.sender and mint WNAT ERC20.
     * @param _recipient An address to receive minted WNAT.
     */
    function depositTo(address _recipient) external payable;
    
    /**
     * @notice Withdraw WNAT from an owner and send NAT to msg.sender given an allowance.
     * @param _owner An address spending the native tokens.
     * @param _amount The amount to spend.
     *
     * Requirements:
     *
     * - `_owner` must have a balance of at least `_amount`.
     * - the caller must have allowance for `_owners`'s tokens of at least
     * `_amount`.
     */
    function withdrawFrom(address _owner, uint256 _amount) external;
}


// File contracts/token/implementation/WNat.sol





/**
 * @title Wrapped Native token
 * @notice Accept native token deposits and mint ERC20 WNAT (wrapped native) tokens 1-1.
 * @dev Attribution: https://rinkeby.etherscan.io/address/0xc778417e063141139fce010982780140aa0cd5ab#code 
 */
contract WNat is VPToken, IWNat {
    using SafeMath for uint256;
    event  Deposit(address indexed dst, uint amount);
    event  Withdrawal(address indexed src, uint amount);

    /**
     * Construct an ERC20 token.
     */
    constructor(address _governance, string memory _name, string memory _symbol) 
        VPToken(_governance, _name, _symbol) 
    {
    }

    receive() external payable {
        deposit();
    }

    /**
     * @notice Withdraw WNAT from an owner and send native tokens to msg.sender given an allowance.
     * @param owner An address spending the Native tokens.
     * @param amount The amount to spend.
     *
     * Requirements:
     *
     * - `owner` must have a balance of at least `amount`.
     * - the caller must have allowance for `owners`'s tokens of at least
     * `amount`.
     */
    function withdrawFrom(address owner, uint256 amount) external override {
        // Reduce senders allowance
        _approve(owner, msg.sender, allowance(owner, msg.sender).sub(amount, "allowance below zero"));
        // Burn the owners balance
        _burn(owner, amount);
        // Emit withdraw event
        emit Withdrawal(owner, amount);
        // Move value to sender (last statement, to prevent reentrancy)
        msg.sender.transfer(amount);
    }

    /**
     * @notice Deposit Native from msg.sender and mints WNAT ERC20 to recipient address.
     * @param recipient An address to receive minted WNAT.
     */
    function depositTo(address recipient) external payable override {
        require(recipient != address(0), "Cannot deposit to zero address");
        // Mint WNAT
        _mint(recipient, msg.value);
        // Emit deposit event
        emit Deposit(recipient, msg.value);
    }

    /**
     * @notice Deposit Native and mint wNat ERC20.
     */
    function deposit() public payable override {
        // Mint WNAT
        _mint(msg.sender, msg.value);
        // Emit deposit event
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw Native and burn WNAT ERC20.
     * @param amount The amount to withdraw.
     */
    function withdraw(uint256 amount) external override {
        // Burn WNAT tokens
        _burn(msg.sender, amount);
        // Emit withdrawal event
        emit Withdrawal(msg.sender, amount);
        // Send Native to sender (last statement, to prevent reentrancy)
        msg.sender.transfer(amount);
    }
}


// File contracts/addressUpdater/interface/IIAddressUpdatable.sol



interface IIAddressUpdatable {
    /**
     * @notice Updates contract addresses - should be called only from AddressUpdater contract
     * @param _contractNameHashes       list of keccak256(abi.encode(...)) contract names
     * @param _contractAddresses        list of contract addresses corresponding to the contract names
     */
    function updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
        ) external;
}


// File contracts/addressUpdater/interface/IIAddressUpdater.sol



interface IIAddressUpdater {

    /**
     * @notice Returns all contract names and corresponding addresses
     */
    function getContractNamesAndAddresses() external view returns(
        string[] memory _contractNames,
        address[] memory _contractAddresses
    );

    /**
     * @notice Returns contract address for the given name - might be address(0)
     * @param _name             name of the contract
     */
    function getContractAddress(string calldata _name) external view returns(address);

    /**
     * @notice Returns contract address for the given name hash - might be address(0)
     * @param _nameHash         hash of the contract name (keccak256(abi.encode(name))
     */
    function getContractAddressByHash(bytes32 _nameHash) external view returns(address);

    /**
     * @notice Returns contract addresses for the given names - might be address(0)
     * @param _names            names of the contracts
     */
    function getContractAddresses(string[] calldata _names) external view returns(address[] memory);

    /**
     * @notice Returns contract addresses for the given name hashes - might be address(0)
     * @param _nameHashes       hashes of the contract names (keccak256(abi.encode(name))
     */
    function getContractAddressesByHash(bytes32[] calldata _nameHashes) external view returns(address[] memory);
}


// File contracts/addressUpdater/implementation/AddressUpdater.sol




contract AddressUpdater is IIAddressUpdater, Governed {

    string internal constant ERR_ARRAY_LENGTHS = "array lengths do not match";
    string internal constant ERR_ADDRESS_ZERO = "address zero";

    string[] internal contractNames;
    mapping(bytes32 => address) internal contractAddresses;

    constructor(address _governance) Governed(_governance) {}

    /**
     * @notice set/update contract names/addresses and then apply changes to other contracts
     * @param _contractNames                contracts names
     * @param _contractAddresses            addresses of corresponding contracts names
     * @param _contractsToUpdate            contracts to be updated
     */
    function update(
        string[] memory _contractNames,
        address[] memory _contractAddresses,
        IIAddressUpdatable[] memory _contractsToUpdate
    )
        external onlyGovernance
    {
        _addOrUpdateContractNamesAndAddresses(_contractNames, _contractAddresses);
        _updateContractAddresses(_contractsToUpdate);
    }

    /**
     * @notice Updates contract addresses on all contracts implementing IIAddressUpdatable interface
     * @param _contractsToUpdate            contracts to be updated
     */
    function updateContractAddresses(IIAddressUpdatable[] memory _contractsToUpdate)
        external
        onlyImmediateGovernance
    {
        _updateContractAddresses(_contractsToUpdate);
    }

    /**
     * @notice Add or update contract names and addreses that are later used in updateContractAddresses calls
     * @param _contractNames                contracts names
     * @param _contractAddresses            addresses of corresponding contracts names
     */
    function addOrUpdateContractNamesAndAddresses(
        string[] memory _contractNames,
        address[] memory _contractAddresses
    )
        external onlyGovernance
    {
        _addOrUpdateContractNamesAndAddresses(_contractNames, _contractAddresses);
    }

    /**
     * @notice Remove contracts with given names
     * @param _contractNames                contracts names
     */
    function removeContracts(string[] memory _contractNames) external onlyGovernance {
        for (uint256 i = 0; i < _contractNames.length; i++) {
            string memory contractName = _contractNames[i];
            bytes32 nameHash = _keccak256AbiEncode(contractName);
            require(contractAddresses[nameHash] != address(0), ERR_ADDRESS_ZERO);
            delete contractAddresses[nameHash];
            uint256 index = contractNames.length;
            while (index > 0) {
                index--;
                if (nameHash == _keccak256AbiEncode(contractNames[index])) {
                    break;
                }
            }
            contractNames[index] = contractNames[contractNames.length - 1];
            contractNames.pop();
        }
    }

    /**
     * @notice Returns all contract names and corresponding addresses
     */
    function getContractNamesAndAddresses() external view override returns(
        string[] memory _contractNames,
        address[] memory _contractAddresses
    ) {
        _contractNames = contractNames;
        uint256 len = _contractNames.length;
        _contractAddresses = new address[](len);
        while (len > 0) {
            len--;
            _contractAddresses[len] = contractAddresses[_keccak256AbiEncode(_contractNames[len])];
        }
    }

    /**
     * @notice Returns contract address for the given name - might be address(0)
     * @param _name             name of the contract
     */
    function getContractAddress(string calldata _name) external view override returns(address) {
        return contractAddresses[_keccak256AbiEncode(_name)];
    }

    /**
     * @notice Returns contract address for the given name hash - might be address(0)
     * @param _nameHash         hash of the contract name (keccak256(abi.encode(name))
     */
    function getContractAddressByHash(bytes32 _nameHash) external view override returns(address) {
        return contractAddresses[_nameHash];
    }

    /**
     * @notice Returns contract addresses for the given names - might be address(0)
     * @param _names            names of the contracts
     */
    function getContractAddresses(string[] calldata _names) external view override returns(address[] memory) {
        address[] memory addresses = new address[](_names.length);
        for (uint256 i = 0; i < _names.length; i++) {
            addresses[i] = contractAddresses[_keccak256AbiEncode(_names[i])];
        }
        return addresses;
    }

    /**
     * @notice Returns contract addresses for the given name hashes - might be address(0)
     * @param _nameHashes       hashes of the contract names (keccak256(abi.encode(name))
     */
    function getContractAddressesByHash(
        bytes32[] calldata _nameHashes
    )
        external view override returns(address[] memory)
    {
        address[] memory addresses = new address[](_nameHashes.length);
        for (uint256 i = 0; i < _nameHashes.length; i++) {
            addresses[i] = contractAddresses[_nameHashes[i]];
        }
        return addresses;
    }

    /**
     * @notice Add or update contract names and addreses that are later used in updateContractAddresses calls
     * @param _contractNames                contracts names
     * @param _contractAddresses            addresses of corresponding contracts names
     */
    function _addOrUpdateContractNamesAndAddresses(
        string[] memory _contractNames,
        address[] memory _contractAddresses
    )
        internal
    {
        uint256 len = _contractNames.length;
        require(len == _contractAddresses.length, ERR_ARRAY_LENGTHS);

        for (uint256 i = 0; i < len; i++) {
            require(_contractAddresses[i] != address(0), ERR_ADDRESS_ZERO);
            bytes32 nameHash = _keccak256AbiEncode(_contractNames[i]);
            // add new contract name if address is not known yet
            if (contractAddresses[nameHash] == address(0)) {
                contractNames.push(_contractNames[i]);
            }
            // set or update contract address
            contractAddresses[nameHash] = _contractAddresses[i];
        }
    }

    /**
     * @notice Updates contract addresses on all contracts implementing IIAddressUpdatable interface
     * @param _contractsToUpdate            contracts to be updated
     */
    function _updateContractAddresses(IIAddressUpdatable[] memory _contractsToUpdate) internal {
        uint256 len = contractNames.length;
        bytes32[] memory nameHashes = new bytes32[](len);
        address[] memory addresses = new address[](len);
        while (len > 0) {
            len--;
            nameHashes[len] = _keccak256AbiEncode(contractNames[len]);
            addresses[len] = contractAddresses[nameHashes[len]];
        }

        for (uint256 i = 0; i < _contractsToUpdate.length; i++) {
            _contractsToUpdate[i].updateContractAddresses(nameHashes, addresses);
        }
    }

    /**
     * @notice Returns hash from string value
     */
    function _keccak256AbiEncode(string memory _value) internal pure returns(bytes32) {
        return keccak256(abi.encode(_value));
    }
}


// File contracts/genesis/implementation/GovernanceSettings.sol

// (c) 2021, Flare Networks Limited. All rights reserved.
// Please see the file LICENSE for licensing terms.


/**
 * A special contract that holds Flare governance address.
 * This contract enables updating governance address and timelock only by hard forking the network,
 * meaning only by updating validator code.
 */
contract GovernanceSettings is IGovernanceSettings {

    address public constant SIGNAL_COINBASE = address(0x00000000000000000000000000000000000dEAD0);

    uint256 internal constant MAX_TIMELOCK = 365 days;
    
    address internal constant GENESIS_GOVERNANCE = 0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7;
    
    // governance address set by the validator (set in initialise call, can be changed by fork)
    address private governanceAddress;
    
    // global timelock setting (in seconds), also set by validator (set in initialise call, can be changed by fork)
    uint64 private timelock;
    
    // prevent double initialisation
    bool private initialised;
    
    // executor addresses, changeable anytime by the governance
    address[] private executors;
    mapping (address => bool) private executorMap;

    event GovernanceAddressUpdated(
        uint256 timestamp,
        address oldGovernanceAddress,
        address newGovernanceAddress
    );

    event GovernanceTimelockUpdated(
        uint256 timestamp,
        uint256 oldTimelock,
        uint256 newTimelock
    );

    event GovernanceExecutorsUpdated(
        uint256 timestamp,
        address[] oldExecutors,
        address[] newExecutors
    );

    /**
     * Perform initialisation, which cannot be done in constructor, since this is a genesis contract.
     * Can only be called once.
     */
    function initialise(address _governanceAddress, uint256 _timelock, address[] memory _executors) external {
        require(msg.sender == GENESIS_GOVERNANCE, "only genesis governance");
        require(!initialised, "already initialised");
        require(_timelock < MAX_TIMELOCK, "timelock too large");
        // set the field values
        initialised = true;
        governanceAddress = _governanceAddress;
        timelock = uint64(_timelock);
        _setExecutors(_executors);
    }

    /**
     * Change the governance address.
     * Can only be called by validators via fork.
     */
    function setGovernanceAddress(address _newGovernance) external {
        require(governanceAddress != _newGovernance, "governanceAddress == _newGovernance");
        if (msg.sender == block.coinbase && block.coinbase == SIGNAL_COINBASE) {
            emit GovernanceAddressUpdated(block.timestamp, governanceAddress, _newGovernance);
            governanceAddress = _newGovernance;
        }
    }

    /**
     * Change the timelock.
     * Can only be called by validators via fork.
     */
    function setTimelock(uint256 _newTimelock) external {
        require(timelock != _newTimelock, "timelock == _newTimelock");
        require(_newTimelock < MAX_TIMELOCK, "timelock too large");
        if (msg.sender == block.coinbase && block.coinbase == SIGNAL_COINBASE) {
            emit GovernanceTimelockUpdated(block.timestamp, timelock, _newTimelock);
            timelock = uint64(_newTimelock);
        }
    }
    
    /**
     * Set the addresses of the accounts that are allowed to execute the timelocked governance calls
     * once the timelock period expires.
     * It isn't very dangerous to allow for anyone to execute timelocked calls, but we reserve the right to
     * make sure the timing of the execution is under control.
     * Can only be called by the governance.
     */
    function setExecutors(address[] memory _newExecutors) external {
        require(msg.sender == governanceAddress, "only governance");
        _setExecutors(_newExecutors);
    }
    
    /**
     * Get the governance account address.
     */
    function getGovernanceAddress() external view override returns (address) {
        return governanceAddress;
    }
    
    /**
     * Get the time that must pass between a governance call and execution.
     */
    function getTimelock() external view override returns (uint256) {
        return timelock;
    }
    
    /**
     * Get the addresses of the accounts that are allowed to execute the timelocked governance calls
     * once the timelock period expires.
     */
    function getExecutors() external view override returns (address[] memory) {
        return executors;
    }
    
    /**
     * Check whether an address is allowed to execute an governance call after timelock expires.
     */
    function isExecutor(address _address) external view override returns (bool) {
        return executorMap[_address];
    }

    function _setExecutors(address[] memory _newExecutors) private {
        emit GovernanceExecutorsUpdated(block.timestamp, executors, _newExecutors);
        // clear old
        while (executors.length > 0) {
            executorMap[executors[executors.length - 1]] = false;
            executors.pop();
        }
        // set new
        for (uint256 i = 0; i < _newExecutors.length; i++) {
            executors.push(_newExecutors[i]);
            executorMap[_newExecutors[i]] = true;
        }
    }
}


// File contracts/genesis/interface/IFtsoGenesis.sol



interface IFtsoGenesis {

    /**
     * @notice Reveals submitted price during epoch reveal period - only price submitter
     * @param _voter                Voter address
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @param _price                Submitted price in USD
     * @notice The hash of _price and _random must be equal to the submitted hash
     * @notice Emits PriceRevealed event
     */
    function revealPriceSubmitter(
        address _voter,
        uint256 _epochId,
        uint256 _price,
        uint256 _wNatVP
    ) external;

    /**
     * @notice Get (and cache) wNat vote power for specified voter and given epoch id
     * @param _voter                Voter address
     * @param _epochId              Id of the epoch in which the price hash was submitted
     * @return wNat vote power
     */
    function wNatVotePowerCached(address _voter, uint256 _epochId) external returns (uint256);
}


// File contracts/userInterfaces/IFtso.sol


interface IFtso {
    enum PriceFinalizationType {
        // initial state
        NOT_FINALIZED,
        // median calculation used to find price
        WEIGHTED_MEDIAN,
        // low turnout - price calculated from median of trusted addresses
        TRUSTED_ADDRESSES,
        // low turnout + no votes from trusted addresses - price copied from previous epoch
        PREVIOUS_PRICE_COPIED,
        // price calculated from median of trusted addresses - triggered due to an exception
        TRUSTED_ADDRESSES_EXCEPTION,
        // previous price copied - triggered due to an exception
        PREVIOUS_PRICE_COPIED_EXCEPTION
    }

    event PriceRevealed(
        address indexed voter, uint256 indexed epochId, uint256 price, uint256 timestamp,
        uint256 votePowerNat, uint256 votePowerAsset
    );

    event PriceFinalized(
        uint256 indexed epochId, uint256 price, bool rewardedFtso,
        uint256 lowRewardPrice, uint256 highRewardPrice, PriceFinalizationType finalizationType,
        uint256 timestamp
    );

    event PriceEpochInitializedOnFtso(
        uint256 indexed epochId, uint256 endTime, uint256 timestamp
    );

    event LowTurnout(
        uint256 indexed epochId,
        uint256 natTurnout,
        uint256 lowNatTurnoutThresholdBIPS,
        uint256 timestamp
    );

    /**
     * @notice Returns if FTSO is active
     */
    function active() external view returns (bool);

    /**
     * @notice Returns the FTSO symbol
     */
    function symbol() external view returns (string memory);

    /**
     * @notice Returns current epoch id
     */
    function getCurrentEpochId() external view returns (uint256);

    /**
     * @notice Returns id of the epoch which was opened for price submission at the specified timestamp
     * @param _timestamp            Timestamp as seconds from unix epoch
     */
    function getEpochId(uint256 _timestamp) external view returns (uint256);
    
    /**
     * @notice Returns random number of the specified epoch
     * @param _epochId              Id of the epoch
     */
    function getRandom(uint256 _epochId) external view returns (uint256);

    /**
     * @notice Returns asset price consented in specific epoch
     * @param _epochId              Id of the epoch
     * @return Price in USD multiplied by ASSET_PRICE_USD_DECIMALS
     */
    function getEpochPrice(uint256 _epochId) external view returns (uint256);

    /**
     * @notice Returns current epoch data
     * @return _epochId                 Current epoch id
     * @return _epochSubmitEndTime      End time of the current epoch price submission as seconds from unix epoch
     * @return _epochRevealEndTime      End time of the current epoch price reveal as seconds from unix epoch
     * @return _votePowerBlock          Vote power block for the current epoch
     * @return _fallbackMode            Current epoch in fallback mode - only votes from trusted addresses will be used
     * @dev half-closed intervals - end time not included
     */
    function getPriceEpochData() external view returns (
        uint256 _epochId,
        uint256 _epochSubmitEndTime,
        uint256 _epochRevealEndTime,
        uint256 _votePowerBlock,
        bool _fallbackMode
    );

    /**
     * @notice Returns current epoch data
     * @return _firstEpochStartTs           First epoch start timestamp
     * @return _submitPeriodSeconds         Submit period in seconds
     * @return _revealPeriodSeconds         Reveal period in seconds
     */
    function getPriceEpochConfiguration() external view returns (
        uint256 _firstEpochStartTs,
        uint256 _submitPeriodSeconds,
        uint256 _revealPeriodSeconds
    );
    
    /**
     * @notice Returns asset price submitted by voter in specific epoch
     * @param _epochId              Id of the epoch
     * @param _voter                Address of the voter
     * @return Price in USD multiplied by ASSET_PRICE_USD_DECIMALS
     */
    function getEpochPriceForVoter(uint256 _epochId, address _voter) external view returns (uint256);

    /**
     * @notice Returns current asset price
     * @return _price               Price in USD multiplied by ASSET_PRICE_USD_DECIMALS
     * @return _timestamp           Time when price was updated for the last time
     */
    function getCurrentPrice() external view returns (uint256 _price, uint256 _timestamp);

    /**
     * @notice Returns current asset price and number of decimals
     * @return _price                   Price in USD multiplied by ASSET_PRICE_USD_DECIMALS
     * @return _timestamp               Time when price was updated for the last time
     * @return _assetPriceUsdDecimals   Number of decimals used for USD price
     */
    function getCurrentPriceWithDecimals() external view returns (
        uint256 _price,
        uint256 _timestamp,
        uint256 _assetPriceUsdDecimals
    );
    
    /**
     * @notice Returns current asset price calculated from trusted providers
     * @return _price               Price in USD multiplied by ASSET_PRICE_USD_DECIMALS
     * @return _timestamp           Time when price was updated for the last time
     */
    function getCurrentPriceFromTrustedProviders() external view returns (uint256 _price, uint256 _timestamp);

    /**
     * @notice Returns current asset price calculated from trusted providers and number of decimals
     * @return _price                   Price in USD multiplied by ASSET_PRICE_USD_DECIMALS
     * @return _timestamp               Time when price was updated for the last time
     * @return _assetPriceUsdDecimals   Number of decimals used for USD price
     */
    function getCurrentPriceWithDecimalsFromTrustedProviders() external view returns (
        uint256 _price,
        uint256 _timestamp,
        uint256 _assetPriceUsdDecimals
    );

    /**
     * @notice Returns current asset price details
     * @return _price                                   Price in USD multiplied by ASSET_PRICE_USD_DECIMALS
     * @return _priceTimestamp                          Time when price was updated for the last time
     * @return _priceFinalizationType                   Finalization type when price was updated for the last time
     * @return _lastPriceEpochFinalizationTimestamp     Time when last price epoch was finalized
     * @return _lastPriceEpochFinalizationType          Finalization type of last finalized price epoch
     */
    function getCurrentPriceDetails() external view returns (
        uint256 _price,
        uint256 _priceTimestamp,
        PriceFinalizationType _priceFinalizationType,
        uint256 _lastPriceEpochFinalizationTimestamp,
        PriceFinalizationType _lastPriceEpochFinalizationType
    );

    /**
     * @notice Returns current random number
     */
    function getCurrentRandom() external view returns (uint256);
}


// File contracts/ftso/interface/IIFtso.sol




interface IIFtso is IFtso, IFtsoGenesis {

    /// function finalizePriceReveal
    /// called by reward manager only on correct timing.
    /// if price reveal period for epoch x ended. finalize.
    /// iterate list of price submissions
    /// find weighted median
    /// find adjucant 50% of price submissions.
    /// Allocate reward for any price submission which is same as a "winning" submission
    function finalizePriceEpoch(uint256 _epochId, bool _returnRewardData) external
        returns(
            address[] memory _eligibleAddresses,
            uint256[] memory _natWeights,
            uint256 _totalNatWeight
        );

    function fallbackFinalizePriceEpoch(uint256 _epochId) external;

    function forceFinalizePriceEpoch(uint256 _epochId) external;

    // activateFtso will be called by ftso manager once ftso is added 
    // before this is done, FTSO can't run
    function activateFtso(
        uint256 _firstEpochStartTs,
        uint256 _submitPeriodSeconds,
        uint256 _revealPeriodSeconds
    ) external;

    function deactivateFtso() external;

    // update initial price and timestamp - only if not active
    function updateInitialPrice(uint256 _initialPriceUSD, uint256 _initialPriceTimestamp) external;

    function configureEpochs(
        uint256 _maxVotePowerNatThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowNatTurnoutThresholdBIPS,
        address[] memory _trustedAddresses
    ) external;

    function setAsset(IIVPToken _asset) external;

    function setAssetFtsos(IIFtso[] memory _assetFtsos) external;

    // current vote power block will update per reward epoch. 
    // the FTSO doesn't have notion of reward epochs.
    // reward manager only can set this data. 
    function setVotePowerBlock(uint256 _blockNumber) external;

    function initializeCurrentEpochStateForReveal(uint256 _circulatingSupplyNat, bool _fallbackMode) external;
  
    /**
     * @notice Returns ftso manager address
     */
    function ftsoManager() external view returns (address);

    /**
     * @notice Returns the FTSO asset
     * @dev Asset is null in case of multi-asset FTSO
     */
    function getAsset() external view returns (IIVPToken);

    /**
     * @notice Returns the Asset FTSOs
     * @dev AssetFtsos is not null only in case of multi-asset FTSO
     */
    function getAssetFtsos() external view returns (IIFtso[] memory);

    /**
     * @notice Returns current configuration of epoch state
     * @return _maxVotePowerNatThresholdFraction        High threshold for native token vote power per voter
     * @return _maxVotePowerAssetThresholdFraction      High threshold for asset vote power per voter
     * @return _lowAssetUSDThreshold            Threshold for low asset vote power
     * @return _highAssetUSDThreshold           Threshold for high asset vote power
     * @return _highAssetTurnoutThresholdBIPS   Threshold for high asset turnout
     * @return _lowNatTurnoutThresholdBIPS      Threshold for low nat turnout
     * @return _trustedAddresses                Trusted addresses - use their prices if low nat turnout is not achieved
     */
    function epochsConfiguration() external view 
        returns (
            uint256 _maxVotePowerNatThresholdFraction,
            uint256 _maxVotePowerAssetThresholdFraction,
            uint256 _lowAssetUSDThreshold,
            uint256 _highAssetUSDThreshold,
            uint256 _highAssetTurnoutThresholdBIPS,
            uint256 _lowNatTurnoutThresholdBIPS,
            address[] memory _trustedAddresses
        );

    /**
     * @notice Returns parameters necessary for approximately replicating vote weighting.
     * @return _assets                  the list of Assets that are accounted in vote
     * @return _assetMultipliers        weight of each asset in (multiasset) ftso, mutiplied by TERA
     * @return _totalVotePowerNat       total native token vote power at block
     * @return _totalVotePowerAsset     total combined asset vote power at block
     * @return _assetWeightRatio        ratio of combined asset vp vs. native token vp (in BIPS)
     * @return _votePowerBlock          vote powewr block for given epoch
     */
    function getVoteWeightingParameters() external view 
        returns (
            IIVPToken[] memory _assets,
            uint256[] memory _assetMultipliers,
            uint256 _totalVotePowerNat,
            uint256 _totalVotePowerAsset,
            uint256 _assetWeightRatio,
            uint256 _votePowerBlock
        );

    function wNat() external view returns (IIVPToken);
}


// File contracts/genesis/interface/IFtsoRegistryGenesis.sol


interface IFtsoRegistryGenesis {

    function getFtsos(uint256[] memory _indices) external view returns(IFtsoGenesis[] memory _ftsos);
}


// File contracts/userInterfaces/IFtsoRegistry.sol



interface IFtsoRegistry is IFtsoRegistryGenesis {

    struct PriceInfo {
        uint256 ftsoIndex;
        uint256 price;
        uint256 decimals;
        uint256 timestamp;
    }

    function getFtso(uint256 _ftsoIndex) external view returns(IIFtso _activeFtsoAddress);
    function getFtsoBySymbol(string memory _symbol) external view returns(IIFtso _activeFtsoAddress);
    function getSupportedIndices() external view returns(uint256[] memory _supportedIndices);
    function getSupportedSymbols() external view returns(string[] memory _supportedSymbols);
    function getSupportedFtsos() external view returns(IIFtso[] memory _ftsos);
    function getFtsoIndex(string memory _symbol) external view returns (uint256 _assetIndex);
    function getFtsoSymbol(uint256 _ftsoIndex) external view returns (string memory _symbol);
    function getCurrentPrice(uint256 _ftsoIndex) external view returns(uint256 _price, uint256 _timestamp);
    function getCurrentPrice(string memory _symbol) external view returns(uint256 _price, uint256 _timestamp);
    function getCurrentPriceWithDecimals(uint256 _assetIndex) external view
        returns(uint256 _price, uint256 _timestamp, uint256 _assetPriceUsdDecimals);
    function getCurrentPriceWithDecimals(string memory _symbol) external view
        returns(uint256 _price, uint256 _timestamp, uint256 _assetPriceUsdDecimals);

    function getAllCurrentPrices() external view returns (PriceInfo[] memory);
    function getCurrentPricesByIndices(uint256[] memory _indices) external view returns (PriceInfo[] memory);
    function getCurrentPricesBySymbols(string[] memory _symbols) external view returns (PriceInfo[] memory);

    function getSupportedIndicesAndFtsos() external view 
        returns(uint256[] memory _supportedIndices, IIFtso[] memory _ftsos);

    function getSupportedSymbolsAndFtsos() external view 
        returns(string[] memory _supportedSymbols, IIFtso[] memory _ftsos);

    function getSupportedIndicesAndSymbols() external view 
        returns(uint256[] memory _supportedIndices, string[] memory _supportedSymbols);

    function getSupportedIndicesSymbolsAndFtsos() external view 
        returns(uint256[] memory _supportedIndices, string[] memory _supportedSymbols, IIFtso[] memory _ftsos);
}


// File contracts/utils/interface/IIFtsoRegistry.sol



interface IIFtsoRegistry is IFtsoRegistry {

    // returns ftso index
    function addFtso(IIFtso _ftsoContract) external returns(uint256);

    function removeFtso(IIFtso _ftso) external;
}


// File contracts/genesis/interface/IFtsoManagerGenesis.sol



interface IFtsoManagerGenesis {

    function getCurrentPriceEpochId() external view returns (uint256 _priceEpochId);

}


// File contracts/userInterfaces/IFtsoManager.sol



interface IFtsoManager is IFtsoManagerGenesis {

    event FtsoAdded(IIFtso ftso, bool add);
    event FallbackMode(bool fallbackMode);
    event FtsoFallbackMode(IIFtso ftso, bool fallbackMode);
    event RewardEpochFinalized(uint256 votepowerBlock, uint256 startBlock);
    event PriceEpochFinalized(address chosenFtso, uint256 rewardEpochId);
    event InitializingCurrentEpochStateForRevealFailed(IIFtso ftso, uint256 epochId);
    event FinalizingPriceEpochFailed(IIFtso ftso, uint256 epochId, IFtso.PriceFinalizationType failingType);
    event DistributingRewardsFailed(address ftso, uint256 epochId);
    event AccruingUnearnedRewardsFailed(uint256 epochId);

    function active() external view returns (bool);

    function getCurrentRewardEpoch() external view returns (uint256);

    function getRewardEpochVotePowerBlock(uint256 _rewardEpoch) external view returns (uint256);

    function getRewardEpochToExpireNext() external view returns (uint256);
    
    function getCurrentPriceEpochData() external view 
        returns (
            uint256 _priceEpochId,
            uint256 _priceEpochStartTimestamp,
            uint256 _priceEpochEndTimestamp,
            uint256 _priceEpochRevealEndTimestamp,
            uint256 _currentTimestamp
        );

    function getFtsos() external view returns (IIFtso[] memory _ftsos);

    function getPriceEpochConfiguration() external view 
        returns (
            uint256 _firstPriceEpochStartTs,
            uint256 _priceEpochDurationSeconds,
            uint256 _revealEpochDurationSeconds
        );

    function getRewardEpochConfiguration() external view 
        returns (
            uint256 _firstRewardEpochStartTs,
            uint256 _rewardEpochDurationSeconds
        );

    function getFallbackMode() external view 
        returns (
            bool _fallbackMode,
            IIFtso[] memory _ftsos,
            bool[] memory _ftsoInFallbackMode
        );
}


// File contracts/genesis/interface/IFlareDaemonize.sol



/// Any contracts that want to recieve a trigger from Flare daemon should 
///     implement IFlareDaemonize
interface IFlareDaemonize {

    /// Implement this function for recieving a trigger from FlareDaemon.
    function daemonize() external returns (bool);
    
    /// This function will be called after an error is caught in daemonize().
    /// It will switch the contract to a simpler fallback mode, which hopefully works when full mode doesn't.
    /// Not every contract needs to support fallback mode (FtsoManager does), so this method may be empty.
    /// Switching back to normal mode is left to the contract (typically a governed method call).
    /// This function may be called due to low-gas error, so it shouldn't use more than ~30.000 gas.
    /// @return true if switched to fallback mode, false if already in fallback mode or if falback not supported
    function switchToFallbackMode() external returns (bool);

    
    /// Implement this function for updating daemonized contracts through AddressUpdater.
    function getContractName() external view returns (string memory);
}


// File contracts/ftso/interface/IIFtsoManager.sol





interface IIFtsoManager is IFtsoManager, IFlareDaemonize {

    struct RewardEpochData {
        uint256 votepowerBlock;
        uint256 startBlock;
        uint256 startTimestamp;
    }

    event ClosingExpiredRewardEpochFailed(uint256 rewardEpoch);
    event CleanupBlockNumberManagerFailedForBlock(uint256 blockNumber);
    event UpdatingActiveValidatorsTriggerFailed(uint256 rewardEpoch);
    event FtsoDeactivationFailed(IIFtso ftso);

    function activate() external;

    function setInitialRewardData(
        uint256 _nextRewardEpochToExpire,
        uint256 _rewardEpochsLength,
        uint256 _currentRewardEpochEnds
    ) external;

    function setGovernanceParameters(
        uint256 _maxVotePowerNatThresholdFraction,
        uint256 _maxVotePowerAssetThresholdFraction,
        uint256 _lowAssetUSDThreshold,
        uint256 _highAssetUSDThreshold,
        uint256 _highAssetTurnoutThresholdBIPS,
        uint256 _lowNatTurnoutThresholdBIPS,
        uint256 _rewardExpiryOffsetSeconds,
        address[] memory _trustedAddresses
    ) external;
    

    function addFtso(IIFtso _ftso) external;

    function addFtsosBulk(IIFtso[] memory _ftsos) external;

    function removeFtso(IIFtso _ftso) external;

    function replaceFtso(
        IIFtso _ftsoToAdd,
        bool copyCurrentPrice,
        bool copyAssetOrAssetFtsos
    ) external;

    function replaceFtsosBulk(
        IIFtso[] memory _ftsosToAdd,
        bool copyCurrentPrice,
        bool copyAssetOrAssetFtsos
    ) external;

    function setFtsoAsset(IIFtso _ftso, IIVPToken _asset) external;

    function setFtsoAssetFtsos(IIFtso _ftso, IIFtso[] memory _assetFtsos) external;

    function setFallbackMode(bool _fallbackMode) external;

    function setFtsoFallbackMode(IIFtso _ftso, bool _fallbackMode) external;

    function notInitializedFtsos(IIFtso) external view returns (bool);

    function getRewardEpochData(uint256 _rewardEpochId) external view returns (RewardEpochData memory);

    function currentRewardEpochEnds() external view returns (uint256);

    function getLastUnprocessedPriceEpochData() external view
        returns(
            uint256 _lastUnprocessedPriceEpoch,
            uint256 _lastUnprocessedPriceEpochRevealEnds,
            bool _lastUnprocessedPriceEpochInitialized
        );

    function rewardEpochsStartTs() external view returns(uint256);

    function rewardEpochDurationSeconds() external view returns(uint256);

    function rewardEpochs(uint256 _rewardEpochId) external view 
        returns (
            uint256 _votepowerBlock,
            uint256 _startBlock,
            uint256 _startTimestamp
        );

    function getRewardExpiryOffsetSeconds() external view returns (uint256);
}
