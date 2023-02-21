// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./Redemptions.sol";

library SelfClosing {
    using SafePct for *;
    using SafeCast for uint256;
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentConfirmations for PaymentConfirmations.State;
    using AgentCollateral for Collateral.Data;
    using Agent for Agent.State;

    function selfClose(
        address _agentVault,
        uint256 _amountUBA
    )
        external
    {
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireAgentVaultOwner(_agentVault);
        require(_amountUBA != 0, "self close of 0");
        uint64 amountAMG = Conversion.convertUBAToAmg(_amountUBA);
        (, uint256 closedUBA) = selfCloseOrLiquidate(agent, amountAMG);
        // burn the self-closed assets
        AssetManagerState.getSettings().fAsset.burn(msg.sender, closedUBA);
        // try to pull agent out of liquidation
        Liquidation.endLiquidationIfHealthy(agent);
        // send event
        emit AMEvents.SelfClose(_agentVault, closedUBA);
    }

    function selfCloseOrLiquidate(
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
            Redemptions.removeFromTicket(ticketId, ticketValueAMG);
            _valueAMG += ticketValueAMG;
        }
        // self-close or liquidation is one step, so we can release minted assets without redeeming step
        Agents.releaseMintedAssets(_agent, _valueAMG);
        // all the redeemed amount is added to free balance
        _valueUBA = Conversion.convertAmgToUBA(_valueAMG);
        UnderlyingFreeBalance.increaseFreeBalance(_agent, _valueUBA);
    }
}
