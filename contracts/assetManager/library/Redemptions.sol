// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/Transfers.sol";
import "./data/AssetManagerState.sol";
import "./Conversion.sol";
import "./Agents.sol";


library Redemptions {
    using Agent for Agent.State;
    using RedemptionQueue for RedemptionQueue.State;

    function closeTickets(
        Agent.State storage _agent,
        uint64 _amountAMG,
        bool _immediatelyReleaseMinted,
        bool _closeWholeLotsOnly
    )
        internal
        returns (uint64 _closedAMG, uint256 _closedUBA)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        // redemption tickets
        uint256 maxRedeemedTickets = Globals.getSettings().maxRedeemedTickets;
        uint64 lotSize = Globals.getSettings().lotSizeAMG;
        for (uint256 i = 0; i < maxRedeemedTickets && _closedAMG < _amountAMG; i++) {
            // each loop, firstTicketId will change since we delete the first ticket
            uint64 ticketId = state.redemptionQueue.agents[_agent.vaultAddress()].firstTicketId;
            if (ticketId == 0) {
                break;  // no more tickets for this agent
            }
            RedemptionQueue.Ticket storage ticket = state.redemptionQueue.getTicket(ticketId);
            uint64 maxTicketRedeemAMG = ticket.valueAMG + _agent.dustAMG;
            maxTicketRedeemAMG -= maxTicketRedeemAMG % lotSize; // round down to whole lots
            uint64 ticketRedeemAMG = SafeMath64.min64(_amountAMG - _closedAMG, maxTicketRedeemAMG);
            // only remove from tickets and add to total, do everything else after the loop
            removeFromTicket(ticketId, ticketRedeemAMG);
            _closedAMG += ticketRedeemAMG;
        }
        // now close the dust if anything remains (e.g. if there were no tickets to redeem)
        uint64 closeDustAMG = _amountAMG - _closedAMG;
        if (_closeWholeLotsOnly) {
            closeDustAMG = closeDustAMG % lotSize;
        }
        closeDustAMG = SafeMath64.min64(closeDustAMG, _agent.dustAMG);
        if (closeDustAMG > 0) {
            _closedAMG += closeDustAMG;
            Agents.decreaseDust(_agent, closeDustAMG);
        }
        // self-close or liquidation is one step, so we can release minted assets without redeeming step
        if (_immediatelyReleaseMinted) {
            Agents.releaseMintedAssets(_agent, _closedAMG);
        }
        // return
        _closedUBA = Conversion.convertAmgToUBA(_closedAMG);
    }

    function removeFromTicket(
        uint64 _redemptionTicketId,
        uint64 _redeemedAMG
    )
        internal
    {
        RedemptionQueue.State storage redemptionQueue = AssetManagerState.get().redemptionQueue;
        RedemptionQueue.Ticket storage ticket = redemptionQueue.getTicket(_redemptionTicketId);
        Agent.State storage agent = Agent.get(ticket.agentVault);
        uint64 lotSize = Globals.getSettings().lotSizeAMG;
        uint64 remainingAMG = ticket.valueAMG + agent.dustAMG - _redeemedAMG;
        uint64 remainingAMGDust = remainingAMG % lotSize;
        uint64 remainingAMGLots = remainingAMG - remainingAMGDust;
        if (remainingAMGLots == 0) {
            redemptionQueue.deleteRedemptionTicket(_redemptionTicketId);
            emit IAssetManagerEvents.RedemptionTicketDeleted(agent.vaultAddress(), _redemptionTicketId);
        } else if (remainingAMGLots != ticket.valueAMG) {
            ticket.valueAMG = remainingAMGLots;
            uint256 remainingUBA = Conversion.convertAmgToUBA(remainingAMGLots);
            emit IAssetManagerEvents.RedemptionTicketUpdated(agent.vaultAddress(), _redemptionTicketId, remainingUBA);
        }
        Agents.changeDust(agent, remainingAMGDust);
    }

    function burnFAssets(
        address _owner,
        uint256 _amountUBA
    )
        internal
    {
        Globals.getFAsset().burn(_owner, _amountUBA);
    }

    // WARNING: every call must be guarded for reentrancy!
    // pay executor for executor calls, otherwise burn executor fee
    function payOrBurnExecutorFee(
        Redemption.Request storage _request
    )
        internal
    {
        if (_request.executorFeeNatGWei == 0) return;
        if (msg.sender == _request.executor) {
            Transfers.transferNAT(_request.executor, _request.executorFeeNatGWei * Conversion.GWEI);
        } else if (_request.executorFeeNatGWei > 0) {
            Agents.burnDirectNAT(_request.executorFeeNatGWei * Conversion.GWEI);
        }
        _request.executorFeeNatGWei = 0;
    }

    function reCreateRedemptionTicket(
        Agent.State storage _agent,
        Redemption.Request storage _request
    )
        internal
    {
        Agents.endRedeemingAssets(_agent, _request.valueAMG, _request.poolSelfClose);
        Agents.createNewMinting(_agent, _request.valueAMG);
    }

    function deleteRedemptionRequest(uint64 _redemptionRequestId)
        internal
    {
        releaseTransferToCoreVault(_redemptionRequestId);
        AssetManagerState.State storage state = AssetManagerState.get();
        delete state.redemptionRequests[_redemptionRequestId];
    }

    function releaseTransferToCoreVault(uint64 _redemptionRequestId)
        internal
    {
        Redemption.Request storage request = getRedemptionRequest(_redemptionRequestId);
        if (request.transferToCoreVault) {
            Agent.State storage agent = Agent.get(request.agentVault);
            if (agent.activeTransferToCoreVault == _redemptionRequestId) {
                agent.activeTransferToCoreVault = 0;
            }
        }
    }

    function maxClosedFromAgentPerTransaction(
        Agent.State storage _agent
    )
        internal view
        returns (uint256)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint64 resultAMG = _agent.dustAMG;
        uint256 maxRedeemedTickets = Globals.getSettings().maxRedeemedTickets;
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
