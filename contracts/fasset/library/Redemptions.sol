// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../generated/interface/IAttestationClient.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./Agents.sol";
import "./UnderlyingFreeBalance.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";
import "./Liquidation.sol";


library Redemptions {
    using Agent for Agent.State;
    using RedemptionQueue for RedemptionQueue.State;

    function closeTickets(
        Agent.State storage _agent,
        uint64 _amountAMG
    )
        internal
        returns (uint64 _valueAMG, uint256 _valueUBA)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        // dust first
        _valueAMG = SafeMath64.min64(_amountAMG, _agent.dustAMG);
        if (_valueAMG > 0) {
            Agents.decreaseDust(_agent, _valueAMG);
        }
        // redemption tickets
        uint256 maxRedeemedTickets = state.settings.maxRedeemedTickets;
        for (uint256 i = 0; i < maxRedeemedTickets && _valueAMG < _amountAMG; i++) {
            // each loop, firstTicketId will change since we delete the first ticket
            uint64 ticketId = state.redemptionQueue.agents[_agent.vaultAddress()].firstTicketId;
            if (ticketId == 0) {
                break;  // no more tickets for this agent
            }
            RedemptionQueue.Ticket storage ticket = state.redemptionQueue.getTicket(ticketId);
            uint64 ticketValueAMG = SafeMath64.min64(_amountAMG - _valueAMG, ticket.valueAMG);
            // only remove from tickets and add to total, do everything else after the loop
            removeFromTicket(ticketId, ticketValueAMG);
            _valueAMG += ticketValueAMG;
        }
        // self-close or liquidation is one step, so we can release minted assets without redeeming step
        Agents.releaseMintedAssets(_agent, _valueAMG);
        // all the redeemed amount is added to free balance
        _valueUBA = Conversion.convertAmgToUBA(_valueAMG);
        UnderlyingFreeBalance.increaseFreeBalance(_agent, _valueUBA);
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
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        settings.fAsset.burn(_owner, _amountUBA);
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
