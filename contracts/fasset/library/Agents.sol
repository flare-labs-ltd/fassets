// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";
import "../../utils/lib/SafeMath64.sol";
import "./AssetManagerState.sol";


library Agents {
    function _initAgent(
        AssetManagerState.State storage _state, 
        address _agentVault
    ) 
        internal 
    {
        AssetManagerState.Agent storage agent = _state.agents[_agentVault];
        require(agent.status == AssetManagerState.AgentStatus.EMPTY, "agent already exists");
        agent.status = AssetManagerState.AgentStatus.NORMAL;
        agent.minCollateralRatioBIPS = _state.initialMinCollateralRatioBIPS;
    }
    
    function getAgent(
        AssetManagerState.State storage _state, 
        address _agentVault
    ) 
        internal view 
        returns (AssetManagerState.Agent storage) 
    {
        return _state.agents[_agentVault];
    }
}
