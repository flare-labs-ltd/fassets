// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

contract TestUUPSProxyImpl is UUPSUpgradeable {
    function _authorizeUpgrade(address newImplementation) internal override {}

    function testResult() external pure returns (string memory) {
        return "test proxy";
    }
}
