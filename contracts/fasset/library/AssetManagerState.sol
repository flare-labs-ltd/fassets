// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./RedemptionQueue.sol";
import "./PaymentVerification.sol";


library AssetManagerState {
    
    enum AgentStatus { 
        EMPTY,
        NORMAL,
        LIQUIDATION
    }

    struct Agent {
        bytes32 underlyingAddress;
        // agent is allowed to withdraw fee or liquidated underlying amount (including gas)
        mapping(bytes32 => uint256) allowedUnderlyingPayments;      // underlyingAddress -> allowedUBA
        TopupRequirement[] requiredUnderlyingTopups;
        uint64 reservedLots;
        uint64 mintedLots;
        uint32 minCollateralRatioBIPS;
        uint64 availableAgentsPos;    // (index in mint queue)+1; 0 = not in queue
        uint16 feeBIPS;
        uint32 mintingCollateralRatioBIPS;
        // When an agent exits and re-enters availability list, mintingCollateralRatio changes
        // so we have to acocunt for that when calculating total reserved collateral.
        // We simplify by only allowing one change before the old CRs are executed or cleared.
        // Therefore we store relevant old values here and match old/new by 0/1 flag 
        // named `availabilityEnterCountMod2` here and in CR.
        uint64 oldReservedLots;
        uint32 oldMintingCollateralRatioBIPS;
        uint8 availabilityEnterCountMod2;
        AgentStatus status;
    }

    struct AvailableAgent {
        address agentVault;
        uint64 allowExitTimestamp;
    }
        
    struct CollateralReservation {
        bytes32 agentUnderlyingAddress;
        bytes32 minterUnderlyingAddress;
        uint192 underlyingValueUBA;
        uint64 firstUnderlyingBlock;
        uint192 underlyingFeeUBA;
        uint64 lastUnderlyingBlock;
        address agentVault;
        uint64 lots;
        address minter;
        uint8 availabilityEnterCountMod2;
    }

    struct RedemptionRequest {
        bytes32 agentUnderlyingAddress;
        bytes32 redeemerUnderlyingAddress;
        uint192 underlyingValueUBA;
        uint64 firstUnderlyingBlock;
        uint192 underlyingFeeUBA;
        uint64 lastUnderlyingBlock;
        address agentVault;
        uint64 lots;
        address redeemer;
    }

    struct TopupRequirement {
        bytes32 underlyingAddress;
        uint256 valueUBA;
        uint64 firstUnderlyingBlock;
        uint64 lastUnderlyingBlock;
    }

    struct PaymentAnnouncement {
        bytes32 underlyingAddress;
        uint256 valueUBA;
        uint64 firstUnderlyingBlock;
        uint64 lastUnderlyingBlock;
        uint64 createdAtBlock;
    }
    
    struct State {
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
}
