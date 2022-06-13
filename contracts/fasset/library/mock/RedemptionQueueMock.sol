// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../RedemptionQueue.sol";

/**
 * @title RedemptionQueue mock contract
 * @notice A contract to expose the Conversion library for unit testing.
 **/
contract RedemptionQueueMock {
    using RedemptionQueue for RedemptionQueue.State;

    RedemptionQueue.State private redemptionQueue;
    
    function createRedemptionTicket(
        address _agentVault,
        uint64 _valueAMG
    ) 
        external 
        returns (uint64)
    {
        return redemptionQueue.createRedemptionTicket(_agentVault, _valueAMG);
    }

    function deleteRedemptionTicket(
        uint64 _ticketId
    )
        external
    {
        redemptionQueue.deleteRedemptionTicket(_ticketId);
    }

    function getTicket(uint64 _id) external view returns (RedemptionQueue.Ticket memory) {
        return redemptionQueue.getTicket(_id);
    }
}