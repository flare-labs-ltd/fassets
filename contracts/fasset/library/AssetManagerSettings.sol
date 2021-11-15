// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

library AssetManagerSettings {
    struct Settings {
        // Minimum collateral ratio for new agents.
        uint16 initialMinCollateralRatioBIPS;
        
        // Minimum collateral ratio required to get agent out of liquidation.
        uint16 liquidationMinCollateralRatioBIPS;
        
        // If non-zero, agents must anounce exit from "available for minting" list 
        // and then wait this many seconds before exiting.
        uint64 minSecondsToExitAvailableAgentsList;

        // When announcing exit from  "available for minting" list, only some time is allowed for actual exit,
        // to prevent agents simply announcing exit at the beginning and then exiting whenever they like.
        uint64 maxSecondsToExitAvailableAgentsList;
        
        // Number of underlying blocks that the minter or agent is allowed to pay underlying value.
        // If payment not reported in that time, minting/redemption can be challenged and default action triggered.
        // CAREFUL: Count starts from the current ftso reported underlying block height, which can be
        //          from 0.5 to 2.5 ftso price epochs in the past (usually it's less than 1.5, because we expect 
        //          to get more data closer to the price epoch end, but it can be even more when redeploying ftsos).
        uint64 underlyingBlocksForPayment;
        
        // Number of underlying blocks that the agent is allowed to perform allowed underlying payment
        // (e.g. fee withdrawal). It can be much longer than the limit for required payments - it's only here
        // to make sure payment happens before payment verification data is expired in a few days.
        uint64 underlyingBlocksForAllowedPayment;
        
        // Number of underlying blocks that the agent is allowed to perform underlying address topup.
        // Topup is only needed when underlying gas is bigger that funds on allowed payments account plus
        // redemption fee, so it should be very rare.
        uint64 underlyingBlocksForTopup;

        // Lot size in underlying currency base amount (UBA, e.g. wei or satoshi).
        uint256 lotSizeUBA;                              // in underlying asset wei/satoshi
        
        // Redemption fee in underlying currency base amount (UBA).
        uint256 redemptionFeeUBA;
        
        // On redemption underlying payment failure, redeemer is compensated with
        // redemption value recalculated in flare/sgb times redemption failure factor.
        // Expressed in BIPS, e.g. 12000 for factor of 1.2.
        uint32 redemptionFailureFactorBIPS;
        
        // After illegal payment challenge against an agent is triggered, there is some time to needed to wait 
        // to allow the agent to respond with legal payment report (e.g. redemption payment; for fee withdrawal
        // there needs to be prior announcement.)
        uint64 paymentChallengeWaitMinSeconds;
    }
}
