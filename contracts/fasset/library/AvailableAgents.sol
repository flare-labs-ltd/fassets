// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./data/AssetManagerState.sol";
import "./Conversion.sol";
import "./AgentCollateral.sol";

library AvailableAgents {
    using SafeCast for uint256;
    using AgentCollateral for AgentCollateral.MintingData;

    // only used in memory - no packing
    struct AgentInfo {
        address agentVault;
        uint256 feeBIPS;
        uint256 agentMinCollateralRatioBIPS;
        uint256 agentPoolMinCollateralRatioBIPS;
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
        Agent.State storage agent = Agents.getAgent(_state, _agentVault);
        Agents.requireAgentVaultOwner(_agentVault);
        assert(agent.agentType == Agent.Type.AGENT_100); // AGENT_0 not supported yet
        require(agent.status == Agent.Status.NORMAL, "invalid agent status");
        require(agent.availableAgentsPos == 0, "agent already available");
        // set parameters
        agent.feeBIPS = _feeBIPS.toUint16(); 
        // when agent becomes available, it is a good idea to set agent's min collateral ratio higher than
        // global min collateral ratio (otherwise he can quickly go to liquidation), so we always do it here
        Agents.setAgentMinCollateralRatioBIPS(_state, _agentVault, _agentMinCollateralRatioBIPS);
        // check that there is enough free collateral for at least one lot
        AgentCollateral.MintingData memory collateralData = AgentCollateral.currentData(_state, agent, _agentVault);
        uint256 freeCollateralLots = collateralData.freeCollateralLots(_state, agent);
        require(freeCollateralLots >= 1, "not enough free collateral");
        // add to queue
        _state.availableAgents.push(_agentVault);
        agent.availableAgentsPos = uint64(_state.availableAgents.length);     // index+1 (0=not in list)
        emit AMEvents.AgentAvailable(_agentVault, _feeBIPS, _agentMinCollateralRatioBIPS, freeCollateralLots);
    }

    function exit(
        AssetManagerState.State storage _state, 
        address _agentVault
    )
        external
    {
        Agent.State storage agent = Agents.getAgent(_state, _agentVault);
        Agents.requireAgentVaultOwner(_agentVault);
        require(agent.availableAgentsPos != 0, "agent not available");
        uint256 ind = agent.availableAgentsPos - 1;
        if (ind + 1 < _state.availableAgents.length) {
            _state.availableAgents[ind] = _state.availableAgents[_state.availableAgents.length - 1];
            Agent.State storage movedAgent = Agents.getAgent(_state, _state.availableAgents[ind]);
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
            _agents[i - _start] = _state.availableAgents[i];
        }
    }

    function getListWithInfo(
        AssetManagerState.State storage _state, 
        uint256 _start, 
        uint256 _end
    ) 
        external view 
        returns (AgentInfo[] memory _agents, uint256 _totalLength)
    {
        _totalLength = _state.availableAgents.length;
        _end = Math.min(_end, _totalLength);
        _start = Math.min(_start, _end);
        _agents = new AgentInfo[](_end - _start);
        for (uint256 i = _start; i < _end; i++) {
            address agentVault = _state.availableAgents[i];
            Agent.State storage agent = Agents.getAgentNoCheck(_state, agentVault);
            AgentCollateral.MintingData memory collateralData = AgentCollateral.currentData(_state, agent, agentVault);
            (uint256 agentCR,) = AgentCollateral.mintingMinCollateralRatio(_state, agent,
                AgentCollateral.Kind.AGENT_CLASS1);
            (uint256 poolCR,) = AgentCollateral.mintingMinCollateralRatio(_state, agent,
                AgentCollateral.Kind.POOL);
            _agents[i - _start] = AgentInfo({
                agentVault: agentVault,
                feeBIPS: agent.feeBIPS,
                agentMinCollateralRatioBIPS: agentCR,
                agentPoolMinCollateralRatioBIPS: poolCR,
                freeCollateralLots: collateralData.freeCollateralLots(_state, agent)
            });
        }
    }
}
