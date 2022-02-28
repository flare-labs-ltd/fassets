// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interface/IAgentVault.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./AssetManagerState.sol";
import "./Conversion.sol";
import "./AgentCollateral.sol";


library AvailableAgents {
    using AgentCollateral for AgentCollateral.Data;

    struct AvailableAgent {
        address agentVault;
    }

    // only used in memory - no packing
    struct AvailableAgentInfo {
        address agentVault;
        uint256 feeBIPS;
        uint256 agentMinCollateralRatioBIPS;
        // Note: freeCollateralLots is only informative since it can can change at any time
        // due to price changes, reservation, minting, redemption, or even lot size change
        uint256 freeCollateralLots;
    }   
     
    function makeAvailable(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint256 _feeBIPS,
        uint256 _agentMinCollateralRatioBIPS
    ) 
        external 
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.agentType == Agents.AgentType.AGENT_100, "only agent 100");
        require(agent.status == Agents.AgentStatus.NORMAL, "invalid agent status");
        require(agent.availableAgentsPos == 0, "agent already available");
        // set parameters
        agent.feeBIPS = SafeCast.toUint16(_feeBIPS); 
        // when agent becomes available, it is a good idea to set agent's min collateral ratio higher than
        // global min collateral ratio (otherwise he can quickly go to liquidation), so we always do it here
        Agents.setAgentMinCollateralRatioBIPS(_state, _agentVault, _agentMinCollateralRatioBIPS);
        // check that there is enough free collateral for at least one lot
        AgentCollateral.Data memory collateralData = AgentCollateral.currentData(_state, _agentVault);
        uint256 freeCollateralLots = collateralData.freeCollateralLots(agent, _state.settings);
        require(freeCollateralLots >= 1, "not enough free collateral");
        // add to queue
        _state.availableAgents.push(AvailableAgent({
            agentVault: _agentVault
        }));
        agent.availableAgentsPos = uint64(_state.availableAgents.length);     // index+1 (0=not in list)
        emit AMEvents.AgentAvailable(_agentVault, _feeBIPS, _agentMinCollateralRatioBIPS, freeCollateralLots);
    }

    function exit(
        AssetManagerState.State storage _state, 
        address _agentVault
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.availableAgentsPos != 0, "agent not available");
        uint256 ind = agent.availableAgentsPos - 1;
        if (ind + 1 < _state.availableAgents.length) {
            _state.availableAgents[ind] = _state.availableAgents[_state.availableAgents.length - 1];
            Agents.Agent storage movedAgent = Agents.getAgent(_state, _state.availableAgents[ind].agentVault);
            movedAgent.availableAgentsPos = uint64(ind + 1);
        }
        agent.availableAgentsPos = 0;
        _state.availableAgents.pop();
        emit AMEvents.AvailableAgentExited(_agentVault);
    }
    
    function getList(
        AssetManagerState.State storage _state, 
        uint256 _start, 
        uint256 _end
    ) 
        external view 
        returns (address[] memory _agents, uint256 _totalLength)
    {
        _totalLength = _state.availableAgents.length;
        _end = Math.min(_end, _totalLength);
        _start = Math.min(_start, _end);
        _agents = new address[](_end - _start);
        for (uint256 i = _start; i < _end; i++) {
            _agents[i - _start] = _state.availableAgents[i].agentVault;
        }
    }

    function getListWithInfo(
        AssetManagerState.State storage _state, 
        uint256 _start, 
        uint256 _end
    ) 
        external view 
        returns (AvailableAgentInfo[] memory _agents, uint256 _totalLength)
    {
        _totalLength = _state.availableAgents.length;
        _end = Math.min(_end, _totalLength);
        _start = Math.min(_start, _end);
        _agents = new AvailableAgentInfo[](_end - _start);
        AgentCollateral.Data memory collateralData = AgentCollateral.Data({
            fullCollateral: 0,  // filled later for each agent
            amgToNATWeiPrice: Conversion.currentAmgToNATWeiPrice(_state.settings)
        });
        for (uint256 i = _start; i < _end; i++) {
            address agentVault = _state.availableAgents[i].agentVault;
            Agents.Agent storage agent = Agents.getAgentNoCheck(_state, agentVault);
            collateralData.fullCollateral = Agents.fullCollateral(_state, agentVault);
            _agents[i - _start] = AvailableAgentInfo({
                agentVault: agentVault,
                feeBIPS: agent.feeBIPS,
                agentMinCollateralRatioBIPS: agent.agentMinCollateralRatioBIPS,
                freeCollateralLots: collateralData.freeCollateralLots(agent, _state.settings)
            });
        }
    }
}
