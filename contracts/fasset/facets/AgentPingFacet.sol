// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../../userInterfaces/IAgentPing.sol";
import "../library/Agents.sol";
import "../../diamond/library/LibDiamond.sol";
import "./AssetManagerBase.sol";

contract AgentPingFacet is AssetManagerBase, IAgentPing {
    // this method is not accessible through diamond proxy
    // it is only used for initialization when the contract is added after proxy deploy
    function initAgentPingFacet() external {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        require(ds.supportedInterfaces[type(IERC165).interfaceId], "diamond not initialized");
        ds.supportedInterfaces[type(IAgentPing).interfaceId] = true;
    }

    function agentPing(address _agentVault, uint256 _query) external {
        emit AgentPing(msg.sender, _agentVault, _query);
    }

    function agentPingResponse(address _agentVault, uint256 _query, string memory _response) external {
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireAgentVaultOwner(agent);
        emit AgentPingResponse(agent.ownerManagementAddress, _agentVault, _query, _response);
    }
}
