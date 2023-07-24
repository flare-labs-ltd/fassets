// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../interface/IICollateralPool.sol";

contract AgentVaultMock {

    address public assetManager;
    address public owner;

    constructor(address _assetManager, address _owner) {
        assetManager = _assetManager;
        owner = _owner;
    }

    receive() external payable {}

    function callFunctionAt(address _contract, bytes memory _payload) external {
        (bool success, bytes memory data) = _contract.call(_payload);
        require(success, string(data));
    }

    function enterPool(IICollateralPool _collateralPool) external payable {
        _collateralPool.enter{value: msg.value}(0, false);
    }
}
