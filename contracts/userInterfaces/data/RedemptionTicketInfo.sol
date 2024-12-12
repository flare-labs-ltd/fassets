// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


library RedemptionTicketInfo {
    struct Data {
        // The id of the ticket, same as returned in RedemptionTicketCreated/Updated/Deleted events.
        uint256 redemptionTicketId;

        // Backing agent vault address.
        address agentVault;

        // The amount of FAsset on the ticket.
        uint256 ticketValueUBA;
    }
}
