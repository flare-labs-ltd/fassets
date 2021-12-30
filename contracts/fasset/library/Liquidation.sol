// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../../utils/lib/SafeMath64.sol";
import "./PaymentVerification.sol";
import "./AssetManagerState.sol";
import "./Agents.sol";
import "./RedemptionQueue.sol";
import "./Redemption.sol";
import "./UnderlyingFreeBalance.sol";

library Liquidation {
    using SafeMath for uint256;
    using RedemptionQueue for RedemptionQueue.State;
    
    // Start agent's liquidation
    function startLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        internal
    {
        Agents.Agent storage agent = _state.agents[_agentVault];
        require(agent.status != Agents.AgentStatus.LIQUIDATION, "already in liquidation");
        agent.status = Agents.AgentStatus.LIQUIDATION;
        agent.minCollateralRatioBIPS = _state.settings.liquidationMinCollateralRatioBIPS;
        agent.liquidationState.liquidationStartedAt = SafeCast.toUint64(block.timestamp);
    }

    // Cancel agent's liquidation
    function cancelLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint256 _fullCollateral,
        uint256 _amgToNATWeiPrice
    )
        internal
    {
        Agents.Agent storage agent = _state.agents[_agentVault];
        require(Agents.lockedCollateralWei(agent, _amgToNATWeiPrice) <= _fullCollateral, "collateral too small");
        agent.status = Agents.AgentStatus.NORMAL;
        agent.minCollateralRatioBIPS = _state.settings.initialMinCollateralRatioBIPS;
        delete agent.liquidationState;
    }

    // liquidate some agent's redemption tickets
    function liquidate(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint64 _lots
    ) 
        internal
        returns (uint64 _redeemedLots)
    {
        Agents.Agent storage agent = _state.agents[_agentVault];
        require(agent.liquidationState.liquidationStartedAt > 0, "not in liquidation");

        RedemptionQueue.AgentQueue storage agentQueue = _state.redemptionQueue.agents[_agentVault];
        uint64 ticketId = agentQueue.firstTicketId;

        while (ticketId != 0 && _lots > _redeemedLots) {
            RedemptionQueue.Ticket storage ticket = _state.redemptionQueue.getTicket(ticketId);
            uint64 nextTicketId = ticket.nextForAgent;
            uint64 redeemedLots = 
                Redemption.liquidateAgainstTicket(_state, msg.sender, ticketId, _lots - _redeemedLots);
            _redeemedLots = SafeMath64.add64(_redeemedLots, redeemedLots);
            ticketId = nextTicketId;
        }
    }
    
    // Start agent's address liquidation - if already in liquidation state may only update full liquidation parameter
    // if _fullLiquidation start full address liquidation, otherwise until address balance is healthy again
    function startAddressLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault,
        bool _fullLiquidation
    )
        internal
    {
        // Agents.Agent storage agent = _state.agents[_agentVault];
        // Agents.AddressLiquidationState storage liquidation = agent.addressInLiquidation[_underlyingAddress];
        // if (liquidation.liquidationStartedAt == 0) {
        //     liquidation.liquidationStartedAt = SafeCast.toUint64(block.timestamp);
        // }
        // if (_fullLiquidation) {
        //     liquidation.fullLiquidation = true;
        // }
    }

    // Cancel agent's address liquidation - only possible if not full liquidation
    function cancelAddressLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault,
        bytes32 _underlyingAddress
    )
        internal
    {
        // Agents.Agent storage agent = _state.agents[_agentVault];
        // require(!agent.addressInLiquidation[_underlyingAddress].fullLiquidation, "full liquidation");
        // require(agent.perAddressFunds[_underlyingAddress].freeUnderlyingBalanceUBA >= 0, "free balance negative");
        // delete agent.addressInLiquidation[_underlyingAddress];
    }
    
    // liquidate some agent's redemption tickets for specific underlying address
    function liquidateAddress(
        AssetManagerState.State storage _state,
        address _agentVault,
        bytes32 _underlyingAddress,
        uint64 _lots
    ) 
        internal
        returns (uint64 _redeemedLots)
    {
        // Agents.Agent storage agent = _state.agents[_agentVault];
        // require(agent.addressInLiquidation[_underlyingAddress].liquidationStartedAt > 0, "not in liquidation");

        // RedemptionQueue.AgentQueue storage agentQueue = _state.redemptionQueue.agents[_agentVault];
        // uint64 ticketId = agentQueue.underlyingAddressFirstTicketId[_underlyingAddress];

        // while (ticketId != 0 && _lots > _redeemedLots) {
        //     RedemptionQueue.Ticket storage ticket = _state.redemptionQueue.getTicket(ticketId);
        //     uint64 nextTicketId = ticket.nextForAgent;
        //     if (ticket.underlyingAddress == _underlyingAddress) {
        //         uint64 redeemedLots = 
        //             Redemption.liquidateAgainstTicket(_state, msg.sender, ticketId, _lots - _redeemedLots);
        //         _redeemedLots = SafeMath64.add64(_redeemedLots, redeemedLots);
        //     }
        //     ticketId = nextTicketId;
        // }
    }
}
