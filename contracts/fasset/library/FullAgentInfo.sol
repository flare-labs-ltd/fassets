// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./Conversion.sol";
import "./Agents.sol";
import "./AgentCollateral.sol";
import "./Liquidation.sol";
import "./UnderlyingBalance.sol";

library FullAgentInfo {
    using SafeMath for uint256;
    using SafeCast for uint256;
    using MathUtils for uint256;
    using SafePct for *;
    using AgentCollateral for Collateral.CombinedData;
    using AgentCollateral for Collateral.Data;
    using Agents for Agent.State;

    enum AgentStatusInfo {
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

    struct AgentInfo {
        // Current agent's status.
        AgentStatusInfo status;

        // Agent vault owner's cold wallet address, used for occasional administration.
        // Immutable.
        address ownerColdWalletAddress;

        // Agent vault owner's cold wallet address, used for automatic operations.
        // Can be changed by a call from the owner's cold wallet.
        address ownerHotWalletAddress;

        // Agent's collateral pool address
        address collateralPool;

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

        // The token identifier of the agent's current class 1 collateral.
        // Token identifier can be used to call AssetManager.getCollateralTokenInfo().
        IERC20 class1CollateralToken;

        // Amount, set by agent, at which locked and free collateral are calculated for new mintings.
        // For agent's class 1 collateral.
        uint256 mintingClass1CollateralRatioBIPS;

        // Amount, set by agent, at which locked and free collateral are calculated for new mintings.
        // For pool collateral.
        uint256 mintingPoolCollateralRatioBIPS;

        // The maximum number of lots that the agent can mint.
        // This can change any moment due to minting, redemption or price changes.
        uint256 freeCollateralLots;

        // Total amount of class1 collateral in agent's vault.
        uint256 totalClass1CollateralWei;

        // Free collateral, available for new mintings.
        // Note: this value doesn't tell you anything about agent being near liquidation, since it is
        // calculated at agentMinCollateralRatio, not minCollateralRatio.
        // Use collateralRatioBIPS to see whether the agent is near liquidation.
        uint256 freeClass1CollateralWei;

        // The actual agent's collateral ratio, as it is used in liquidation.
        // For calculation, the system checks both FTSO prices and trusted provider's prices and uses
        // the ones that give higher ratio.
        uint256 class1CollateralRatioBIPS;

        // Total amount of NAT collateral in agent's pool.
        uint256 totalPoolCollateralNATWei;

        // Free NAT pool collateral (see class1 for details).
        uint256 freePoolCollateralNATWei;

        // The actual pool collateral ratio (see class1 for details).
        uint256 poolCollateralRatioBIPS;

        // The amount of pool tokens that belong to agent's vault. This limits the amount of possible
        // minting: to be able to mint, the NAT value of all backed fassets together with new ones, times
        // mintingPoolHoldingsRequiredBIPS, must be smaller than the agent's pool tokens amount converted to NAT.
        // Note: the amount of agent's pool tokens only affects minting, not liquidation.
        uint256 totalAgentPoolTokensWei;

        // The amount of class1 collateral that will be withdrawn by the agent.
        uint256 announcedClass1WithdrawalWei;

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
        // collateral in the pool can be less than the amount of locked class1 collateral.)
        uint256 poolRedeemingUBA;

        // The amount of underlying balance that is backing the assets during redemption.
        // Is mostly equal to redeemingUBA, except when the redeemer calls default and until
        // the agent presents proof of failed payment or calls finishWithoutPayment.
        uint256 underlyingRedeemingUBA;

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

        // Total underlying balance (backing and free).
        uint256 underlyingBalanceUBA;

        // Underlying balance not backing anything (can be used for gas/fees or withdrawn after announcement).
        uint256 freeUnderlyingBalanceUBA;

        // The minimum underlying balance that has to be held by the agent. Below this, agent is liquidated.
        uint256 requiredUnderlyingBalanceUBA;

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
    }

    function getAgentInfo(
        address _agentVault
    )
        external view
        returns (AgentInfo memory _info)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        Collateral.CombinedData memory collateralData = AgentCollateral.combinedData(agent);
        CollateralToken.Data storage collateral = agent.getClass1Collateral();
        CollateralToken.Data storage poolCollateral = agent.getPoolCollateral();
        Liquidation.CRData memory cr = Liquidation.getCollateralRatiosBIPS(agent);
        _info.status = _getAgentStatusInfo(agent);
        (_info.ownerColdWalletAddress, _info.ownerHotWalletAddress) = Agents.vaultOwner(agent);
        _info.collateralPool = address(agent.collateralPool);
        _info.underlyingAddressString = agent.underlyingAddressString;
        _info.publiclyAvailable = agent.availableAgentsPos != 0;
        _info.class1CollateralToken = collateral.token;
        _info.feeBIPS = agent.feeBIPS;
        _info.poolFeeShareBIPS = agent.poolFeeShareBIPS;
        _info.mintingClass1CollateralRatioBIPS =
            Math.max(agent.mintingClass1CollateralRatioBIPS, collateral.minCollateralRatioBIPS);
        _info.mintingPoolCollateralRatioBIPS =
            Math.max(agent.mintingPoolCollateralRatioBIPS, poolCollateral.minCollateralRatioBIPS);
        _info.freeCollateralLots = collateralData.freeCollateralLots(agent);
        _info.totalClass1CollateralWei = collateralData.agentCollateral.fullCollateral;
        _info.freeClass1CollateralWei = collateralData.agentCollateral.freeCollateralWei(agent);
        _info.class1CollateralRatioBIPS = cr.class1CR;
        _info.totalPoolCollateralNATWei = collateralData.poolCollateral.fullCollateral;
        _info.freePoolCollateralNATWei = collateralData.poolCollateral.freeCollateralWei(agent);
        _info.poolCollateralRatioBIPS = cr.poolCR;
        _info.totalAgentPoolTokensWei = collateralData.agentPoolTokens.fullCollateral;
        _info.freeAgentPoolTokensWei = collateralData.agentPoolTokens.freeCollateralWei(agent);
        _info.announcedClass1WithdrawalWei =
            agent.withdrawalAnnouncement(Collateral.Kind.AGENT_CLASS1).amountWei;
        _info.announcedPoolTokensWithdrawalWei =
            agent.withdrawalAnnouncement(Collateral.Kind.AGENT_POOL).amountWei;
        _info.mintedUBA = Conversion.convertAmgToUBA(agent.mintedAMG);
        _info.reservedUBA = Conversion.convertAmgToUBA(agent.reservedAMG);
        _info.redeemingUBA = Conversion.convertAmgToUBA(agent.redeemingAMG);
        _info.poolRedeemingUBA = Conversion.convertAmgToUBA(agent.poolRedeemingAMG);
        _info.underlyingRedeemingUBA = Conversion.convertAmgToUBA(agent.underlyingRedeemingAMG);
        _info.dustUBA = Conversion.convertAmgToUBA(agent.dustAMG);
        _info.ccbStartTimestamp = _getCCBStartTime(agent);
        _info.liquidationStartTimestamp = _getLiquidationStartTime(agent);
        _info.underlyingBalanceUBA = agent.underlyingBalanceUBA;
        _info.freeUnderlyingBalanceUBA = UnderlyingBalance.freeUnderlyingUBA(agent);
        _info.requiredUnderlyingBalanceUBA = UnderlyingBalance.requiredUnderlyingUBA(agent);
        _info.announcedUnderlyingWithdrawalId = agent.announcedUnderlyingWithdrawalId;
        _info.buyFAssetByAgentFactorBIPS = agent.buyFAssetByAgentFactorBIPS;
        _info.poolExitCollateralRatioBIPS = agent.collateralPool.exitCollateralRatioBIPS();
        _info.poolTopupCollateralRatioBIPS = agent.collateralPool.topupCollateralRatioBIPS();
        _info.poolTopupTokenPriceFactorBIPS = agent.collateralPool.topupTokenPriceFactorBIPS();
    }

    function _getAgentStatusInfo(
        Agent.State storage _agent
    )
        private view
        returns (AgentStatusInfo)
    {
        Agent.Status status = _agent.status;
        if (status == Agent.Status.NORMAL) {
            return AgentStatusInfo.NORMAL;
        } else if (status == Agent.Status.LIQUIDATION) {
            Agent.LiquidationPhase phase = Liquidation.currentLiquidationPhase(_agent);
            return phase == Agent.LiquidationPhase.CCB ? AgentStatusInfo.CCB : AgentStatusInfo.LIQUIDATION;
        } else if (status == Agent.Status.FULL_LIQUIDATION) {
            return AgentStatusInfo.FULL_LIQUIDATION;
        } else {
            assert (status == Agent.Status.DESTROYING);
            return AgentStatusInfo.DESTROYING;
        }
    }

    function _getCCBStartTime(
        Agent.State storage _agent
    )
        private view
        returns (uint256)
    {
        if (_agent.status != Agent.Status.LIQUIDATION) return 0;
        return _agent.initialLiquidationPhase == Agent.LiquidationPhase.CCB ? _agent.liquidationStartedAt : 0;
    }

    function _getLiquidationStartTime(
        Agent.State storage _agent
    )
        private view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        if (_agent.status == Agent.Status.LIQUIDATION) {
            return _agent.initialLiquidationPhase == Agent.LiquidationPhase.CCB
                ? _agent.liquidationStartedAt + settings.ccbTimeSeconds
                : _agent.liquidationStartedAt;
        } else if (_agent.status == Agent.Status.FULL_LIQUIDATION) {
            return _agent.liquidationStartedAt;
        } else {
            return 0;
        }
    }
}
