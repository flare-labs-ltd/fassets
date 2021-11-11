// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


enum AgentStatus { 
    EMPTY,
    NORMAL,
    LIQUIDATION
}

struct Agent {
    bytes32 underlyingAddress;
    // agent is allowed to withdraw fee or liquidated underlying amount (including gas)
    mapping(bytes32 => uint256) allowedUnderlyingPayments;      // underlyingAddress -> allowedUBA
    // TopupRequirement[] requiredUnderlyingTopups;
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

struct UnderlyingPaymentInfo {
    bytes32 sourceAddress;
    bytes32 targetAddress;
    bytes32 paymentHash;
    uint256 valueUBA;
    uint192 gasUBA;
    uint64 underlyingBlock;
}

struct PaymentAnnouncement {
    bytes32 underlyingAddress;
    uint256 valueUBA;
    uint64 firstUnderlyingBlock;
    uint64 lastUnderlyingBlock;
    uint64 createdAtBlock;
}
