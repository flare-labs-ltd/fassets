// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../../utils/lib/SafeMath64.sol";
import "./data/AssetManagerState.sol";
import "./Conversion.sol";
import "./Agents.sol";


library Redemptions {
    using Agent for Agent.State;
    using RedemptionQueue for RedemptionQueue.State;

    function closeTickets(
        Agent.State storage _agent,
        uint64 _amountAMG,
        bool _immediatelyReleaseMinted
    )
        internal
        returns (uint64 _closedAMG, uint256 _closedUBA)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        // dust first
        _closedAMG = SafeMath64.min64(_amountAMG, _agent.dustAMG);
        if (_closedAMG > 0) {
            Agents.decreaseDust(_agent, _closedAMG);
        }
        // redemption tickets
        uint256 maxRedeemedTickets = state.settings.maxRedeemedTickets;
        for (uint256 i = 0; i < maxRedeemedTickets && _closedAMG < _amountAMG; i++) {
            // each loop, firstTicketId will change since we delete the first ticket
            uint64 ticketId = state.redemptionQueue.agents[_agent.vaultAddress()].firstTicketId;
            if (ticketId == 0) {
                break;  // no more tickets for this agent
            }
            RedemptionQueue.Ticket storage ticket = state.redemptionQueue.getTicket(ticketId);
            uint64 ticketValueAMG = SafeMath64.min64(_amountAMG - _closedAMG, ticket.valueAMG);
            // only remove from tickets and add to total, do everything else after the loop
            removeFromTicket(ticketId, ticketValueAMG);
            _closedAMG += ticketValueAMG;
        }
        _closedUBA = Conversion.convertAmgToUBA(_closedAMG);
        // self-close or liquidation is one step, so we can release minted assets without redeeming step
        if (_immediatelyReleaseMinted) {
            Agents.releaseMintedAssets(_agent, _closedAMG);
        }
    }

    function removeFromTicket(
        uint64 _redemptionTicketId,
        uint64 _redeemedAMG
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        RedemptionQueue.Ticket storage ticket = state.redemptionQueue.getTicket(_redemptionTicketId);
        uint64 remainingAMG = ticket.valueAMG - _redeemedAMG;
        if (remainingAMG == 0) {
            state.redemptionQueue.deleteRedemptionTicket(_redemptionTicketId);
        } else if (remainingAMG < state.settings.lotSizeAMG) {   // dust created
            Agent.State storage agent = Agent.get(ticket.agentVault);
            Agents.increaseDust(agent, remainingAMG);
            state.redemptionQueue.deleteRedemptionTicket(_redemptionTicketId);
        } else {
            ticket.valueAMG = remainingAMG;
        }
    }

    function burnFAssets(
        address _owner,
        uint256 _amountUBA
    )
        internal
    {
        Globals.getFAsset().burn(_owner, _amountUBA);
    }

    function deleteRedemptionRequest(uint64 _redemptionRequestId)
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        delete state.redemptionRequests[_redemptionRequestId];
    }

    function maxClosedFromAgentPerTransaction(
        Agent.State storage _agent
    )
        internal view
        returns (uint256)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint64 resultAMG = _agent.dustAMG;
        uint256 maxRedeemedTickets = state.settings.maxRedeemedTickets;
        uint64 ticketId = state.redemptionQueue.agents[_agent.vaultAddress()].firstTicketId;
        for (uint256 i = 0; ticketId != 0 && i < maxRedeemedTickets; i++) {
            RedemptionQueue.Ticket storage ticket = state.redemptionQueue.getTicket(ticketId);
            resultAMG += ticket.valueAMG;
            ticketId = ticket.nextForAgent;
        }
        return Conversion.convertAmgToUBA(resultAMG);
    }

    function getRedemptionRequest(uint64 _redemptionRequestId)
        internal view
        returns (Redemption.Request storage _request)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(_redemptionRequestId != 0, "invalid request id");
        _request = state.redemptionRequests[_redemptionRequestId];
        require(_request.status != Redemption.Status.EMPTY, "invalid request id");
    }
}
