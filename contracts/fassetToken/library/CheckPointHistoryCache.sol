// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./CheckPointHistory.sol";


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
