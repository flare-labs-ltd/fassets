// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "flare-smart-contracts/contracts/token/implementation/WNat.sol";
import "../../utils/lib/SafeMath64.sol";
import "./Agents.sol";
import "./AssetManagerState.sol";


library AvailableAgents {
    using SafeMath for uint256;
    using Agents for Agents.Agent;

    struct AvailableAgent {
        address agentVault;
        uint64 exitAnnouncedAt;
    }

    struct AvailableAgentInfo {
        address agentVault;
        uint32 feeBIPS;
        uint32 mintingCollateralRatioBIPS;
        // Note: freeCollateralLots is only informative since it can can change any time
        // due to price changes, reservation, minting, redemption, or even lot size change
        uint64 freeCollateralLots;
    }   
     
    event AgentAvailable(
        address agentVault, 
        uint256 feeBIPS, 
        uint256 mintingCollateralRatioBIPS,
        uint256 freeCollateralLots);
        
    event AgentExitAnnounced(
        address indexed agentVault,
        uint256 exitTimeStart,
        uint256 exitTimeEnd);

    event AgentExited(address agentVault);
    
    function makeAvailable(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint16 _feeBIPS,
        uint32 _mintingCollateralRatioBIPS,
        uint256 _fullCollateralWei,
        uint256 _lotSizeWei
    ) 
        internal 
    {
        Agents.Agent storage agent = _state.agents[_agentVault];
        require(agent.status == Agents.AgentStatus.NORMAL, "invalid agent status");
        require(agent.availableAgentsPos == 0, "agent already available");
        require(_mintingCollateralRatioBIPS >= agent.minCollateralRatioBIPS, "collateral ratio too small");
        require(agent.oldReservedLots == 0, "re-entering again too soon");
        // set parameters
        agent.feeBIPS = _feeBIPS; 
        agent.mintingCollateralRatioBIPS = _mintingCollateralRatioBIPS;
        // check that there is enough free collateral for at least one lot
        uint256 freeCollateralLots = agent.freeCollateralLots(_fullCollateralWei, _lotSizeWei);
        require(freeCollateralLots >= 1, "not enough free collateral");
        // add to queue
        _state.availableAgents.push(AvailableAgent({
            agentVault: _agentVault, 
            exitAnnouncedAt: 0
        }));
        agent.availableAgentsPos = uint64(_state.availableAgents.length);     // index+1 (0=not in list)
        agent.availabilityEnterCountMod2 = (agent.availabilityEnterCountMod2 + 1) % 2;      // always 0/1
        emit AgentAvailable(_agentVault, _feeBIPS, _mintingCollateralRatioBIPS, freeCollateralLots);
    }

    function announceExit(
        AssetManagerState.State storage _state, 
        address _agentVault
    ) 
        internal 
    {
        Agents.Agent storage agent = _state.agents[_agentVault];
        require(agent.availableAgentsPos != 0, "agent not available");
        AvailableAgent storage item = _state.availableAgents[agent.availableAgentsPos - 1];
        require(item.exitAnnouncedAt == 0, "already exiting");
        item.exitAnnouncedAt = SafeMath64.toUint64(block.timestamp);
        (uint256 startTime, uint256 endTime) = _exitTimeInterval(_state, block.timestamp);
        emit AgentExitAnnounced(_agentVault, startTime, endTime);
    }
    
    function exit(
        AssetManagerState.State storage _state, 
        address _agentVault
    )
        internal
    {
        Agents.Agent storage agent = _state.agents[_agentVault];
        require(agent.availableAgentsPos != 0, "agent not available");
        uint256 ind = agent.availableAgentsPos - 1;
        if (_state.settings.minSecondsToExitAvailableAgentsList != 0) {
            AvailableAgent storage item = _state.availableAgents[ind];
            (uint256 startTime, uint256 endTime) = _exitTimeInterval(_state, item.exitAnnouncedAt);
            require(item.exitAnnouncedAt != 0 && startTime <= block.timestamp && block.timestamp <= endTime,
                "required two-step exit");
        }
        if (ind + 1 < _state.availableAgents.length) {
            _state.availableAgents[ind] = _state.availableAgents[_state.availableAgents.length - 1];
            _state.agents[_state.availableAgents[ind].agentVault].availableAgentsPos = uint64(ind + 1);
        }
        agent.availableAgentsPos = 0;
        _state.availableAgents.pop();
        emit AgentExited(_agentVault);
    }
    
    function getList(
        AssetManagerState.State storage _state, 
        uint256 _start, 
        uint256 _end
    ) 
        internal view 
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
        WNat wnat,
        uint256 _lotSizeWei,
        uint256 _start, 
        uint256 _end
    ) 
        internal view 
        returns (AvailableAgentInfo[] memory _agents, uint256 _totalLength)
    {
        _totalLength = _state.availableAgents.length;
        _end = Math.min(_end, _totalLength);
        _start = Math.min(_start, _end);
        _agents = new AvailableAgentInfo[](_end - _start);
        for (uint256 i = _start; i < _end; i++) {
            address agentVault = _state.availableAgents[i].agentVault;
            uint256 fullCollateral = wnat.balanceOf(agentVault);
            Agents.Agent storage agent = _state.agents[agentVault];
            _agents[i - _start] = AvailableAgentInfo({
                agentVault: agentVault,
                feeBIPS: agent.feeBIPS,
                mintingCollateralRatioBIPS: agent.mintingCollateralRatioBIPS,
                freeCollateralLots: agent.freeCollateralLots(fullCollateral, _lotSizeWei)
            });
        }
    }
    
    function _exitTimeInterval(AssetManagerState.State storage _state, uint256 _fromTime)
        private view
        returns (uint256 _start, uint256 _end)
    {
        _start = _fromTime.add(_state.settings.minSecondsToExitAvailableAgentsList);
        _end = _fromTime.add(_state.settings.maxSecondsToExitAvailableAgentsList);
    }
}
