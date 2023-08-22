// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../library/Base58.sol";


library Base58Mock {
    function decode(bytes memory _data, bytes memory _alphabet) external pure returns (bytes memory, bool) {
        return Base58.decode(_data, _alphabet);
    }
}