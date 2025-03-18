// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


interface IAgentAlwaysAllowedMinters {
    function addAlwaysAllowedMinterForAgent(address _agentVault, address _minter)
        external;

    function removeAlwaysAllowedMinterForAgent(address _agentVault, address _minter)
        external;

    function alwaysAllowedMintersForAgent(address _agentVault)
        external view
        returns (address[] memory);
}
