// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol";
import "../../generated/interface/IAttestationClient.sol";
import "../interface/IWNat.sol";


library AssetManagerSettings {
    struct Settings {
        // Required contracts.
        // Only used to verify that calls come from assetManagerController.
        address assetManagerController;
        
        // Attestation client verifies and decodes attestation proofs.
        IAttestationClient attestationClient;
        
        // WNat contract interface. Agent vaults also read it from here.
        IWNat wNat;
        
        // FTSO registry from which the system obtains ftso's for nat and asset.
        IFtsoRegistry ftsoRegistry;
        
        // FTSO contract for NAT currency.
        // immutable?
        uint32 natFtsoIndex;
        
        // FTSO contract for managed asset.
        // immutable?
        uint32 assetFtsoIndex;
        
        // Collateral reservation fee is burned on successful minting.
        // immutable
        address payable burnAddress;

        // Must match attestation data chainId.
        // immutable
        uint32 chainId;

        // Collateral reservation fee that must be paid by the minter.
        // Payment is in NAT, but is proportional to the value of assets to be minted.
        uint16 collateralReservationFeeBIPS;
        
        // Asset unit value (e.g. 1 BTC or 1 ETH) in UBA = 10 ** assetToken.decimals()
        // immutable
        uint64 assetUnitUBA;
        
        // the granularity in which lots are measured = the value of AMG (asset minting granularity) in UBA
        // can only be changed via redeploy of AssetManager
        // immutable
        uint64 assetMintingGranularityUBA;
        
        // Lot size in asset minting granularity. May change, which affects subsequent mintings and redemptions.
        // rate-limited
        uint64 lotSizeAMG;
        
        // Maximum age that trusted price feed is valid.
        // Otherwise (if there were no trusted votes for that long) just use generic ftso price feed.
        // rate-limited
        uint64 maxTrustedPriceAgeSeconds;
        
        // for some chains (e.g. Ethereum) we require that agent proves that underlying address is an EOA address
        // this must be done by presenting a payment proof from that address
        // immutable
        bool requireEOAAddressProof;
        
        // Minimum collateral ratio for healthy agents.
        // timelocked
        uint32 minCollateralRatioBIPS;

        // Minimum collateral ratio for agent in CCB (Collateral call band).
        // A bit smaller than minCollateralRatioBIPS.
        // timelocked
        uint32 ccbMinCollateralRatioBIPS;
        
        // Minimum collateral ratio required to get agent out of liquidation.
        // If the agent's collateral ratio is less than this, skip the CCB and go straight to liquidation.
        // Wiil always be greater than minCollateralRatioBIPS.
        // timelocked
        uint32 safetyMinCollateralRatioBIPS;
        
        // Number of underlying blocks that the minter or agent is allowed to pay underlying value.
        // If payment not reported in that time, minting/redemption can be challenged and default action triggered.
        // CAREFUL: Count starts from the current proved block height, so the minters and agents should 
        // make sure that current block height is fresh, otherwise they might not have enough time for payment.
        // timelocked
        uint64 underlyingBlocksForPayment;
        
        // Minimum time to allow agent to pay for redemption or minter to pay for minting.
        // This is useful for fast chains, when there can be more than one block per second.
        // Redemption/minting payment failure can be called only after underlyingSecondsForPayment have elapsed
        // on underlying chain.
        // CAREFUL: Count starts from the current proved block timestamp, so the minters and agents should 
        // make sure that current block timestamp is fresh, otherwise they might not have enough time for payment.
        // This is partially mitigated by adding local duration since the last block height update to
        // the current underlying block timestamp.
        // timelocked
        uint64 underlyingSecondsForPayment;

        // Redemption fee in underlying currency base amount (UBA).
        // rate-limited
        uint16 redemptionFeeBIPS;
        
        // On redemption underlying payment failure, redeemer is compensated with
        // redemption value recalculated in flare/sgb times redemption failure factor.
        // Expressed in BIPS, e.g. 12000 for factor of 1.2.
        // rate-limited
        // > 1
        uint32 redemptionDefaultFactorBIPS;
        
        // If the agent or redeemer becomes unresponsive, we still need payment or non-payment confirmations
        // to be presented eventually to properly track agent's underlying balance.
        // Therefore we allow anybody to confirm payments/non-payments this many seconds after request was made.
        // rate-limited
        uint64 confirmationByOthersAfterSeconds;

        // The user who makes abandoned redemption confirmations gets rewarded by the following amount.
        // rate-limited
        uint128 confirmationByOthersRewardNATWei;
        
        // To prevent unbounded work, the number of tickets redeemed in a single request is limited.
        // rate-limited
        // >= 1
        uint16 maxRedeemedTickets;
        
        // Challenge reward can be composed of two part - fixed and proportional (any of them can be zero).
        // This is the proportional part (in BIPS).
        // rate-limited
        uint16 paymentChallengeRewardBIPS;
        
        // Challenge reward can be composed of two part - fixed and proportional (any of them can be zero).
        // This is the fixed part (in underlying AMG, so that we can easily set it as some percent of lot size).
        // rate-limited
        uint128 paymentChallengeRewardNATWei;

        // Agent has to announce any collateral withdrawal ar vault destroy and then wait for at least 
        // withdrawalWaitMinSeconds. This prevents challenged agent to remove all collateral before 
        // challenge can be proved.
        // rate-limited
        uint64 withdrawalWaitMinSeconds;

        // Factor with which to multiply the asset price in native currency to obtain the payment
        // to the liquidator.
        // Expressed in BIPS, e.g. [12000, 16000, 20000] means that the liquidator will be paid 1.2, 1.6 and 2.0
        // times the market price of the liquidated assets.
        // CAREFUL: values in array must increase and be greater than 100%.
        // rate-limited
        uint32[] liquidationCollateralFactorBIPS;

        // Agent can remain in CCB for this much time, after that liquidation starts automatically.
        // rate-limited
        uint64 ccbTimeSeconds;
        
        // If there was no liquidator for the current liquidation offer, 
        // go to the next step of liquidation after a certain period of time.
        // rate-limited
        uint64 liquidationStepSeconds;
        
        // The time to wait for critical settings to take effect.
        // immutable
        uint64 timelockSeconds;
        
        // Minimum time after an update of a setting before the same setting can be updated again.
        // immutable
        uint64 minUpdateRepeatTimeSeconds;
        
        // Maximum time for which it is possible to obtain payment or non-payment proofs.
        // rate-limited
        uint64 attestationWindowSeconds;
        
        // Ratio at which the agents can buy back their collateral when f-asset is stopped.
        // Typically a bit more than 1 to incentivise agents to buy f-assets and self-close instead.
        // immutable?
        uint64 buybackCollateralFactorBIPS;
    }

}
