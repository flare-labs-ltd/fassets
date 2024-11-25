// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

contract TestUUPSProxyImpl is UUPSUpgradeable {
    uint256[1000] private _dummy;  // skip original storage
    string private message;
    bool private initialized;

    function _authorizeUpgrade(address newImplementation) internal override {}

    function initialize(string memory _message) external {
        message = _message;
        initialized = true;
    }

    function testResult() external view returns (string memory) {
        return initialized ? message : "test proxy";
    }

    function implementation() external view returns (address) {
        return _getImplementation();
    }
}
