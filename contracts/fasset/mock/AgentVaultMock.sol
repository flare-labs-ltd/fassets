// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

contract AgentVaultMock {

    address public assetManager;
    address public owner;

    constructor(address _assetManager, address _owner) {
        assetManager = _assetManager;
        owner = _owner;
    }
}