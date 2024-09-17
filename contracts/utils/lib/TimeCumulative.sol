// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";


library TimeCumulative {
    using SafeCast for uint256;

    struct DataPoint {
        uint128 cumulative;
        uint64 timestamp;
        uint64 value;
    }

    struct Data {
        mapping(uint256 => DataPoint) points;
        uint64 startIndex;
        uint64 endIndex;
    }

    uint256 private constant BEFORE_START = type(uint256).max;

    // assumed: _epochStart, _data.lastUpdateTs <= block.timestamp
    function addDataPoint(Data storage _data, uint256 _timestamp, uint64 _value) internal {
        if (_data.endIndex == 0) {
            assert(_data.startIndex == 0);
            _data.points[_data.endIndex++] = DataPoint({
                cumulative: 0,
                timestamp: _timestamp.toUint64(),
                value: _value
            });
        } else {
            assert(_data.endIndex > _data.startIndex);
            DataPoint storage last = _data.points[_data.endIndex - 1];
            if (last.timestamp == _timestamp) {
                last.value = _value;
            } else {
                require(_timestamp > last.timestamp, "TimeCumulative: timestamp not increasing");
                uint256 cumulative = last.cumulative + uint256(last.value) * (_timestamp - last.timestamp);
                _data.points[_data.endIndex++] = DataPoint({
                    cumulative: cumulative.toUint128(),
                    timestamp: _timestamp.toUint64(),
                    value: _value
                });
            }
        }
    }

    function cleanup(Data storage _data, uint256 _keepFromTimestamp, uint256 _maxPoints) internal {
        uint256 start = _data.startIndex;
        uint256 end = _data.endIndex;
        uint256 count = 0;
        // must leave at least 1 point before _keepFromTimestamp
        while (count < _maxPoints && start + 1 < end && _data.points[start + 1].timestamp < _keepFromTimestamp) {
            delete _data.points[start];
            ++start;
            ++count;
        }
        _data.startIndex = start.toUint64();
    }

    function lastValue(Data storage _data) internal view returns (uint64) {
        if (_data.endIndex == 0) return 0;
        assert(_data.endIndex > _data.startIndex);
        return _data.points[_data.endIndex - 1].value;
    }

    function cumulativeTo(Data storage _data, uint256 _ts) internal view returns (uint256) {
        uint256 index = binarySearch(_data, _ts);
        if (index == BEFORE_START) {
            require(_data.startIndex == 0, "TimeCumulative: already cleaned up");
            return 0;
        } else {
            DataPoint storage dp = _data.points[index];
            return dp.cumulative + uint256(dp.value) * (_ts - dp.timestamp);
        }
    }

    function intervalCumulative(Data storage _data, uint256 _fromTs, uint256 _toTs) internal view returns (uint256) {
        require(_fromTs <= _toTs, "TimeCumulative: interval end before start");
        return cumulativeTo(_data, _toTs) - cumulativeTo(_data, _fromTs);
    }

    /**
     * Return highest index `i` such that `_data[i].timestamp <= _ts` or BEFORE_START if
     * `_ts` is before all points in `_data` (including if `_data` is empty).
     */
    function binarySearch(Data storage _data, uint256 _ts) internal view returns (uint256) {
        uint256 start = _data.startIndex;
        uint256 end = _data.endIndex;
        if (start >= end || _data.points[start].timestamp > _ts) {
            return BEFORE_START;
        }
        while (end > start + 1) {
            uint256 mid = (start + end) >> 1;
            if (_data.points[mid].timestamp <= _ts) {
                start = mid;
            } else {
                end = mid;
            }
        }
        return start;
    }
}
