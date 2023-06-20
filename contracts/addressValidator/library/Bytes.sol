// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

library Bytes {
    function slice(
        bytes memory _data,
        uint256 _start,
        uint256 _end
    )
        internal pure
        returns (bytes memory)
    {
        unchecked {
            bytes memory ret = new bytes(_end - _start);
            for (uint256 i = 0; i < _end - _start; i++) {
                ret[i] = _data[i + _start];
            }
            return ret;
        }
    }

    function equal(
        bytes memory _a,
        bytes memory _b
    )
        internal pure
        returns (bool)
    {
        uint256 length = _a.length;
        if (length != _b.length) return false;
        for (uint256 i = 0; i < length; i++) {
            if (_a[i] != _b[i]) return false;
        }
        return true;
    }
}
