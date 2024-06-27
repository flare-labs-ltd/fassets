// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

interface IAgentPing {
    /**
     * Agent bot liveness check.
     * @param agentVault the agent vault whose owner bot to ping
     * @param query off-chain defined id of the query
     */
    event AgentPing(
        address indexed agentVault,
        uint256 query);

    /**
     * Response to agent bot liveness check.
     * @param owner owner of the agent vault
     * @param agentVault the pinged agent vault
     * @param query repeated `query` from the AgentPing event
     * @param response response data to the query
     */
    event AgentPingResponse(
        address indexed owner,
        address indexed agentVault,
        uint256 query,
        string response);

    /**
     * Used for liveness checks, simply emits AgentPing event.
     * @param _agentVault the agent vault whose owner bot to ping
     * @param _query off-chain defined id of the query
     */
    function agentPing(
        address _agentVault,
        uint256 _query
    ) external;

    /**
     * Used for liveness checks, the bot's response to AgentPing event.
     * Simply emits AgentPingResponse event identifying the owner.
     * NOTE: may only be called by the agent vault owner
     * @param _agentVault the pinged agent vault
     * @param _query repeated `_query` from the agentPing
     * @param _response response data to the query
     */
    function agentPingResponse(
        address _agentVault,
        uint256 _query,
        string memory _response
    ) external;
}
