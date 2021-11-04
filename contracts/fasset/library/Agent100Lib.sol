// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";
import "flare-smart-contracts/contracts/token/implementation/WNat.sol";
import "../../utils/lib/SafeMath64.sol";
import "../interface/IAgentVault.sol";

library Agent100Lib {
    using SafeMath for uint256;
    using SafePct for uint256;
    using SafeMath64 for uint256;
    
    enum AgentStatus { 
        EMPTY,
        NORMAL,
        LIQUIDATION
    }
    
    struct Agent {
        bytes32 underlyingAddress;
        // agent is allowed to withdraw fee or liquidated underlying amount (including gas)
        uint256 allowedUnderlyingPayments;
        uint64 reservedLots;
        uint64 mintedLots;
        uint32 minCollateralRatioBIPS;
        uint64 mintQueuePos;    // (index in mint queue)+1; 0 = not in queue
        uint16 feeBIPS;
        uint32 mintingCollateralRatioBIPS;
        uint64 firstRedemptionTicketId;
        uint64 lastRedemptionTicketId;
        AgentStatus status;
    }
    
    struct CollateralReservation {
        bytes32 underlyingAddress;
        uint256 underlyingValue;  // in underlying wei/satoshi
        uint256 underlyingFee;
        address agentVault;
        uint64 lots;
        address minter;
        uint64 lastUnderlyingBlock;
    }
    
    struct MintQueueItem {
        address agentVault;
        uint64 allowExitTimestamp;
    }
    
    struct RedemptionTicket {
        address agentVault;
        uint64 lots;
        uint64 prev;
        uint64 next;
        uint64 prevForAgent;
        uint64 nextForAgent;
    }
    
    struct State {
        // default values
        uint16 initialMinCollateralRatioBIPS;
        uint16 liquidationMinCollateralRatioBIPS;
        uint64 minSecondsToExitQueue;
        uint64 underlyingBlocksForPayment;
        uint256 lotSizeUnderlying;                              // in underlying asset wei/satoshi
        //
        mapping(address => Agent) agents;                       // mapping agentVaultAddress=>agent
        mapping(uint64 => CollateralReservation) crts;          // mapping crt_id=>crt
        mapping(uint64 => RedemptionTicket) redemptionQueue;    // mapping redemption_id=>ticket
        MintQueueItem[] mintQueue;
        uint64 firstRedemptionTicketId;
        uint64 lastRedemptionTicketId;
        uint64 newRedemptionTicketId;       // increment before assigning to ticket (to avoid 0)
        uint64 newCrtId;                    // increment before assigning to ticket (to avoid 0)
    }
    
    struct CallContext {
        uint256 fullAgentCollateralWei;     // the total amount of native currency in the agent vault
        uint256 lotSizeWei;                 // current lot value in native currency WEI
    }
    
    uint256 internal constant MAX_BIPS = 10000;
    
    event AgentEnteredMintQueue(
        address vaultAddress, 
        uint256 feeBIPS, 
        uint256 mintingCollateralRatioBIPS,
        uint256 freeCollateral);

    event AgentFreeCollateralChanged(
        address vaultAddress, 
        uint256 freeCollateral);

    event AgentExitAnounced(address vaultAddress);

    event AgentExitedMintQueue(address vaultAddress);
    
    event CollateralReserved(
        address indexed minter,
        uint256 reservationId,
        bytes32 underlyingAddress,
        uint256 underlyingValue, 
        uint256 underlyingFee,
        uint256 lastUnderlyingBlock);
        
    event MintingPerformed(
        address indexed vaultAddress,
        uint256 redemptionTicketId,
        uint256 lots);

    function _initAgent(State storage _state, address _agentVault) internal {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.status == AgentStatus.EMPTY, "agent already exists");
        agent.status = AgentStatus.NORMAL;
        agent.minCollateralRatioBIPS = _state.initialMinCollateralRatioBIPS;
    }
    
    function _enterMintQueue(
        State storage _state,
        CallContext memory _context,
        address _agentVault,
        uint16 _feeBIPS,
        uint32 _mintingCollateralRatioBIPS
    ) internal {
        Agent storage agent = _state.agents[_agentVault];
        // checks
        require(agent.status == AgentStatus.NORMAL, "invalid agent status");
        require(agent.mintQueuePos == 0, "agent already in queue");
        require(_mintingCollateralRatioBIPS >= agent.minCollateralRatioBIPS, "collateral ratio too small");
        require(agent.reservedLots == 0, "re-entering minting queue not allowed with active CRTs");
        // check that there is enough free collateral for at least one lot
        uint256 freeCollateral = _freeCollateral(agent, _context);
        require(freeCollateral >= _context.lotSizeWei.mulDiv(_mintingCollateralRatioBIPS, MAX_BIPS), 
            "not enough free collateral");
        // set parameters
        agent.feeBIPS = _feeBIPS; 
        agent.mintingCollateralRatioBIPS = _mintingCollateralRatioBIPS;
        // add to queue
        _state.mintQueue.push(MintQueueItem({ agentVault: _agentVault, allowExitTimestamp: 0 }));
        agent.mintQueuePos = uint64(_state.mintQueue.length);    // index+1 (so that 0 means empty)
        emit AgentEnteredMintQueue(_agentVault, _feeBIPS, _mintingCollateralRatioBIPS, freeCollateral);
    }

    function _anounceExitMintQueue(State storage _state, address _agentVault) internal {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.mintQueuePos != 0, "not in mint queue");
        MintQueueItem storage item = _state.mintQueue[agent.mintQueuePos - 1];
        require(item.allowExitTimestamp == 0, "already exiting");
        item.allowExitTimestamp = uint64(block.timestamp.add(_state.minSecondsToExitQueue));
        emit AgentExitAnounced(_agentVault);
    }
    
    function _exitMintQueue(State storage _state, address _agentVault, bool _requireTwoStep) internal {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.mintQueuePos != 0, "not in mint queue");
        uint256 ind = agent.mintQueuePos - 1;
        if (_requireTwoStep) {
            MintQueueItem storage item = _state.mintQueue[ind];
            require(item.allowExitTimestamp != 0 && item.allowExitTimestamp <= block.timestamp,
                "required two-step exit");
        }
        if (ind + 1 < _state.mintQueue.length) {
            _state.mintQueue[ind] = _state.mintQueue[_state.mintQueue.length - 1];
            _state.agents[_state.mintQueue[ind].agentVault].mintQueuePos = uint64(ind + 1);
        }
        agent.mintQueuePos = 0;
        _state.mintQueue.pop();
        emit AgentExitedMintQueue(_agentVault);
    }
    
    function _reserveCollateral(
        State storage _state, 
        CallContext memory _context,
        address _minter,
        address _agentVault, 
        uint64 _lots,
        uint64 _currentUnderlyingBlock
    ) internal {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.mintQueuePos != 0, "agent not in mint queue");
        require(_freeCollateralLots(agent, _context) >= _lots, "not enough free collateral");
        uint64 lastUnderlyingBlock = SafeMath64.add64(_currentUnderlyingBlock, _state.underlyingBlocksForPayment);
        agent.reservedLots = SafeMath64.add64(agent.reservedLots, _lots);
        uint256 underlyingValue = _state.lotSizeUnderlying.mul(_lots);
        uint256 underlyingFee = underlyingValue.mulDiv(agent.feeBIPS, MAX_BIPS);
        uint64 crtId = ++_state.newCrtId;   // pre-increment - id can never be 0
        _state.crts[crtId] = CollateralReservation({
            underlyingAddress: agent.underlyingAddress,
            underlyingValue: underlyingValue,
            underlyingFee: underlyingFee,
            agentVault: _agentVault,
            lots: SafeMath64.toUint64(_lots),
            minter: _minter,
            lastUnderlyingBlock: lastUnderlyingBlock
        });
        emit CollateralReserved(_minter, crtId, 
            agent.underlyingAddress, underlyingValue, underlyingFee, lastUnderlyingBlock);
        emit AgentFreeCollateralChanged(_agentVault, _freeCollateral(agent, _context));
    }
    
    function _mintingPerformed(
        State storage _state,
        uint64 _crtId
    ) internal {
        CollateralReservation storage crt = _getCollateralReservation(_state, _crtId);
        address agentVault = crt.agentVault;
        uint64 lots = crt.lots;
        Agent storage agent = _state.agents[agentVault];
        uint64 redemptionTicketId = _createRedemptionTicket(_state, agentVault, lots);
        agent.reservedLots = SafeMath64.sub64(agent.reservedLots, lots, "invalid reserved lots");
        agent.mintedLots = SafeMath64.add64(agent.mintedLots, lots);
        delete _state.crts[_crtId];
        emit MintingPerformed(agentVault, redemptionTicketId, lots);
    }

    function _createRedemptionTicket(
        State storage _state, 
        address _agentVault,
        uint64 _lots
    ) 
        internal 
        returns (uint64)
    {
        Agent storage agent = _state.agents[_agentVault];
        uint64 ticketId = ++_state.newRedemptionTicketId;   // pre-increment - id can never be 0
        // insert new ticket to the last place in global and agent redemption queues
        _state.redemptionQueue[ticketId] = RedemptionTicket({
            agentVault: _agentVault,
            lots: _lots,
            prev: _state.lastRedemptionTicketId,
            next: 0,
            prevForAgent: agent.lastRedemptionTicketId,
            nextForAgent: 0
        });
        // update links in global redemption queue
        if (_state.firstRedemptionTicketId == 0) {
            assert(_state.lastRedemptionTicketId == 0);    // empty queue - first and last must be 0
            _state.firstRedemptionTicketId = ticketId;
        } else {
            assert(_state.lastRedemptionTicketId != 0);    // non-empty queue - first and last must be non-zero
            _state.redemptionQueue[_state.lastRedemptionTicketId].next = ticketId;
        }
        _state.lastRedemptionTicketId = ticketId;
        // update links in agent redemption queue
        if (agent.firstRedemptionTicketId == 0) {
            assert(agent.lastRedemptionTicketId == 0);    // empty queue - first and last must be 0
            agent.firstRedemptionTicketId = ticketId;
        } else {
            assert(agent.lastRedemptionTicketId != 0);    // non-empty queue - first and last must be non-zero
            _state.redemptionQueue[agent.lastRedemptionTicketId].next = ticketId;
        }
        agent.lastRedemptionTicketId = ticketId;
        // return the new redemption ticket's id
        return ticketId;
    }
    
    function _deleteRedemptionTicket(
        State storage _state, 
        address _agentVault,
        uint64 ticketId
    ) internal {
        Agent storage agent = _state.agents[_agentVault];
        RedemptionTicket storage ticket = _state.redemptionQueue[ticketId];
        // unlink from global queue
        if (ticket.prev == 0) {
            assert(ticketId == _state.firstRedemptionTicketId);     // ticket is first in queue
            _state.firstRedemptionTicketId = ticket.next;
        } else {
            assert(ticketId != _state.firstRedemptionTicketId);     // ticket is not first in queue
            _state.redemptionQueue[ticket.prev].next = ticket.next;
        }
        if (ticket.next == 0) {
            assert(ticketId == _state.lastRedemptionTicketId);     // ticket is last in queue
            _state.lastRedemptionTicketId = ticket.prev;
        } else {
            assert(ticketId != _state.lastRedemptionTicketId);     // ticket is not last in queue
            _state.redemptionQueue[ticket.next].prev = ticket.prev;
        }
        // unlink from agent queue
        if (ticket.prevForAgent == 0) {
            assert(ticketId == agent.firstRedemptionTicketId);     // ticket is first in agent queue
            agent.firstRedemptionTicketId = ticket.nextForAgent;
        } else {
            assert(ticketId != agent.firstRedemptionTicketId);     // ticket is not first in agent queue
            _state.redemptionQueue[ticket.prevForAgent].nextForAgent = ticket.nextForAgent;
        }
        if (ticket.nextForAgent == 0) {
            assert(ticketId == agent.lastRedemptionTicketId);     // ticket is last in agent queue
            agent.lastRedemptionTicketId = ticket.prevForAgent;
        } else {
            assert(ticketId != agent.lastRedemptionTicketId);     // ticket is not last in agent queue
            _state.redemptionQueue[ticket.nextForAgent].prevForAgent = ticket.prevForAgent;
        }
        // delete storage
        delete _state.redemptionQueue[ticketId];
    }
    
    function _getMintQueue(State storage _state, uint256 _start, uint256 _end) 
        internal view 
        returns (address[] memory _agents, uint256 _totalLength)
    {
        _totalLength = _state.mintQueue.length;
        if (_start >= _totalLength) {
            return (new address[](0), _totalLength);
        }
        if (_end > _totalLength) {
            _end = _totalLength;
        }
        _agents = new address[](_end - _start);
        for (uint256 i = _start; i < _end; i++) {
            _agents[i - _start] = _state.mintQueue[i].agentVault;
        }
    }
    
    function _getCollateralReservation(State storage _state, uint64 _crtId) 
        internal view
        returns (CollateralReservation storage) 
    {
        require(_crtId > 0 && _state.crts[_crtId].lots != 0, "invalid crt id");
        return _state.crts[_crtId];
    }
    
    function _getAgent(State storage _state, address _agentVault) internal view returns (Agent storage) {
        return _state.agents[_agentVault];
    }
    
    function _agentCollateral(WNat _wnat, address _agentVault) internal view returns (uint256) {
        return _wnat.balanceOf(_agentVault);
    }

    function _freeCollateralLots(Agent storage _agent, CallContext memory _context) private view returns (uint256) {
        uint256 freeCollateral = _freeCollateral(_agent, _context);
        uint256 lotCollateral = _context.lotSizeWei.mulDiv(_agent.mintingCollateralRatioBIPS, MAX_BIPS);
        return freeCollateral.div(lotCollateral);
    }

    function _freeCollateral(Agent storage _agent, CallContext memory _context) private view returns (uint256) {
        uint256 lockedCollateral = _lockedCollateral(_agent, _context);
        (, uint256 freeCollateral) = _context.fullAgentCollateralWei.trySub(lockedCollateral);
        return freeCollateral;
    }
    
    function _lockedCollateral(Agent storage _agent, CallContext memory _context) private view returns (uint256) {
        // reserved collateral is calculated at minting ratio
        uint256 reservedCollateral = uint256(_agent.reservedLots).mul(_context.lotSizeWei)
            .mulDiv(_agent.mintingCollateralRatioBIPS, MAX_BIPS);
        // minted collateral is calculated at minimal ratio
        uint256 mintedCollateral = uint256(_agent.mintedLots).mul(_context.lotSizeWei)
            .mulDiv(_agent.minCollateralRatioBIPS, MAX_BIPS);
        return reservedCollateral.add(mintedCollateral);
    }
}
