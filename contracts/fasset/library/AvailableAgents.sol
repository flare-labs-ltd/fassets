// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "flare-smart-contracts/contracts/token/implementation/WNat.sol";
import "../../utils/lib/SafeMath64.sol";
import "./AssetManagerState.sol";
import "./AgentCollateral.sol";


library AvailableAgents {
    using SafeMath for uint256;

    struct AvailableAgentInfo {
        address agentVault;
        uint256 feeBIPS;
        uint256 mintingCollateralRatioBIPS;
        uint256 freeCollateralWei;
    }   
     
    event AgentAvailable(
        address vaultAddress, 
        uint256 feeBIPS, 
        uint256 mintingCollateralRatioBIPS,
        uint256 freeCollateralWei);
        
    event AgentExitAnnounced(
        address vaultAddress,
        uint64 exitTime);

    event AgentExited(address vaultAddress);
    
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
        AssetManagerState.Agent storage agent = _state.agents[_agentVault];
        require(agent.status == AssetManagerState.AgentStatus.NORMAL, "invalid agent status");
        require(agent.availableAgentsPos == 0, "agent already available");
        require(_mintingCollateralRatioBIPS >= agent.minCollateralRatioBIPS, "collateral ratio too small");
        require(agent.oldReservedLots == 0, "re-entering again too soon");
        // set parameters
        agent.feeBIPS = _feeBIPS; 
        agent.mintingCollateralRatioBIPS = _mintingCollateralRatioBIPS;
        // check that there is enough free collateral for at least one lot
        uint256 freeCollateralWei = AgentCollateral.freeCollateralWei(agent, _fullCollateralWei, _lotSizeWei);
        require(freeCollateralWei >= AgentCollateral.mintingLotCollateral(agent, _lotSizeWei), 
            "not enough free collateral");
        // add to queue
        _state.availableAgents.push(AssetManagerState.AvailableAgent({
            agentVault: _agentVault, 
            allowExitTimestamp: 0
        }));
        agent.availableAgentsPos = uint64(_state.availableAgents.length);     // index+1 (0=not in list)
        agent.availabilityEnterCountMod2 = (agent.availabilityEnterCountMod2 + 1) % 2;      // always 0/1
        emit AgentAvailable(_agentVault, _feeBIPS, _mintingCollateralRatioBIPS, freeCollateralWei);
    }

    function announceExit(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _secondsToExit
    ) 
        internal 
    {
        AssetManagerState.Agent storage agent = _state.agents[_agentVault];
        require(agent.availableAgentsPos != 0, "agent not available");
        AssetManagerState.AvailableAgent storage item = _state.availableAgents[agent.availableAgentsPos - 1];
        require(item.allowExitTimestamp == 0, "already exiting");
        uint64 exitTime = SafeMath64.add64(block.timestamp, _secondsToExit);
        item.allowExitTimestamp = exitTime;
        emit AgentExitAnnounced(_agentVault, exitTime);
    }
    
    function exit(
        AssetManagerState.State storage _state, 
        address _agentVault, 
        bool _requireTwoStep
    )
        internal
    {
        AssetManagerState.Agent storage agent = _state.agents[_agentVault];
        require(agent.availableAgentsPos != 0, "agent not available");
        uint256 ind = agent.availableAgentsPos - 1;
        if (_requireTwoStep) {
            AssetManagerState.AvailableAgent storage item = _state.availableAgents[ind];
            require(item.allowExitTimestamp != 0 && item.allowExitTimestamp <= block.timestamp,
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
        uint256 _lotSize,
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
            AssetManagerState.Agent storage agent = _state.agents[agentVault];
            _agents[i - _start] = AvailableAgentInfo({
                agentVault: agentVault,
                feeBIPS: agent.feeBIPS,
                mintingCollateralRatioBIPS: agent.mintingCollateralRatioBIPS,
                freeCollateralWei: AgentCollateral.freeCollateralWei(agent, fullCollateral, _lotSize)
            });
        }
    }
}
