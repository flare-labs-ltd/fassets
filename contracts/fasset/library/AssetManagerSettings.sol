// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "flare-smart-contracts/contracts/userInterfaces/IFtso.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol";
import "../../generated/interface/IAttestationClient.sol";
import "../interface/IWNat.sol";


library AssetManagerSettings {
    struct Settings {
        // Required contracts.
        // TODO: once we have AssetManagerController, connect it to the AddressUpdater.
        
        // Attestation client verifies and decodes attestation proofs.
        IAttestationClient attestationClient;
        
        // WNat contract interface. Agent vaults also read it from here.
        IWNat wNat;
        
        // FTSO registry from which the system obtains ftso's for nat and asset.
        IFtsoRegistry ftsoRegistry;
        
        // FTSO contract for NAT currency.
        uint32 natFtsoIndex;
        
        // FTSO contract for managed asset.
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
        uint64 lotSizeAMG;
        
        // for some chains (e.g. Ethereum) we require that agent proves that underlying address is an EOA address
        // this must be done by presenting a payment proof from that address
        // immutable
        bool requireEOAAddressProof;
        
        // Minimum collateral ratio for healthy agents.
        uint32 minCollateralRatioBIPS;

        // Minimum collateral ratio for agent in CCB (Collateral call band).
        // A bit smaller than minCollateralRatioBIPS.
        uint32 ccbMinCollateralRatioBIPS;
        
        // Minimum collateral ratio required to get agent out of liquidation.
        // If the agent's collateral ratio is less than this, skip the CCB and go straight to liquidation.
        // Wiil always be greater than minCollateralRatioBIPS.
        uint32 safetyMinCollateralRatioBIPS;
        
        // Number of underlying blocks that the minter or agent is allowed to pay underlying value.
        // If payment not reported in that time, minting/redemption can be challenged and default action triggered.
        // CAREFUL: Count starts from the current proved block height, so the minters and agents should 
        // make sure that current block height is fresh, otherwise they might not have enough time for payment.
        uint64 underlyingBlocksForPayment;
        
        // Minimum time to allow agent to pay for redemption or minter to pay for minting.
        // This is useful for fast chains, when there can be more than one block per second.
        // Redemption/minting payment failure can be called only after underlyingSecondsForPayment have elapsed
        // on underlying chain.
        // CAREFUL: Count starts from the current proved block timestamp, so the minters and agents should 
        // make sure that current block timestamp is fresh, otherwise they might not have enough time for payment.
        // This is partially mitigated by adding local duration since the last block height update to
        // the current underlying block timestamp.
        uint64 underlyingSecondsForPayment;

        // Redemption fee in underlying currency base amount (UBA).
        uint16 redemptionFeeBips;
        
        // On redemption underlying payment failure, redeemer is compensated with
        // redemption value recalculated in flare/sgb times redemption failure factor.
        // Expressed in BIPS, e.g. 12000 for factor of 1.2.
        uint32 redemptionFailureFactorBIPS;
        
        // If the agent or redeemer becomes unresponsive, we still need payment or non-payment confirmations
        // to be presented eventually to properly track agent's underlying balance.
        // Therefore we allow anybody to confirm payments/non-payments this many seconds after request was made.
        uint64 confirmationByOthersAfterSeconds;

        // The user who makes abandoned redemption confirmations gets rewarded by the following amount.
        uint128 confirmationByOthersRewardNATWei;
        
        // To prevent unbounded work, the number of tickets redeemed in a single request is limited.
        uint16 maxRedeemedTickets;
        
        // Challenge reward can be composed of two part - fixed and proportional (any of them can be zero).
        // This is the proportional part (in BIPS).
        uint16 paymentChallengeRewardBIPS;
        
        // Challenge reward can be composed of two part - fixed and proportional (any of them can be zero).
        // This is the fixed part (in underlying AMG, so that we can easily set it as some percent of lot size).
        uint128 paymentChallengeRewardNATWei;

        // Agent has to announce any collateral withdrawal and then wait for at least withdrawalWaitMinSeconds.
        // This prevents challenged agent to remove all collateral before challenge can be proved.
        uint64 withdrawalWaitMinSeconds;

        // After first phase, instead of price premium, percentage of collateral is offered.
        // Expressed in BIPS, e.g. [6000, 8000, 10000] for 60%, 80% and 100%.
        // CAREFUL: values in array must increase and be <= 10000
        uint32[] liquidationCollateralPremiumBIPS;

        // Agent can remain in CCB for this much time, after that liquidation starts automatically.
        uint64 ccbTimeSeconds;
        
        // If there was no liquidator for the current liquidation offer, 
        // go to the next step of liquidation after a certain period of time.
        uint64 liquidationStepSeconds;

        // When asset manager is paused, no new mintings can be done.
        // It is an extreme measure, which can be used in case there is a dangerous hole in the system.
        bool paused;
    }

}
