// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeBips.sol";
import "./Conversion.sol";
import "./Agents.sol";
import "./AgentCollateral.sol";
import "./Liquidation.sol";
import "./AssetManagerState.sol";

library FullAgentInfo {
    using SafeMath for uint256;
    using SafeCast for uint256;
    using MathUtils for uint256;
    using SafePct for uint256;
    using SafeBips for uint256;
    using SafeBips for uint64;
    using AgentCollateral for AgentCollateral.Data;
    
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
        
        // Underlying address as string - to be used for minting payments.
        // For most other purpuses, you use underlyingAddressHash, which is `keccak256(underlyingAddressString)`.
        string underlyingAddressString;
        
        // If true, anybody can mint against this agent.
        // If false, the agent can only self-mint.
        // Once minted, all redemption tickets go to the same (public) queue, regardless of this flag.
        bool publiclyAvailable;
        
        // Current fee the agent charges for minting (paid in underlying currency).
        uint256 feeBIPS;
        
        // Amount, set by agent, at which locked and free collateral are calculated for new mintings.
        uint256 agentMinCollateralRatioBIPS;
        
        // Total amount in agent's vault.
        uint256 totalCollateralNATWei;
        
        // Free collateral, available for new mintings.
        // Note: this value doesn't tell you anything about agent being near liquidation, since it is 
        // calculated at agentMinCollateralRatio, not minCollateralRatio.
        // Use collateralRatioBIPS to see whether the agent is near liquidation.
        uint256 freeCollateralNATWei;
        
        // Same as freeCollateralNATWei, but expressed in lots (rounded down) instead of NATWei.
        uint256 freeCollateralLots;
        
        // The actual agent's collateral ratio, as it is used in liquidation.
        // For calculation, the system checks both FTSO prices and trusted provider's prices and uses
        // the ones that give higher ratio.
        uint256 collateralRatioBIPS;
        
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
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        AgentCollateral.Data memory collateralData = AgentCollateral.currentData(_state, _agentVault);
        _agentState.status = _getAgentStatusInfo(_state, agent);
        _agentState.underlyingAddressString = agent.underlyingAddressString;
        _agentState.publiclyAvailable = agent.availableAgentsPos != 0;
        _agentState.feeBIPS = agent.feeBIPS;
        _agentState.agentMinCollateralRatioBIPS = 
            Math.max(agent.agentMinCollateralRatioBIPS, _state.settings.minCollateralRatioBIPS);
        _agentState.totalCollateralNATWei = Agents.fullCollateral(_state, _agentVault);
        _agentState.freeCollateralNATWei = collateralData.freeCollateralWei(agent, _state.settings);
        _agentState.freeCollateralLots = collateralData.freeCollateralLots(agent, _state.settings);
        (_agentState.collateralRatioBIPS,,) = Liquidation.getCollateralRatio(_state, agent, _agentVault);
        _agentState.mintedUBA = Conversion.convertAmgToUBA(_state.settings, agent.mintedAMG);
        _agentState.reservedUBA = Conversion.convertAmgToUBA(_state.settings, agent.reservedAMG);
        _agentState.redeemingUBA = Conversion.convertAmgToUBA(_state.settings, agent.redeemingAMG);
        _agentState.dustUBA = Conversion.convertAmgToUBA(_state.settings, agent.dustAMG);
        _agentState.ccbStartTimestamp = _getCCBStartTime(agent);
        _agentState.liquidationStartTimestamp = _getLiquidationStartTime(_state, agent);
        _agentState.lockedUnderlyingBalanceUBA = _agentState.mintedUBA; // TODO: record all incoming/outgoing?
        _agentState.freeUnderlyingBalanceUBA = agent.freeUnderlyingBalanceUBA;
        _agentState.announcedUnderlyingWithdrawalId = agent.announcedUnderlyingWithdrawalId;
    }
    
    function _getAgentStatusInfo(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent
    )
        private view
        returns (AgentStatusInfo)
    {
        Agents.AgentStatus status = _agent.status;
        if (status == Agents.AgentStatus.NORMAL) {
            return AgentStatusInfo.NORMAL;
        } else if (status == Agents.AgentStatus.LIQUIDATION) {
            Agents.LiquidationPhase phase = Liquidation.currentLiquidationPhase(_state, _agent);
            return phase == Agents.LiquidationPhase.CCB ? AgentStatusInfo.CCB : AgentStatusInfo.LIQUIDATION;
        } else if (status == Agents.AgentStatus.FULL_LIQUIDATION) {
            return AgentStatusInfo.FULL_LIQUIDATION;
        } else {
            assert (status == Agents.AgentStatus.DESTROYING);
            return AgentStatusInfo.DESTROYING;
        }
    }
    
    function _getCCBStartTime(
        Agents.Agent storage _agent
    )
        private view
        returns (uint256)
    {
        if (_agent.status != Agents.AgentStatus.LIQUIDATION) return 0;
        return _agent.initialLiquidationPhase == Agents.LiquidationPhase.CCB ? _agent.liquidationStartedAt : 0;
    }

    function _getLiquidationStartTime(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent
    )
        private view
        returns (uint256)
    {
        if (_agent.status == Agents.AgentStatus.LIQUIDATION) {
            return _agent.initialLiquidationPhase == Agents.LiquidationPhase.CCB
                ? _agent.liquidationStartedAt + _state.settings.ccbTimeSeconds
                : _agent.liquidationStartedAt;
        } else if (_agent.status == Agents.AgentStatus.FULL_LIQUIDATION) {
            return _agent.liquidationStartedAt;
        } else {
            return 0;
        }
    }
}
