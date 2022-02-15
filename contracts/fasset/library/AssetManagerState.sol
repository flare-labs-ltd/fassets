// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./AssetManagerSettings.sol";
import "./RedemptionQueue.sol";
import "./PaymentVerification.sol";
import "./UnderlyingFreeBalance.sol";
import "./UnderlyingAddressOwnership.sol";
import "./Agents.sol";
import "./AvailableAgents.sol";
import "./CollateralReservations.sol";
import "./Redemption.sol";
import "./AllowedPaymentAnnouncement.sol";
import "./IllegalPaymentChallenge.sol";
import "./PaymentReports.sol";


library AssetManagerState {
    struct State {
        AssetManagerSettings.Settings settings;
        
        // Agent in this system is always identified by theagent vault address.
        // Therefore we keep a mapping from agent vault addressed to data about the agents.
        // Type: mapping agentVaultAddress => agent
        mapping(address => Agents.Agent) agents;
        
        // A list of all agents that are available for minting.
        // Type: array of AvailableAgent; when one is deleted, its position is filled with last
        AvailableAgents.AvailableAgent[] availableAgents;
        
        // Ownership of underlying source addresses is needed to prevent someone
        // overtaking the payer and presenting an underlying payment as his own.
        UnderlyingAddressOwnership.State underlyingAddressOwnership;
        
        // Type: mapping collateralReservationId => collateralReservation
        mapping(uint64 => CollateralReservations.CollateralReservation) crts;
        
        // redemption queue
        RedemptionQueue.State redemptionQueue;
        
        // mapping redemptionRequest_id => request
        mapping(uint64 => Redemption.RedemptionRequest) redemptionRequests;
        
        // verified payment hashes; expire in 5 days
        PaymentVerification.State paymentVerifications;
        
        // mapping (agentVault, announcementId) => PaymentAnnouncement
        mapping(bytes32 => AllowedPaymentAnnouncement.PaymentAnnouncement) paymentAnnouncements;
        
        // Payment challenges state
        IllegalPaymentChallenge.Challenges paymentChallenges;
        
        // Redemption payment reports and announced payment reports
        PaymentReports.Reports paymentReports;
        
        // New ids (listed together to save storage); all must be incremented before assigning, so 0 means empty
        uint64 newCrtId;
        uint64 newRedemptionRequestId;
        uint64 newPaymentAnnouncementId;
        
        // Current block number and timestamp on the underlying chain
        uint64 currentUnderlyingBlock;
        uint64 currentUnderlyingBlockTimestamp;
        
        // The timestamp (on this network) when the underlying block was last updated
        uint64 currentUnderlyingBlockUpdatedAt;
    }
    
}
