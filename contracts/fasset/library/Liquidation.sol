// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "../../utils/lib/SafeBips.sol";
import "../../utils/lib/MathUtils.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./AssetManagerState.sol";
import "./Conversion.sol";
import "./Redemption.sol";
import "./AgentCollateral.sol";


library Liquidation {
    using SafeMath for uint256;
    using SafeCast for uint256;
    using MathUtils for uint256;
    using SafePct for uint256;
    using SafeBips for uint256;
    using SafeBips for uint64;
    
    // Start collateral ratio based agent's liquidation (Agents.AgentStatus.LIQUIDATION)
    function startLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        (uint256 collateralRatioBIPS,,) = getCollateralRatioBIPS(_state, agent, _agentVault);
        _upgradeLiquidationPhase(_state, agent, _agentVault, collateralRatioBIPS);
    }

    // Liquidate agent's position.
    // Automatically starts / upgrades agent's liquidation status.
    function liquidate(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint256 _amountUBA
    )
        external
        returns (uint256 _liquidatedAmountUBA, uint256 _amountPaid)
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        (uint256 collateralRatioBIPS, uint256 amgToNATWeiPrice,) = getCollateralRatioBIPS(_state, agent, _agentVault);
        // allow one-step liquidation (without calling startLiquidation first)
        Agents.LiquidationPhase currentPhase =
            _upgradeLiquidationPhase(_state, agent, _agentVault, collateralRatioBIPS);
        require(currentPhase == Agents.LiquidationPhase.LIQUIDATION, "not in liquidation");
        // calculate liquidation amount
        uint256 factorBIPS = _currentLiquidationFactorBIPS(_state, agent, collateralRatioBIPS);
        uint256 maxLiquidatedAMG = _maxLiquidationAmountAMG(_state, agent, collateralRatioBIPS, factorBIPS);
        uint64 amountToLiquidateAMG = 
            Math.min(maxLiquidatedAMG, Conversion.convertUBAToAmg(_state.settings, _amountUBA)).toUint64();
        // liquidate redemption tickets
        (uint64 liquidatedAmountAMG,) = Redemption.selfCloseOrLiquidate(_state, _agentVault, amountToLiquidateAMG);
        // pay the liquidator
        uint256 rewardNATWei = Conversion.convertAmgToNATWei(liquidatedAmountAMG.mulBips(factorBIPS), 
            amgToNATWeiPrice);
        _amountPaid = Agents.payout(_state, _agentVault, msg.sender, rewardNATWei);
        // try to pull agent out of liquidation
        _endLiquidationIfHealthy(_state, agent, _agentVault);
        // notify about liquidation
        _liquidatedAmountUBA = Conversion.convertAmgToUBA(_state.settings, liquidatedAmountAMG);
        emit AMEvents.LiquidationPerformed(_agentVault, msg.sender, _liquidatedAmountUBA);
    }
    
    // Cancel liquidation, requires that agent is healthy.
    function endLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        _endLiquidationIfHealthy(_state, agent, _agentVault);
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
        Agents.LiquidationPhase currentPhase = currentLiquidationPhase(_state, agent);
        if (currentPhase != Agents.LiquidationPhase.LIQUIDATION) {
            agent.liquidationStartedAt = SafeCast.toUint64(block.timestamp);
            agent.initialLiquidationPhase = Agents.LiquidationPhase.LIQUIDATION;
        }
        agent.status = Agents.AgentStatus.FULL_LIQUIDATION;
        emit AMEvents.FullLiquidationStarted(_agentVault, block.timestamp);
    }

    // Cancel liquidation if the agent is healthy.
    function endLiquidationIfHealthy(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        _endLiquidationIfHealthy(_state, agent, _agentVault);
    }
    
    // Cancel liquidation if the agent is healthy.
    function _endLiquidationIfHealthy(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        address _agentVault
    )
        private
    {
        // can only stop plain liquidation (full liquidation can only stop when there are no more minted assets)
        if (_agent.status != Agents.AgentStatus.LIQUIDATION) return;
        // agent's current collateral ratio
        (uint256 collateralRatioBIPS,,) = getCollateralRatioBIPS(_state, _agent, _agentVault);
        // target collateral ratio is minCollateralRatioBIPS for CCB and safetyMinCollateralRatioBIPS for LIQUIDATION
        Agents.LiquidationPhase currentPhase = currentLiquidationPhase(_state, _agent);
        uint256 targetRatioBIPS = currentPhase == Agents.LiquidationPhase.CCB
            ? _state.settings.minCollateralRatioBIPS : _state.settings.safetyMinCollateralRatioBIPS;
        // if agent is safe, restore status to NORMAL
        if (collateralRatioBIPS >= targetRatioBIPS) {
            _agent.status = Agents.AgentStatus.NORMAL;
            _agent.liquidationStartedAt = 0;
            _agent.initialLiquidationPhase = Agents.LiquidationPhase.NONE;
            emit AMEvents.LiquidationEnded(_agentVault);
        }
    }

    // Upgrade (CR-based) liquidation phase (NONE -> CCR -> LIQUIDATION), based on agent's collateral ratio.
    // When in full liquidation mode, do nothing.
    function _upgradeLiquidationPhase(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        address _agentVault,
        uint256 _collateralRatioBIPS
    )
        private
        returns (Agents.LiquidationPhase)
    {
        Agents.LiquidationPhase currentPhase = currentLiquidationPhase(_state, _agent);
        // if current phase is already LIQUIDATION, no upgrade is needed
        if (currentPhase == Agents.LiquidationPhase.LIQUIDATION || _agent.status == Agents.AgentStatus.DESTROYING) {
            return currentPhase;
        }
        // restart liquidation (set new phase and start time) if new cr based phase is higher than time based
        Agents.LiquidationPhase newPhase = _initialLiquidationPhaseForCollateral(_state, _collateralRatioBIPS);
        if (currentPhase < newPhase) {
            _agent.status = Agents.AgentStatus.LIQUIDATION;
            _agent.liquidationStartedAt = SafeCast.toUint64(block.timestamp);
            _agent.initialLiquidationPhase = newPhase;
            if (newPhase == Agents.LiquidationPhase.CCB) {
                emit AMEvents.AgentInCCB(_agentVault, block.timestamp);
            } else {
                emit AMEvents.LiquidationStarted(_agentVault, block.timestamp);
            }
            return newPhase;
        }
        return currentPhase;
    }
    
    // Liquidation phase when starting liquidation (depends only on collateral ratio)
    function _initialLiquidationPhaseForCollateral(
        AssetManagerState.State storage _state,
        uint256 _collateralRatioBIPS
    )
        private view
        returns (Agents.LiquidationPhase)
    {
        if (_collateralRatioBIPS >= _state.settings.minCollateralRatioBIPS) {
            return Agents.LiquidationPhase.NONE;
        } else if (_collateralRatioBIPS >= _state.settings.ccbMinCollateralRatioBIPS) {
            return Agents.LiquidationPhase.CCB;
        } else {
            return Agents.LiquidationPhase.LIQUIDATION;
        }
    }
    
    // Current liquidation phase (assumed that liquidation was started in some previous transaction,
    // so the result only depends on time, not on current collateral ratio)
    function currentLiquidationPhase(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent
    )
        internal view
        returns (Agents.LiquidationPhase)
    {
        Agents.AgentStatus status = _agent.status;
        if (status == Agents.AgentStatus.LIQUIDATION) {
            bool inCCB = _agent.initialLiquidationPhase == Agents.LiquidationPhase.CCB
                && block.timestamp <= _agent.liquidationStartedAt + _state.settings.ccbTimeSeconds;
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
        Agents.Agent storage _agent,
        uint256 _collateralRatioBIPS
    )
        private view
        returns (uint256)
    {
        // calculate premium step based on time since liquidation started
        bool startedInCCB = _agent.status == Agents.AgentStatus.LIQUIDATION 
            && _agent.initialLiquidationPhase == Agents.LiquidationPhase.CCB;
        uint256 ccbTime = startedInCCB ? _state.settings.ccbTimeSeconds : 0;
        uint256 liquidationStart = _agent.liquidationStartedAt + ccbTime;
        uint256 step = Math.min(_state.settings.liquidationCollateralFactorBIPS.length - 1,
            (block.timestamp - liquidationStart) / _state.settings.liquidationStepSeconds);
        // premiums are expressed as factor BIPS (> 10000)
        uint256 factorBIPS = uint256(_state.settings.liquidationCollateralFactorBIPS[step]);
        // max premium is equal to agents collateral ratio (so that all liquidators get at least this much)
        return Math.min(factorBIPS, _collateralRatioBIPS);
    }

    // Calculate the amount of liquidation that gets agent to safety.
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function _maxLiquidationAmountAMG(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        uint256 _collateralRatioBIPS,
        uint256 _factorBIPS
    )
        private view
        returns (uint256)
    {
        // for full liquidation, all minted amount can be liquidated
        if (_agent.status == Agents.AgentStatus.FULL_LIQUIDATION) {
            return _agent.mintedAMG;
        }
        // otherwise, liquidate just enough to get agent to safety
        uint256 targetRatioBIPS = _state.settings.safetyMinCollateralRatioBIPS;
        if (targetRatioBIPS <= _collateralRatioBIPS) {
            return 0;               // agent already safe
        }
        if (_collateralRatioBIPS <= _factorBIPS) {
            return _agent.mintedAMG; // cannot achieve target - liquidate all
        }
        uint256 maxLiquidatedAMG = uint256(_agent.mintedAMG)
            .mulDivRoundUp(targetRatioBIPS - _collateralRatioBIPS, targetRatioBIPS - _factorBIPS);
        // round up to whole number of lots
        maxLiquidatedAMG = maxLiquidatedAMG.roundUp(_state.settings.lotSizeAMG);
        return Math.min(maxLiquidatedAMG, _agent.mintedAMG);
    }
    
    // The collateral ratio (BIPS) for deciding whether agent is in liquidation or CCB is the maximum
    // of the ratio calculated from FTSO price and the ratio calculated from trusted voters' price.
    // In this way, liquidation due to bad FTSO providers bunching together is less likely.
    function getCollateralRatioBIPS(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        address _agentVault
    )
        internal view
        returns (uint256 _collateralRatioBIPS, uint256 _amgToNATWeiPrice, uint256 _amgToNATWeiPriceTrusted)
    {
        uint256 fullCollateral = Agents.fullCollateral(_state, _agentVault);
        (_amgToNATWeiPrice, _amgToNATWeiPriceTrusted) = 
            Conversion.currentAmgToNATWeiPriceWithTrusted(_state.settings);
        uint256 ratio = 
            AgentCollateral.collateralRatioBIPS(_agent, _state.settings, fullCollateral, _amgToNATWeiPrice);
        uint256 ratioTrusted = 
            AgentCollateral.collateralRatioBIPS(_agent, _state.settings, fullCollateral, _amgToNATWeiPriceTrusted);
        _collateralRatioBIPS = Math.max(ratio, ratioTrusted);
    }
}
