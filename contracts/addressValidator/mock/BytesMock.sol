// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "../library/Bytes.sol";


contract BytesMock {
    function equal(
        bytes memory _a,
        bytes memory _b
    )
        external pure
        returns (bool)
    {
        return Bytes.equal(_a, _b);
    }
}
