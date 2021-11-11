// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./types.sol";
import { RedemptionQueue } from "./RedemptionQueue.sol";
import { PaymentVerification } from "./PaymentVerification.sol";

struct AssetManagerState {
    // default values
    uint16 initialMinCollateralRatioBIPS;
    uint16 liquidationMinCollateralRatioBIPS;
    uint64 minSecondsToExitAvailableForMint;
    uint64 underlyingBlocksForPayment;
    uint64 underlyingBlocksForAllowedPayment;
    uint64 underlyingBlocksForTopup;
    uint256 lotSizeUBA;                              // in underlying asset wei/satoshi
    uint256 redemptionFeeUBA;                        // in underlying asset wei/satoshi
    uint32 redemptionFailureFactorBIPS;              // e.g 1.2 (12000)
    //
    mapping(address => Agent) agents;                       // mapping agentVaultAddress=>agent
    mapping(uint64 => CollateralReservation) crts;          // mapping crt_id=>crt
    mapping(uint64 => RedemptionRequest) redemptionRequests;    // mapping request_id=>request
    mapping(bytes32 => address) underlyingAddressOwner;
    AvailableAgent[] availableAgents;
    RedemptionQueue.State redemptionQueue;
    PaymentVerification.State paymentVerifications;
    
    // mapping (agentVault, announcementId) => PaymentAnnouncement
    mapping(bytes32 => PaymentAnnouncement) paymentAnnouncements;
    
    uint64 newCrtId;                    // increment before assigning to ticket (to avoid 0)
    uint64 newRedemptionRequestId;
    uint64 newPaymentAnnouncementId;
}

uint256 constant MAX_BIPS = 10000;
