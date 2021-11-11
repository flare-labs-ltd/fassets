// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";
import "flare-smart-contracts/contracts/token/implementation/WNat.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeMathX.sol";
import "../interface/IAgentVault.sol";
import "./Agent.sol";


library AvailableAgentsForMint {
    using SafeMath for uint256;
    using SafePct for uint256;
    
    struct Item {
        address agentVault;
        uint64 allowExitTimestamp;
    }
    
    struct State {
        Item[] list;
    }
    
    event AgentAvailable(
        address vaultAddress, 
        uint256 feeBIPS, 
        uint256 mintingCollateralRatioBIPS,
        uint256 freeCollateral);
        
    event AgentExitAnnounced(
        address vaultAddress,
        uint64 exitTime);

    event AgentExited(address vaultAddress);
    
    function makeAvailable(
        State storage _state,
        Agent storage _agent,
        address _agentVault,
        uint16 _feeBIPS,
        uint32 _mintingCollateralRatioBIPS,
        uint256 _freeCollateral
    ) 
        internal 
    {
        require(_agent.status == AgentStatus.NORMAL, "invalid agent status");
        require(_agent.availableAgentsForMintPos == 0, "agent already available");
        require(_mintingCollateralRatioBIPS >= _agent.minCollateralRatioBIPS, "collateral ratio too small");
        require(_agent.oldReservedLots == 0, "re-entering again too soon");
        // TODO: check that there is enough free collateral for at least one lot
        // uint256 freeCollateral = _freeCollateral(_agent, _context);
        // require(freeCollateral >= _context.lotSizeWei.mulDiv(_mintingCollateralRatioBIPS, MAX_BIPS), 
        //     "not enough free collateral");
        // set parameters
        _agent.feeBIPS = _feeBIPS; 
        _agent.mintingCollateralRatioBIPS = _mintingCollateralRatioBIPS;
        // add to queue
        _state.list.push(Item({
            agentVault: _agentVault, 
            allowExitTimestamp: 0
        }));
        _agent.availableAgentsForMintPos = uint64(_state.list.length);     // index+1 (0=not in list)
        _agent.availabilityEnterCountMod2 = (_agent.availabilityEnterCountMod2 + 1) % 2;      // always 0/1
        emit AgentAvailable(_agentVault, _feeBIPS, _mintingCollateralRatioBIPS, _freeCollateral);
    }

    function announceExit(
        State storage _state, 
        Agent storage _agent, 
        address _agentVault,
        uint256 _secondsToExit
    ) 
        internal 
    {
        require(_agent.availableAgentsForMintPos != 0, "agent not available");
        Item storage item = 
            _state.list[_agent.availableAgentsForMintPos - 1];
        require(item.allowExitTimestamp == 0, "already exiting");
        uint64 exitTime = SafeMath64.add64(block.timestamp, _secondsToExit);
        item.allowExitTimestamp = exitTime;
        emit AgentExitAnnounced(_agentVault, exitTime);
    }
    
    function exit(
        State storage _state, 
        mapping(address => Agent) storage _agents,
        address _agentVault, 
        bool _requireTwoStep
    )
        internal
    {
        Agent storage agent = _agents[_agentVault];
        require(agent.availableAgentsForMintPos != 0, "agent not available");
        uint256 ind = agent.availableAgentsForMintPos - 1;
        if (_requireTwoStep) {
            Item storage item = _state.list[ind];
            require(item.allowExitTimestamp != 0 && item.allowExitTimestamp <= block.timestamp,
                "required two-step exit");
        }
        if (ind + 1 < _state.list.length) {
            _state.list[ind] = _state.list[_state.list.length - 1];
            _agents[_state.list[ind].agentVault].availableAgentsForMintPos = uint64(ind + 1);
        }
        agent.availableAgentsForMintPos = 0;
        _state.list.pop();
        emit AgentExited(_agentVault);
    }
    
    function getAvailableAgents(
        State storage _state, 
        uint256 _start, 
        uint256 _end
    ) 
        internal view 
        returns (address[] memory _agents, uint256 _totalLength)
    {
        _totalLength = _state.list.length;
        if (_start >= _totalLength) {
            return (new address[](0), _totalLength);
        }
        if (_end > _totalLength) {
            _end = _totalLength;
        }
        _agents = new address[](_end - _start);
        for (uint256 i = _start; i < _end; i++) {
            _agents[i - _start] = _state.list[i].agentVault;
        }
    }
    
}
