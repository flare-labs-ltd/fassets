// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "../../utils/lib/SafeBips.sol";
import "./Agents.sol";
import "./AssetManagerSettings.sol";
import "./AssetManagerState.sol";
import "./Conversion.sol";
import "./Redemption.sol";
import "../interface/IAgentVault.sol";
import "./AgentCollateral.sol";


library Liquidation {
    using SafeMath for uint256;
    using SafeCast for uint256;
    using SafePct for uint256;
    using SafeBips for uint256;
    using SafeBips for uint64;
    using AgentCollateral for AgentCollateral.Data;
    
    // Start collateral ratio based agent's liquidation (Agents.AgentStatus.LIQUIDATION)
    function startLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        (uint256 collateralRatio,,) = _getCollateralRatio(_state, agent, _agentVault);
        _upgradeLiquidationPhase(_state, agent, _agentVault, collateralRatio);
    }

    // Liquidate agent's position.
    // Automatically starts / upgrades agent's liquidation status.
    function liquidate(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint256 _amountUBA
    )
        external
        returns (uint256)
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        (uint256 collateralRatio, uint256 amgToNATWeiPrice,) = _getCollateralRatio(_state, agent, _agentVault);
        // allow one-step liquidation (without calling startLiquidation first)
        Agents.LiquidationPhase currentPhase = _upgradeLiquidationPhase(_state, agent, _agentVault, collateralRatio);
        require(currentPhase == Agents.LiquidationPhase.LIQUIDATION, "not in liquidation");
        uint256 factorBIPS = _currentLiquidationFactorBIPS(_state, agent, collateralRatio);
        uint256 maxLiquidatedAMG = _maxLiquidationAmountAMG(_state, agent, collateralRatio, factorBIPS);
        uint64 amountToLiquidateAMG = 
            Math.min(maxLiquidatedAMG, Conversion.convertUBAToAmg(_state.settings, _amountUBA)).toUint64();
        uint64 liquidatedAmountAMG = Redemption.liquidate(_state, msg.sender, _agentVault, amountToLiquidateAMG);
        uint256 rewardNATWei = Conversion.convertAmgToNATWei(liquidatedAmountAMG.mulBips(factorBIPS), 
            amgToNATWeiPrice);
        Agents.payout(_state, _agentVault, msg.sender, rewardNATWei);
        uint256 liquidatedAmountUBA = Conversion.convertAmgToUBA(_state.settings, liquidatedAmountAMG);
        emit AMEvents.LiquidationPerformed(_agentVault, msg.sender, liquidatedAmountUBA);
        return liquidatedAmountUBA;
    }
    
    // Cancel liquidation, requires that agent is healthy.
    function cancelLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        endLiquidationIfHealthy(_state, agent, _agentVault);
        require(agent.status == Agents.AgentStatus.NORMAL, "cannot stop liquidation");
    }

    // Start full agent liquidation (Agents.AgentStatus.FULL_LIQUIDATION)
    function startFullLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        // if already in full liquidation or destroying, do nothing
        if (agent.status == Agents.AgentStatus.FULL_LIQUIDATION
            || agent.status == Agents.AgentStatus.DESTROYING) return;
        // if current phase is not LIQUIDATION, restart in LIQUIDATION phase
        Agents.LiquidationPhase currentPhase = _currentLiquidationPhase(_state, agent);
        if (currentPhase != Agents.LiquidationPhase.LIQUIDATION) {
            agent.liquidationStartedAt = SafeCast.toUint64(block.timestamp);
            agent.initialLiquidationPhase = Agents.LiquidationPhase.LIQUIDATION;
        }
        agent.status = Agents.AgentStatus.FULL_LIQUIDATION;
        emit AMEvents.LiquidationStarted(_agentVault, false, true);
    }

    // Cancel liquidation if the agent is healthy.
    function endLiquidationIfHealthy(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        endLiquidationIfHealthy(_state, agent, _agentVault);
    }
    
    // Cancel liquidation if the agent is healthy.
    function endLiquidationIfHealthy(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        address _agentVault
    )
        internal
    {
        // can only stop plain liquidation (full liquidation can only stop when there are no more minted assets)
        if (_agent.status != Agents.AgentStatus.LIQUIDATION) return;
        // agent's current collateral ratio
        (uint256 collateralRatioBIPS,,) = _getCollateralRatio(_state, _agent, _agentVault);
        // target collateral ratio is minCollateralRatio for CCB and safetyMinCollateralRatio for LIQUIDATION
        Agents.LiquidationPhase currentPhase = _currentLiquidationPhase(_state, _agent);
        uint256 targetRatioBIPS = currentPhase == Agents.LiquidationPhase.CCB
            ? _state.settings.minCollateralRatioBIPS : _state.settings.safetyMinCollateralRatioBIPS;
        // if agent is safe, restore status to NORMAL
        if (collateralRatioBIPS >= targetRatioBIPS) {
            _agent.status = Agents.AgentStatus.NORMAL;
            // TODO: are these two lines needed?
            _agent.liquidationStartedAt = 0;
            _agent.initialLiquidationPhase = Agents.LiquidationPhase.NONE;
            emit AMEvents.LiquidationCancelled(_agentVault);
        }
    }

    // Upgrade (CR-based) liquidation phase (NONE -> CCR -> LIQUIDATION), based on agent's collateral ratio.
    // When in full liquidation mode, do nothing.
    function _upgradeLiquidationPhase(
        AssetManagerState.State storage _state,
        Agents.Agent storage agent,
        address _agentVault,
        uint256 _collateralRatio
    )
        private
        returns (Agents.LiquidationPhase)
    {
        Agents.LiquidationPhase currentPhase = _currentLiquidationPhase(_state, agent);
        // if current phase is already LIQUIDATION, no upgrade is needed
        if (currentPhase == Agents.LiquidationPhase.LIQUIDATION || agent.status == Agents.AgentStatus.DESTROYING) {
            return currentPhase;
        }
        // restart liquidation (set new phase and start time) if new cr based phase is higher than time based
        Agents.LiquidationPhase newPhase = _initialLiquidationPhaseForCollateral(_state, _collateralRatio);
        if (currentPhase < newPhase) {
            agent.status = Agents.AgentStatus.LIQUIDATION;
            agent.liquidationStartedAt = SafeCast.toUint64(block.timestamp);
            agent.initialLiquidationPhase = newPhase;
            emit AMEvents.LiquidationStarted(_agentVault, newPhase == Agents.LiquidationPhase.CCB, false);
            return newPhase;
        }
        return currentPhase;
    }
    
    // Liquidation phase when starting liquidation (depends only on collateral ratio)
    function _initialLiquidationPhaseForCollateral(
        AssetManagerState.State storage _state,
        uint256 collateralRatio
    )
        private view
        returns (Agents.LiquidationPhase)
    {
        if (collateralRatio >= _state.settings.minCollateralRatioBIPS) {
            return Agents.LiquidationPhase.NONE;
        } else if (collateralRatio >= _state.settings.ccbMinCollateralRatioBIPS) {
            return Agents.LiquidationPhase.CCB;
        } else {
            return Agents.LiquidationPhase.LIQUIDATION;
        }
    }
    
    // Current liquidation phase (assumed that liquidation was started in some previous transaction,
    // so the result only depends on time, not on current collateral ratio)
    function _currentLiquidationPhase(
        AssetManagerState.State storage _state,
        Agents.Agent storage agent
    )
        private view
        returns (Agents.LiquidationPhase)
    {
        Agents.AgentStatus status = agent.status;
        if (status == Agents.AgentStatus.LIQUIDATION) {
            bool inCCB = agent.initialLiquidationPhase == Agents.LiquidationPhase.CCB
                && block.timestamp <= agent.liquidationStartedAt + _state.settings.ccbTimeSeconds;
            return inCCB ? Agents.LiquidationPhase.CCB : Agents.LiquidationPhase.LIQUIDATION;
        } else if (status == Agents.AgentStatus.FULL_LIQUIDATION) {
            return Agents.LiquidationPhase.LIQUIDATION;
        } else {    // any other status - NORMAL or DESTROYING
            return Agents.LiquidationPhase.NONE;
        }
    }

    // Liquidation premium step (depends on time, but is capped by the current collateral ratio)
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function _currentLiquidationFactorBIPS(
        AssetManagerState.State storage _state,
        Agents.Agent storage agent,
        uint256 _collateralRatioBIPS
    )
        private view
        returns (uint256)
    {
        // calculate premium step based on time since liquidation started
        bool startedInCCB = agent.status == Agents.AgentStatus.LIQUIDATION 
            && agent.initialLiquidationPhase == Agents.LiquidationPhase.CCB;
        uint256 ccbTime = startedInCCB ? _state.settings.ccbTimeSeconds : 0;
        uint256 liquidationStart = agent.liquidationStartedAt + ccbTime;
        uint256 step = Math.min(_state.settings.liquidationCollateralFactorBIPS.length - 1,
            (block.timestamp - liquidationStart) / _state.settings.liquidationStepSeconds);
        // premiums are expressed as percentage of minCollateralRatio
        uint256 factorBIPS = uint256(_state.settings.liquidationCollateralFactorBIPS[step]);
        // max premium is equal to agents collateral ratio (so that all liquidators get at least this much)
        return Math.min(factorBIPS, _collateralRatioBIPS);
    }

    // Calculate the amount of liquidation that gets agent to safety.
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function _maxLiquidationAmountAMG(
        AssetManagerState.State storage _state,
        Agents.Agent storage agent,
        uint256 _collateralRatioBIPS,
        uint256 factorBIPS
    )
        private view
        returns (uint256)
    {
        // for full liquidation, all minted amount can be liquidated
        if (agent.status == Agents.AgentStatus.FULL_LIQUIDATION) {
            return agent.mintedAMG;
        }
        // otherwise, liquidate just enough to get agent to safety
        uint256 targetRatioBIPS = _state.settings.safetyMinCollateralRatioBIPS;
        if (targetRatioBIPS <= _collateralRatioBIPS) {
            return 0;               // agent already safe
        }
        // actually, we always have factorBIPS <= _collateralRatioBIPS (< targetRatioBIPS)
        // so this is just an extra precaution
        if (targetRatioBIPS <= factorBIPS) {
            return agent.mintedAMG; // cannot achieve target - liquidate all
        }
        uint256 maxLiquidatedAMG = uint256(agent.mintedAMG)
            .mulDiv(targetRatioBIPS - _collateralRatioBIPS, targetRatioBIPS - factorBIPS) + 1;  // ~ round up
        // TODO: should we round up maxLiquidationAmount to whole lots (of course cap by mintedAMG after rounding)?
        return Math.min(maxLiquidatedAMG, agent.mintedAMG);
    }
    
    // The collateral ratio for deciding whether agent is in liquidation or CCB is the maximum
    // of the ratio calculated from FTSO price and the ratio calculated from trusted voters' price.
    // In this way, liquidation due to bad FTSO providers bunching together is less likely.
    function _getCollateralRatio(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        address _agentVault
    )
        private view
        returns (uint256 _collateralRatio, uint256 _amgToNATWeiPrice, uint256 _amgToNATWeiPriceTrusted)
    {
        uint256 fullCollateral = Agents.fullCollateral(_state, _agentVault);
        (_amgToNATWeiPrice, _amgToNATWeiPriceTrusted) = 
            Conversion.currentAmgToNATWeiPriceWithTrusted(_state.settings);
        uint256 ratio = 
            AgentCollateral.collateralRatio(_agent, _state.settings, fullCollateral, _amgToNATWeiPrice);
        uint256 ratioTrusted = 
            AgentCollateral.collateralRatio(_agent, _state.settings, fullCollateral, _amgToNATWeiPriceTrusted);
        _collateralRatio = Math.max(ratio, ratioTrusted);
    }
}
