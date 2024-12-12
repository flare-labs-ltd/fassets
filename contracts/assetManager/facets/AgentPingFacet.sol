// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../../userInterfaces/IAgentPing.sol";
import "../library/Agents.sol";
import "../../diamond/library/LibDiamond.sol";
import "./AssetManagerBase.sol";

contract AgentPingFacet is AssetManagerBase, IAgentPing {
    function agentPing(address _agentVault, uint256 _query) external {
        emit AgentPing(_agentVault, msg.sender, _query);
    }

    function agentPingResponse(address _agentVault, uint256 _query, string memory _response) external {
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireAgentVaultOwner(agent);
        emit AgentPingResponse(_agentVault, agent.ownerManagementAddress, _query, _response);
    }
}
