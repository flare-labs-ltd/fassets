// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";


library RedemptionQueue {
    using SafeMath for uint256;
    using SafePct for uint256;
    
    struct Ticket {
        address agentVault;
        uint64 lots;
        bytes32 underlyingAddress;
        uint64 prev;
        uint64 next;
        uint64 prevForAgent;
        uint64 nextForAgent;
    }
    
    struct AgentQueue {
        uint64 firstTicketId;
        uint64 lastTicketId;
    }

    struct State {
        mapping(uint64 => Ticket) tickets;      // mapping redemption_id=>ticket
        mapping(address => AgentQueue) agents;  // mapping address=>dl-list
        uint64 firstTicketId;
        uint64 lastTicketId;
        uint64 newTicketId;       // increment before assigning to ticket (to avoid 0)
    }

    function createRedemptionTicket(
        State storage _state, 
        address _agentVault,
        uint64 _lots,
        bytes32 _underlyingAddress
    ) 
        internal 
        returns (uint64)
    {
        AgentQueue storage agent = _state.agents[_agentVault];
        uint64 ticketId = ++_state.newTicketId;   // pre-increment - id can never be 0
        // insert new ticket to the last place in global and agent redemption queues
        _state.tickets[ticketId] = Ticket({
            agentVault: _agentVault,
            lots: _lots,
            underlyingAddress: _underlyingAddress,
            prev: _state.lastTicketId,
            next: 0,
            prevForAgent: agent.lastTicketId,
            nextForAgent: 0
        });
        // update links in global redemption queue
        if (_state.firstTicketId == 0) {
            assert(_state.lastTicketId == 0);    // empty queue - first and last must be 0
            _state.firstTicketId = ticketId;
        } else {
            assert(_state.lastTicketId != 0);    // non-empty queue - first and last must be non-zero
            _state.tickets[_state.lastTicketId].next = ticketId;
        }
        _state.lastTicketId = ticketId;
        // update links in agent redemption queue
        if (agent.firstTicketId == 0) {
            assert(agent.lastTicketId == 0);    // empty queue - first and last must be 0
            agent.firstTicketId = ticketId;
        } else {
            assert(agent.lastTicketId != 0);    // non-empty queue - first and last must be non-zero
            _state.tickets[agent.lastTicketId].next = ticketId;
        }
        agent.lastTicketId = ticketId;
        // return the new redemption ticket's id
        return ticketId;
    }
    
    function deleteRedemptionTicket(
        State storage _state, 
        uint64 ticketId
    )
        internal
    {
        Ticket storage ticket = _state.tickets[ticketId];
        AgentQueue storage agent = _state.agents[ticket.agentVault];
        // unlink from global queue
        if (ticket.prev == 0) {
            assert(ticketId == _state.firstTicketId);     // ticket is first in queue
            _state.firstTicketId = ticket.next;
        } else {
            assert(ticketId != _state.firstTicketId);     // ticket is not first in queue
            _state.tickets[ticket.prev].next = ticket.next;
        }
        if (ticket.next == 0) {
            assert(ticketId == _state.lastTicketId);     // ticket is last in queue
            _state.lastTicketId = ticket.prev;
        } else {
            assert(ticketId != _state.lastTicketId);     // ticket is not last in queue
            _state.tickets[ticket.next].prev = ticket.prev;
        }
        // unlink from agent queue
        if (ticket.prevForAgent == 0) {
            assert(ticketId == agent.firstTicketId);     // ticket is first in agent queue
            agent.firstTicketId = ticket.nextForAgent;
        } else {
            assert(ticketId != agent.firstTicketId);     // ticket is not first in agent queue
            _state.tickets[ticket.prevForAgent].nextForAgent = ticket.nextForAgent;
        }
        if (ticket.nextForAgent == 0) {
            assert(ticketId == agent.lastTicketId);     // ticket is last in agent queue
            agent.lastTicketId = ticket.prevForAgent;
        } else {
            assert(ticketId != agent.lastTicketId);     // ticket is not last in agent queue
            _state.tickets[ticket.nextForAgent].prevForAgent = ticket.prevForAgent;
        }
        // delete storage
        delete _state.tickets[ticketId];
    }
    
    function getTicket(State storage _state, uint64 _id) internal view returns (Ticket storage) {
        return _state.tickets[_id];
    }
}
