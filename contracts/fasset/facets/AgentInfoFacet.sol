// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../userInterfaces/assetManager/IAgentInfo.sol";
import "../library/AgentsExternal.sol";
import "../library/FullAgentInfo.sol";
import "./AssetManagerBase.sol";


contract AgentInfoFacet is AssetManagerBase, IAgentInfo {
    /**
     * Get (a part of) the list of all agents.
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAllAgents(
        uint256 _start,
        uint256 _end
    )
        external view override
        returns (address[] memory _agents, uint256 _totalLength)
    {
        return AgentsExternal.getAllAgents(_start, _end);
    }

    /**
     * Return basic info about an agent, typically needed by a minter.
     * @param _agentVault agent vault address
     * @return structure containing agent's minting fee (BIPS), min collateral ratio (BIPS),
     *      and current free collateral (lots)
     */
    function getAgentInfo(
        address _agentVault
    )
        external view override
        returns (AgentInfo.Info memory)
    {
        return FullAgentInfo.getAgentInfo(_agentVault);
    }

    function getCollateralPool(address _agentVault)
        external view override
        returns (address)
    {
        return address(Agent.get(_agentVault).collateralPool);
    }

    function getAgentVaultOwner(address _agentVault)
        external view override
        returns (address _ownerManagementAddress)
    {
        return AgentsExternal.getAgentVaultOwner(_agentVault);
    }
}
