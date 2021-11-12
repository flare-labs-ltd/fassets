// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./AssetManagerSettings.sol";
import "./RedemptionQueue.sol";
import "./PaymentVerification.sol";
import "./Agents.sol";
import "./AvailableAgents.sol";
import "./CollateralReservations.sol";
import "./Redemption.sol";
import "./AllowedPaymentAnnouncement.sol";


library AssetManagerState {
    struct State {
        AssetManagerSettings.Settings settings;
        
        // mapping agentVaultAddress => agent
        mapping(address => Agents.Agent) agents;
        
        // mapping crt_id => crt
        mapping(uint64 => CollateralReservations.CollateralReservation) crts;
        
        // mapping redemptionRequest_id => request
        mapping(uint64 => Redemption.RedemptionRequest) redemptionRequests;
        
        // mapping underlyingAddress => owner
        mapping(bytes32 => address) underlyingAddressOwner;
        
        // array of AvailableAgent; when one is deleted, its position is filled with last
        AvailableAgents.AvailableAgent[] availableAgents;
        
        // mapping (agentVault, announcementId) => PaymentAnnouncement
        mapping(bytes32 => AllowedPaymentAnnouncement.PaymentAnnouncement) paymentAnnouncements;
        
        // redemption queue
        RedemptionQueue.State redemptionQueue;
        
        // verified payment hashes; expire in 5 days
        PaymentVerification.State paymentVerifications;
        
        // new ids (listed here to save storage); all must be incremented before assigning, so 0 means empty
        uint64 newCrtId;
        uint64 newRedemptionRequestId;
        uint64 newPaymentAnnouncementId;
    }
    
}
