// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../utils/lib/SafeBips.sol";
import "./Conversion.sol";
import "./Agents.sol";
import "./AgentCollateral.sol";
import "./Liquidation.sol";
import "./data/AssetManagerState.sol";

library FullAgentInfo {
    using SafeMath for uint256;
    using SafeCast for uint256;
    using MathUtils for uint256;
    using SafePct for uint256;
    using SafeBips for uint256;
    using SafeBips for uint64;
    using AgentCollateral for AgentCollateral.MintingData;
    using AgentCollateral for AgentCollateral.CollateralData;
    using AssetManagerState for AssetManagerState.State;
    
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
        
        // Agent vault owner's address.
        address ownerAddress;
        
        // Underlying address as string - to be used for minting payments.
        // For most other purpuses, you use underlyingAddressHash, which is `keccak256(underlyingAddressString)`.
        string underlyingAddressString;
        
        // If true, anybody can mint against this agent.
        // If false, the agent can only self-mint.
        // Once minted, all redemption tickets go to the same (public) queue, regardless of this flag.
        bool publiclyAvailable;
        
        // Current fee the agent charges for minting (paid in underlying currency).
        uint256 feeBIPS;
        
        // The token symbol of the agent's current class 1 collateral.
        string class1CollateralSymbol;
        
        // The index in the collateralTokens list of the agent's current class 1 collateral.
        uint256 class1CollateralIndex;
        
        // Amount, set by agent, at which locked and free collateral are calculated for new mintings.
        // For agent's class 1 collateral.
        uint256 agentMinCollateralRatioBIPS;
        
        // Amount, set by agent, at which locked and free collateral are calculated for new mintings.
        // For pool collateral.
        uint256 agentMinPoolCollateralRatioBIPS;
        
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
        
        // TODO: add info about agent's pool tokens
        
        // Total amount of minted f-assets.
        uint256 mintedUBA;
        
        // Total amount reserved for ongoing mintings.
        uint256 reservedUBA;
        
        // Total amount of ongoing redemptions.
        uint256 redeemingUBA;
        
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
        
        // Underlying balance info (balance on agent's underlying adress)
        // Balance required for backing current mintings.
        uint256 lockedUnderlyingBalanceUBA;
        
        // Remaining underlying balance (can be used for gas/fees or withdrawn after announcement).
        int256 freeUnderlyingBalanceUBA;
        
        // Current underlying withdrawal announcement (or 0 if no announcement was made).
        uint256 announcedUnderlyingWithdrawalId;
    }
    
    function getAgentInfo(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        external view
        returns (AgentInfo memory _agentState)
    {
        // TODO: add missing data
        Agent.State storage agent = Agents.getAgent(_state, _agentVault);
        AgentCollateral.MintingData memory collateralData = AgentCollateral.currentData(_state, agent, _agentVault);
        CollateralToken.Data storage collateral = _state.getClass1Collateral(agent);
        CollateralToken.Data storage poolCollateral = _state.getPoolCollateral();
        _agentState.status = _getAgentStatusInfo(_state, agent, _agentVault);
        _agentState.ownerAddress = Agents.vaultOwner(_agentVault);
        _agentState.underlyingAddressString = agent.underlyingAddressString;
        _agentState.publiclyAvailable = agent.availableAgentsPos != 0;
        _agentState.class1CollateralSymbol = collateral.symbol;
        _agentState.class1CollateralIndex = agent.collateralTokenC1;
        _agentState.feeBIPS = agent.feeBIPS;
        _agentState.agentMinCollateralRatioBIPS = 
            Math.max(agent.agentMinCollateralRatioBIPS, collateral.minCollateralRatioBIPS);
        _agentState.agentMinPoolCollateralRatioBIPS = 
            Math.max(agent.agentMinPoolCollateralRatioBIPS, poolCollateral.minCollateralRatioBIPS);
        _agentState.freeCollateralLots = collateralData.freeCollateralLots(_state, agent);
        _agentState.totalClass1CollateralWei = collateralData.agentCollateral.fullCollateral;
        _agentState.freeClass1CollateralWei = 
            collateralData.agentCollateral.freeCollateralWei(_state, agent);
        (_agentState.class1CollateralRatioBIPS,) = 
            Liquidation.getCollateralRatioBIPS(_state, agent, _agentVault, AgentCollateral.Kind.AGENT_CLASS1);
        _agentState.totalPoolCollateralNATWei = collateralData.poolCollateral.fullCollateral;
        _agentState.freePoolCollateralNATWei = 
            collateralData.poolCollateral.freeCollateralWei(_state, agent);
        (_agentState.poolCollateralRatioBIPS,) = 
            Liquidation.getCollateralRatioBIPS(_state, agent, _agentVault, AgentCollateral.Kind.POOL);
        _agentState.mintedUBA = Conversion.convertAmgToUBA(_state.settings, agent.mintedAMG);
        _agentState.reservedUBA = Conversion.convertAmgToUBA(_state.settings, agent.reservedAMG);
        _agentState.redeemingUBA = Conversion.convertAmgToUBA(_state.settings, agent.redeemingAMG);
        _agentState.dustUBA = Conversion.convertAmgToUBA(_state.settings, agent.dustAMG);
        _agentState.ccbStartTimestamp = _getCCBStartTime(agent);
        _agentState.liquidationStartTimestamp = _getLiquidationStartTime(_state, agent);
        _agentState.lockedUnderlyingBalanceUBA = _agentState.mintedUBA;
        _agentState.freeUnderlyingBalanceUBA = agent.freeUnderlyingBalanceUBA;
        _agentState.announcedUnderlyingWithdrawalId = agent.announcedUnderlyingWithdrawalId;
    }
    
    function _getAgentStatusInfo(
        AssetManagerState.State storage _state,
        Agent.State storage _agent,
        address _agentVault
    )
        private view
        returns (AgentStatusInfo)
    {
        Agent.Status status = _agent.status;
        if (status == Agent.Status.NORMAL) {
            return AgentStatusInfo.NORMAL;
        } else if (status == Agent.Status.LIQUIDATION) {
            Agent.LiquidationPhase phase = Liquidation.currentLiquidationPhase(_state, _agent, _agentVault);
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
        AssetManagerState.State storage _state,
        Agent.State storage _agent
    )
        private view
        returns (uint256)
    {
        if (_agent.status == Agent.Status.LIQUIDATION) {
            return _agent.initialLiquidationPhase == Agent.LiquidationPhase.CCB
                ? _agent.liquidationStartedAt + _state.settings.ccbTimeSeconds
                : _agent.liquidationStartedAt;
        } else if (_agent.status == Agent.Status.FULL_LIQUIDATION) {
            return _agent.liquidationStartedAt;
        } else {
            return 0;
        }
    }
}
