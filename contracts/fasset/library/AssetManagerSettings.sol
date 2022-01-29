// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IAttestationClient.sol";

library AssetManagerSettings {
    struct Settings {
        // Required contracts.
        // Can be changed by AddressUpdater.
        IAttestationClient attestationClient;
        
        // Asset specific settings
        // immutable?
        uint16 assetIndex;
        
        // Must match attestation data chainId.
        // immutable
        uint32 chainId;

        // Collateral reservation fee that must be paid by the minter.
        // Payment is in NAT, but is proportional to the value of assets to be minted.
        uint256 collateralReservationFeeBIPS;
        
        // Collateral reservation fee is burned on successful minting.
        address payable burnAddress;

        // Asset unit value (e.g. 1 BTC or 1 ETH) in UBA = 10 ** assetToken.decimals()
        uint64 assetUnitUBA;
        
        // the granularity in which lots are measured = the value of AMG (asset minting granularity) in UBA
        // can only be changed via redeploy of AssetManager
        uint64 assetMintingGranularityUBA;
        
        // Lot size in asset minting granularity. May change, which affects subsequent mintings and redemptions.
        uint64 lotSizeAMG;
        
        // Minimum collateral ratio for new agents.
        uint16 initialMinCollateralRatioBIPS;

        // Collateral call band - CCB
        uint16 liquidationMinCollateralCallBandBIPS;
        
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
        
        // Minimum time to allow for agent to pay for redemption or respond to invalid underlyingBlock 
        // in redemption request. Redemption failure can be called only after both
        // underlyingBlocksForPayment are mined on underlying chain and minSecondsForPayment time elapses.
        uint64 minSecondsForPayment;

        // Time allowed for minter to respond to underlyingBlockheight challenge.
        uint64 minSecondsForBlockChallengeResponse;
        
        // Number of underlying blocks that the agent is allowed to perform allowed underlying payment
        // (e.g. fee withdrawal). It can be much longer than the limit for required payments - it's only here
        // to make sure payment happens before payment verification data is expired in a few days.
        uint64 underlyingBlocksForAllowedPayment;
        
        // Number of underlying blocks that the agent is allowed to perform underlying address topup.
        // Topup is only needed when underlying gas is bigger that funds on allowed payments account plus
        // redemption fee, so it should be very rare.
        uint64 underlyingBlocksForTopup;

        // Redemption fee in underlying currency base amount (UBA).
        uint16 redemptionFeeBips;
        
        // On redemption underlying payment failure, redeemer is compensated with
        // redemption value recalculated in flare/sgb times redemption failure factor.
        // Expressed in BIPS, e.g. 12000 for factor of 1.2.
        uint32 redemptionFailureFactorBIPS;
        
        // To prevent unbounded work, the number of tickets redeemed in a single request is limited.
        uint16 maxRedeemedTickets;
        
        // After illegal payment challenge against an agent is triggered, there is some time to needed to wait 
        // to allow the agent to respond with legal payment report (e.g. redemption payment; for fee withdrawal
        // there needs to be prior announcement.)
        uint64 paymentChallengeWaitMinSeconds;

        // Agent has to announce any collateral withdrawal and then wait for at least withdrawalWaitMinSeconds.
        // This prevents challenged agent to remove all collateral before challenge can be proved.
        uint64 withdrawalWaitMinSeconds;

        // In first phase of liquidation, liquidator is compensated with
        // value recalculated in flare/sgb times liquidation price premium factor.
        // Expressed in BIPS, e.g. 12500 for factor of 1.25.
        uint16 liquidationPricePremiumBIPS;

        // After first phase, instead of price premium, percentage of collateral is offered.
        // Expressed in BIPS, e.g. [6000, 8000, 10000] for 60%, 80% and 100%.
        // CAREFUL: values in array must increase and be <= 10000
        uint16[] liquidationCollateralPremiumBIPS;

        // If there was no liquidator for the current liquidation offer, 
        // go to the next step of liquidation after a certain period of time.
        uint64 newLiquidationStepAfterMinSeconds;
        
        // for some chains (e.g. Ethereum) we require that agent proves that underlying address is an EOA address
        // this must be done by presenting a payment proof from that address
        bool requireEOAAddressProof;
    }

}
