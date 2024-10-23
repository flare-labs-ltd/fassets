// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


library AgentInfo {
    enum Status {
        // agent is operating normally
        NORMAL,
        // agent in collateral call band
        CCB,
        // liquidation due to collateral ratio - ends when agent is healthy
        LIQUIDATION,
        // illegal payment liquidation - always liquidates all and then agent must close vault
        FULL_LIQUIDATION,
        // agent announced destroy, cannot mint again; all existing mintings have been redeemed before
        DESTROYING
    }

    struct Info {
        // Current agent's status.
        AgentInfo.Status status;

        // Agent vault owner's management address, used for occasional administration.
        // Immutable.
        address ownerManagementAddress;

        // Agent vault owner's work address, used for automatic operations.
        // Can be changed by a call from the owner's management address.
        address ownerWorkAddress;

        // Agent's collateral pool address
        address collateralPool;

        // Agent collateral pool's pool token address
        address collateralPoolToken;

        // Underlying address as string - to be used for minting payments.
        // For most other purposes, you use underlyingAddressHash, which is `keccak256(underlyingAddressString)`.
        string underlyingAddressString;

        // If true, anybody can mint against this agent.
        // If false, the agent can only self-mint.
        // Once minted, all redemption tickets go to the same (public) queue, regardless of this flag.
        bool publiclyAvailable;

        // Current fee the agent charges for minting (paid in underlying currency).
        uint256 feeBIPS;

        // Share of the minting fee that goes to the pool as percentage of the minting fee.
        // This share of fee is minted as f-assets and belongs to the pool.
        uint256 poolFeeShareBIPS;

        // The token identifier of the agent's current vault collateral.
        // Token identifier can be used to call AssetManager.getCollateralType().
        IERC20 vaultCollateralToken;

        // Amount, set by agent, at which locked and free collateral are calculated for new mintings.
        // For agent's vault collateral.
        uint256 mintingVaultCollateralRatioBIPS;

        // Amount, set by agent, at which locked and free collateral are calculated for new mintings.
        // For pool collateral.
        uint256 mintingPoolCollateralRatioBIPS;

        // The maximum number of lots that the agent can mint.
        // This can change any moment due to minting, redemption or price changes.
        uint256 freeCollateralLots;

        // Total amount of vault collateral in agent's vault.
        uint256 totalVaultCollateralWei;

        // Free collateral, available for new mintings.
        // Note: this value doesn't tell you anything about agent being near liquidation, since it is
        // calculated at agentMinCollateralRatio, not minCollateralRatio.
        // Use collateralRatioBIPS to see whether the agent is near liquidation.
        uint256 freeVaultCollateralWei;

        // The actual agent's collateral ratio, as it is used in liquidation.
        // For calculation, the system checks both FTSO prices and trusted provider's prices and uses
        // the ones that give higher ratio.
        uint256 vaultCollateralRatioBIPS;

        // The token identifier of the agent's current vault collateral.
        // Token identifier can be used to call AssetManager.getCollateralType().
        IERC20 poolWNatToken;

        // Total amount of NAT collateral in agent's pool.
        uint256 totalPoolCollateralNATWei;

        // Free NAT pool collateral (see vault collateral for details).
        uint256 freePoolCollateralNATWei;

        // The actual pool collateral ratio (see vault collateral for details).
        uint256 poolCollateralRatioBIPS;

        // The amount of pool tokens that belong to agent's vault. This limits the amount of possible
        // minting: to be able to mint, the NAT value of all backed fassets together with new ones, times
        // mintingPoolHoldingsRequiredBIPS, must be smaller than the agent's pool tokens amount converted to NAT.
        // Note: the amount of agent's pool tokens only affects minting, not liquidation.
        uint256 totalAgentPoolTokensWei;

        // The amount of vault collateral that will be withdrawn by the agent.
        uint256 announcedVaultCollateralWithdrawalWei;

        // The amount of pool tokens that will be withdrawn by the agent.
        uint256 announcedPoolTokensWithdrawalWei;

        // Free agent's pool tokens.
        uint256 freeAgentPoolTokensWei;

        // Total amount of minted f-assets.
        uint256 mintedUBA;

        // Total amount reserved for ongoing mintings.
        uint256 reservedUBA;

        // Total amount of ongoing redemptions.
        uint256 redeemingUBA;

        // Total amount of ongoing redemptions that lock the pool collateral.
        // (In pool self-close exits, pool collateral is not locked. So the amount of locked
        // collateral in the pool can be less than the amount of locked vault collateral.)
        uint256 poolRedeemingUBA;

        // Total amount of dust (unredeemable minted f-assets).
        // Note: dustUBA is part of mintedUBA, so the amount of redeemable f-assets is calculated as
        // `mintedUBA - dustUBA`
        uint256 dustUBA;

        // Liquidation info
        // If the agent is in CCB or if current liquidation started in CCB, the time agent entered CCB (otherwise 0).
        uint256 ccbStartTimestamp;

        // If the agent is in LIQUIDATION or FULL_LIQUIDATION, the time agent entered liquidation.
        // If the agent is in CCB, the time agent will enter liquidation (in future).
        // If status is neither of that, returns 0.
        // Can be used for calculating current liquidation premium, which depends on time since liquidation started.
        uint256 liquidationStartTimestamp;

        // When agent is in liquidation, this is the amount o FAssets that need to be liquidated to bring the agent's
        // position to safety. When performing liquidation, only up to this amount of FAssets will be liquidated.
        // If not in liquidation, this value is 0.
        // Since the liquidation state may need to be upgraded by, call `startLiquidation` before
        // `getAgentInfo` to get the value that will actually be used in liquidation.
        uint256 maxLiquidationAmountUBA;

        // When agent is in liquidation, this is the factor (in BIPS) of the converted value of the liquidated
        // FAssets paid by the vault collateral. If not in liquidation, this value is 0.
        uint256 liquidationPaymentFactorVaultBIPS;

        // When agent is in liquidation, this is the factor (in BIPS) of the converted value of the liquidated
        // FAssets paid by the pool collateral. If not in liquidation, this value is 0.
        uint256 liquidationPaymentFactorPoolBIPS;

        // Total underlying balance (backing and free).
        int256 underlyingBalanceUBA;

        // The minimum underlying balance that has to be held by the agent. Below this, agent is liquidated.
        uint256 requiredUnderlyingBalanceUBA;

        // Underlying balance not backing anything (can be used for gas/fees or withdrawn after announcement).
        int256 freeUnderlyingBalanceUBA;

        // Current underlying withdrawal announcement (or 0 if no announcement was made).
        uint256 announcedUnderlyingWithdrawalId;

        // The factor set by the agent to multiply the price at which agent buys f-assets from pool
        // token holders on self-close exit (when requested or the redeemed amount is less than 1 lot).
        uint256 buyFAssetByAgentFactorBIPS;

        // The minimum collateral ratio above which a staker can exit the pool
        // (this is CR that must be left after exit).
        // Must be higher than system minimum collateral ratio for pool collateral.
        uint256 poolExitCollateralRatioBIPS;

        // The CR below which it is possible to enter the pool at discounted rate (to prevent liquidation).
        // Must be higher than system minimum collateral ratio for pool collateral.
        uint256 poolTopupCollateralRatioBIPS;

        // The discount to pool token price when entering and pool CR is below pool topup CR.
        uint256 poolTopupTokenPriceFactorBIPS;

        // Agent's handshake type - minting or redeeming can be rejected.
        // 0 - no verification, 1 - manual verification, ...
        uint256 handshakeType;
    }
}
