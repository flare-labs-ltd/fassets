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
    using RedemptionQueue for RedemptionQueue.State;

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
