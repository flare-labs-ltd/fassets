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
import "./IllegalPaymentChallenge.sol";


library AssetManagerState {
    struct State {
        AssetManagerSettings.Settings settings;
        
        // mapping agentVaultAddress => agent
        mapping(address => Agents.Agent) agents;
        
        // array of AvailableAgent; when one is deleted, its position is filled with last
        AvailableAgents.AvailableAgent[] availableAgents;
        
        // mapping underlyingAddress => owner
        mapping(bytes32 => address) underlyingAddressOwner;
        
        // mapping crt_id => crt
        mapping(uint64 => CollateralReservations.CollateralReservation) crts;
        
        // redemption queue
        RedemptionQueue.State redemptionQueue;
        
        // mapping redemptionRequest_id => request
        mapping(uint64 => Redemption.RedemptionRequest) redemptionRequests;
        
        // verified payment hashes; expire in 5 days
        PaymentVerification.State paymentVerifications;
        
        // mapping (agentVault, announcementId) => PaymentAnnouncement
        mapping(bytes32 => AllowedPaymentAnnouncement.PaymentAnnouncement) paymentAnnouncements;
        
        // mapping underlyingTransactionHash => Challenge
        mapping(bytes32 => IllegalPaymentChallenge.Challenge) paymentChallenges;
        
        // new ids (listed together to save storage); all must be incremented before assigning, so 0 means empty
        uint64 newCrtId;
        uint64 newRedemptionRequestId;
        uint64 newPaymentAnnouncementId;
    }
    
}
