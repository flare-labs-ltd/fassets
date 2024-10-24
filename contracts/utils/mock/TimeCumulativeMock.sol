// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../lib/TimeCumulative.sol";


contract TimeCumulativeMock {
    using SafeCast for uint256;

    TimeCumulative.Data private data;

    function setData(TimeCumulative.DataPoint[] memory _points, uint256 _startIndex, uint256 _endIndex) external {
        // delete old
        for (uint256 i = data.startIndex; i < data.endIndex; i++) delete data.points[i];
        // set new
        data.startIndex = _startIndex.toUint64();
        data.endIndex = _endIndex.toUint64();
        for (uint256 i = _startIndex; i < _endIndex; i++) data.points[i] = _points[i];
    }

    function getData()
        external view
        returns (TimeCumulative.DataPoint[] memory _points, uint256 _startIndex, uint256 _endIndex)
    {
        _startIndex = data.startIndex;
        _endIndex = data.endIndex;
        _points = new TimeCumulative.DataPoint[](_endIndex);
        for (uint256 i = 0; i < _endIndex; i++) _points[i] = data.points[i];
    }

    function addDataPoint(uint256 _timestamp, uint64 _value) external {
        TimeCumulative.addDataPoint(data, _timestamp, _value);
    }

    function cleanup(uint256 _untilTimestamp, uint256 _maxPoints) external {
        TimeCumulative.cleanup(data, _untilTimestamp, _maxPoints);
    }

    function cumulativeTo(uint256 _ts) external view returns (uint256) {
        return TimeCumulative.cumulativeTo(data, _ts);
    }

    function intervalCumulative(uint256 _fromTs, uint256 _toTs) external view returns (uint256) {
        return TimeCumulative.intervalCumulative(data, _fromTs, _toTs);
    }

    function binarySearch(uint256 _ts) external view returns (uint256) {
        return TimeCumulative.binarySearch(data, _ts);
    }
}
