// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol";
import "../../generated/interface/IAttestationClient.sol";
import "../interface/IAgentVaultFactory.sol";
import "../interface/IWNat.sol";
import "../interface/IWhitelist.sol";


library AssetManagerSettings {
    uint256 internal constant POOL_COLLATERAL = 0;   // index of pool collateral (WNat) in collateralTokens
    
    enum TokenClass {
        NONE,   // unused
        CLASS1, // usable as class 1 collateral
        POOL    // pool collateral type
    }
    
    struct CollateralToken {
        // Token symbol. Must match the FTSO symbol for this collateral.
        string symbol;
        
        // The ERC20 token contract for this collateral type.
        IERC20 token;
        
        // The kind of collateral for this token.
        TokenClass tokenClass;
        
        // Same as token.decimals().
        uint8 decimals;
        
        // Index in the FtsoRegistry corresponding to ftsoSymbol, automatically calculated from ftsoSymbol.
        uint16 ftsoIndex;
        
        // If some token should not be used anymore as collateral, it has to be announced in advance and it 
        // is still valid until this timestamp. After that time, the corresponding collateral is considered as
        // zero and the agents that haven't replaced it are liquidated.
        // When the invalidation has not been announced, this value is 0.
        uint64 validUntil;
        
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
    }
    
    struct Settings {
        // Required contracts.
        // Only used to verify that calls come from assetManagerController.
        address assetManagerController;

        // Factory for creating new agent vaults.
        IAgentVaultFactory agentVaultFactory;
        
        // If set, the whitelist contains a list of accounts that can call public methods
        // (minting, redeeming, challenging, etc.)
        // This can be `address(0)`, in which case no whitelist checks are done.
        IWhitelist whitelist;
        
        // Attestation client verifies and decodes attestation proofs.
        IAttestationClient attestationClient;
        
        // FTSO registry from which the system obtains ftso's for nat and asset.
        IFtsoRegistry ftsoRegistry;
        
        // FTSO contract for managed asset (index).
        // cannot be set directly - obtained from ftso registry for symbol assetFtsoSymbol
        uint32 assetFtsoIndex;
        
        // Same as assetToken.decimals()
        // immutable
        uint8 assetDecimals;
        
        // Number of decimals of precision of minted amounts.
        // assetMintingGranularityUBA = 10 ** (assetDecimals - assetMintingDecimals)
        // immutable
        uint8 assetMintingDecimals;
        
        // The minimum amount of pool tokens the agent must hold to be able to mint.
        // To be able to mint, the NAT value of all backed fassets together with new ones times this percentage
        // must be smaller than the agent's pool tokens' amount converted to NAT.
        uint32 mintingPoolHoldingsRequiredBIPS;
        
        // FTSO contract for managed asset (symbol).
        // immutable
        string assetFtsoSymbol;
        
        // All collateral types, used for class 1, class 2 or pool.
        // Pool collateral (always WNat) has index 0.
        CollateralToken[] collateralTokens;
        
        // WNat is always used as pool collateral.
        // Collateral reservation fee is burned on successful minting.
        // immutable
        address payable burnAddress;

        // If true, the NAT burning is done indirectly via transfer to burner contract and then self-destruct.
        // This is necessary on Songbird, where the burn address is unpayable.
        bool burnWithSelfDestruct;
        
        // Must match attestation data chainId.
        // immutable
        uint32 chainId;

        // Collateral reservation fee that must be paid by the minter.
        // Payment is in NAT, but is proportional to the value of assets to be minted.
        uint16 collateralReservationFeeBIPS;
        
        // Asset unit value (e.g. 1 BTC or 1 ETH) in UBA = 10 ** assetToken.decimals()
        // immutable
        uint64 assetUnitUBA;
        
        // The granularity in which lots are measured = the value of AMG (asset minting granularity) in UBA.
        // Can only be changed via redeploy of AssetManager.
        // AMG is used internally instead of UBA so that minted quantities fit into 64bits to reduce storage.
        // So assetMintingGranularityUBA should be set so that the max supply in AMG of this currency
        // in foreseeable time (say 100yr) cannot overflow 64 bits.
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
        uint32 redemptionDefaultFactorAgentC1BIPS;
        
        uint32 redemptionDefaultFactorPoolBIPS;
        
        // If the agent or redeemer becomes unresponsive, we still need payment or non-payment confirmations
        // to be presented eventually to properly track agent's underlying balance.
        // Therefore we allow anybody to confirm payments/non-payments this many seconds after request was made.
        // rate-limited
        uint64 confirmationByOthersAfterSeconds;

        // The user who makes abandoned redemption confirmations gets rewarded by the following amount.
        // rate-limited
        uint128 confirmationByOthersRewardC1Wei;
        
        // To prevent unbounded work, the number of tickets redeemed in a single request is limited.
        // rate-limited
        // >= 1
        uint16 maxRedeemedTickets;
        
        // Challenge reward can be composed of two part - fixed and proportional (any of them can be zero).
        // This is the proportional part (in BIPS).
        // rate-limited
        uint16 paymentChallengeRewardBIPS;
        
        // Challenge reward can be composed of two part - fixed and proportional (any of them can be zero).
        // This is the fixed part (in class 1 collateral token wei).
        // rate-limited
        uint128 paymentChallengeRewardC1Wei;

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
        
        // Maximum time for which it is possible to obtain payment or non-payment proofs.
        // rate-limited
        uint64 attestationWindowSeconds;
        
        // Minimum time after an update of a setting before the same setting can be updated again.
        // immutable
        uint64 minUpdateRepeatTimeSeconds;
        
        // Ratio at which the agents can buy back their collateral when f-asset is terminated.
        // Typically a bit more than 1 to incentivise agents to buy f-assets and self-close instead.
        // immutable
        uint64 buybackCollateralFactorBIPS;
        
        // Minimum time that has to pass between underlying withdrawal announcement and the confirmation.
        // Any value is ok, but higher values give more security agains multiple announcement attack by a miner.
        // Shouldn't be much bigger than state connector response time, so that payments can be confirmed without 
        // extra wait. Should be smaller than confirmationByOthersAfterSeconds (e.g. less than 1 hour).
        uint64 announcedUnderlyingConfirmationMinSeconds;
    }

}
