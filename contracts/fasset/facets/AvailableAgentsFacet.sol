// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../library/AvailableAgents.sol";
import "./AssetManagerBase.sol";


contract AvailableAgentsFacet is AssetManagerBase {
    /**
     * Add the agent to the list of publicly available agents.
     * Other agents can only self-mint.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function makeAgentAvailable(
        address _agentVault
    )
        external
    {
        AvailableAgents.makeAvailable(_agentVault);
    }

    /**
     * Announce exit from the publicly available agents list.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @return _exitAllowedAt the timestamp when the agent can exit
     */
    function announceExitAvailableAgentList(
        address _agentVault
    )
        external
        returns (uint256 _exitAllowedAt)
    {
        return AvailableAgents.announceExit(_agentVault);
    }

    /**
     * Exit the publicly available agents list.
     * NOTE: may only be called by the agent vault owner and after announcement.
     * @param _agentVault agent vault address
     */
    function exitAvailableAgentList(
        address _agentVault
    )
        external
    {
        AvailableAgents.exit(_agentVault);
    }

    /**
     * Get (a part of) the list of available agents.
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAvailableAgentsList(
        uint256 _start,
        uint256 _end
    )
        external view
        returns (address[] memory _agents, uint256 _totalLength)
    {
        return AvailableAgents.getList(_start, _end);
    }

    /**
     * Get (a part of) the list of available agents with extra information about agents' fee, min collateral ratio
     * and available collateral (in lots).
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * NOTE: agent's available collateral can change anytime due to price changes, minting, or changes
     * in agent's min collateral ratio, so it is only to be used as estimate.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAvailableAgentsDetailedList(
        uint256 _start,
        uint256 _end
    )
        external view
        returns (AvailableAgentInfo.Data[] memory _agents, uint256 _totalLength)
    {
        return AvailableAgents.getListWithInfo(_start, _end);
    }
}
