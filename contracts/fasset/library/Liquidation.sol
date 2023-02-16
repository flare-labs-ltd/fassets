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
        // if already in full liquidation or destroying, do nothing
        if (agent.status == Agents.AgentStatus.FULL_LIQUIDATION
            || agent.status == Agents.AgentStatus.DESTROYING) return;
        (uint256 class1CR,) = getCollateralRatioBIPS(_state, agent, _agentVault, AgentCollateral.Kind.AGENT_CLASS1);
        (uint256 poolCR,) = getCollateralRatioBIPS(_state, agent, _agentVault, AgentCollateral.Kind.POOL);
        _upgradeLiquidationPhase(_state, agent, _agentVault, class1CR, poolCR);
    }

    // Liquidate agent's position.
    // Automatically starts / upgrades agent's liquidation status.
    function liquidate(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint256 _amountUBA
    )
        external
        returns (uint256 _liquidatedAmountUBA, uint256 _amountPaidC1, uint256 _amountPaidPool)
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        // agent in status DESTROYING cannot be backing anything, so there can be no liquidation
        if (agent.status == Agents.AgentStatus.DESTROYING) return (0, 0, 0);
        // calculate both CRs
        (uint256 class1CR, uint256 amgToC1WeiPrice) = 
            getCollateralRatioBIPS(_state, agent, _agentVault, AgentCollateral.Kind.AGENT_CLASS1);
        (uint256 poolCR, uint256 amgToPoolWeiPrice) = 
            getCollateralRatioBIPS(_state, agent, _agentVault, AgentCollateral.Kind.POOL);
        // allow one-step liquidation (without calling startLiquidation first)
        Agents.LiquidationPhase currentPhase =
            _upgradeLiquidationPhase(_state, agent, _agentVault, class1CR, poolCR);
        require(currentPhase == Agents.LiquidationPhase.LIQUIDATION, "not in liquidation");
        // calculate liquidation amount
        (uint256 class1FactorBIPS, uint256 poolFactorBIPS) =
            _currentLiquidationFactorBIPS(_state, agent, class1CR, poolCR);
        uint256 maxLiquidatedAMG = Math.max(
            _maxLiquidationAmountAMG(_state, agent, class1CR, class1FactorBIPS, agent.collateralTokenC1),
            _maxLiquidationAmountAMG(_state, agent, poolCR, poolFactorBIPS, CollateralToken.POOL));
        uint64 amountToLiquidateAMG = 
            Math.min(maxLiquidatedAMG, Conversion.convertUBAToAmg(_state.settings, _amountUBA)).toUint64();
        // liquidate redemption tickets
        (uint64 liquidatedAmountAMG,) = Redemption.selfCloseOrLiquidate(_state, _agentVault, amountToLiquidateAMG);
        // pay the liquidator (class1)
        if (class1FactorBIPS > 0) {
            uint256 rewardC1Wei = Conversion.convertAmgToTokenWei(liquidatedAmountAMG.mulBips(class1FactorBIPS), 
                amgToC1WeiPrice);
            _amountPaidC1 = Agents.payoutClass1(_state, agent, _agentVault, msg.sender, rewardC1Wei);
        }
        // pay the liquidator (from pool)
        if (poolFactorBIPS > 0) {
            uint256 rewardPoolWei = Conversion.convertAmgToTokenWei(liquidatedAmountAMG.mulBips(poolFactorBIPS), 
                amgToPoolWeiPrice);
            _amountPaidPool = Agents.payoutFromPool(_state, agent, msg.sender, rewardPoolWei, 
                _agentResponsibilityWei(agent, rewardPoolWei));
        }
        // try to pull agent out of liquidation
        _endLiquidationIfHealthy(_state, agent, _agentVault);
        // burn liquidated fassets
        _liquidatedAmountUBA = Conversion.convertAmgToUBA(_state.settings, liquidatedAmountAMG);
        _state.settings.fAsset.burn(msg.sender, _liquidatedAmountUBA);
        // notify about liquidation
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
        Agents.LiquidationPhase currentPhase = _timeBasedLiquidationPhase(_state, agent);
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
    
    // For use in FullAgentInfo.
    function currentLiquidationPhase(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        address _agentVault
    )
        internal view
        returns (Agents.LiquidationPhase)
    {
        Agents.LiquidationPhase currentPhase = _timeBasedLiquidationPhase(_state, _agent);
        if (currentPhase != Agents.LiquidationPhase.CCB) return currentPhase;
        // For CCB we must also check if the CR has dropped below CCB-CR.
        // Note that we don't need to check this for phase=NORMAL, because in that case the liquidation must
        // still be triggered via startLiquidation() or liquidate().
        (uint256 class1CR,) = getCollateralRatioBIPS(_state, _agent, _agentVault, AgentCollateral.Kind.AGENT_CLASS1);
        (uint256 poolCR,) = getCollateralRatioBIPS(_state, _agent, _agentVault, AgentCollateral.Kind.POOL);
        Agents.LiquidationPhase newPhaseC1 = 
            _initialLiquidationPhaseForCollateral(_state, class1CR, _agent.collateralTokenC1);
        Agents.LiquidationPhase newPhasePool = 
            _initialLiquidationPhaseForCollateral(_state, poolCR, CollateralToken.POOL);
        Agents.LiquidationPhase newPhase = newPhaseC1 >= newPhasePool ? newPhaseC1 : newPhasePool;
        return newPhase > currentPhase ? newPhase : currentPhase;
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
        (uint256 class1CR,) = getCollateralRatioBIPS(_state, _agent, _agentVault, AgentCollateral.Kind.AGENT_CLASS1);
        (uint256 poolCR,) = getCollateralRatioBIPS(_state, _agent, _agentVault, AgentCollateral.Kind.POOL);
        // target collateral ratio is minCollateralRatioBIPS for CCB and safetyMinCollateralRatioBIPS for LIQUIDATION
        Agents.LiquidationPhase currentPhase = _timeBasedLiquidationPhase(_state, _agent);
        uint256 targetRatioClass1BIPS = _targetRatioBIPS(_state, currentPhase, _agent.collateralTokenC1,
            (_agent.collateralsUnderwater & Agents.LF_CLASS1) != 0);
        uint256 targetRatioPoolBIPS = _targetRatioBIPS(_state, currentPhase, CollateralToken.POOL,
            (_agent.collateralsUnderwater & Agents.LF_POOL) != 0);
        // if agent is safe, restore status to NORMAL
        if (class1CR >= targetRatioClass1BIPS && poolCR >= targetRatioPoolBIPS) {
            _agent.status = Agents.AgentStatus.NORMAL;
            _agent.liquidationStartedAt = 0;
            _agent.initialLiquidationPhase = Agents.LiquidationPhase.NONE;
            _agent.collateralsUnderwater = 0;
            emit AMEvents.LiquidationEnded(_agentVault);
        }
    }
    
    function _targetRatioBIPS(
        AssetManagerState.State storage _state,
        Agents.LiquidationPhase _currentPhase,
        uint256 _collateralIndex,
        bool _collateralTypeUnderwater
    )
        private view
        returns (uint256)
    {
        CollateralToken.Token storage collateral = _state.collateralTokens[_collateralIndex];
        if (_currentPhase == Agents.LiquidationPhase.CCB || !_collateralTypeUnderwater) {
            return collateral.minCollateralRatioBIPS;
        } else {
            return collateral.safetyMinCollateralRatioBIPS;
        }
    }

    // Upgrade (CR-based) liquidation phase (NONE -> CCR -> LIQUIDATION), based on agent's collateral ratio.
    // When in full liquidation mode, do nothing.
    function _upgradeLiquidationPhase(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        address _agentVault,
        uint256 _class1CR,
        uint256 _poolCR
    )
        private
        returns (Agents.LiquidationPhase)
    {
        Agents.LiquidationPhase currentPhase = _timeBasedLiquidationPhase(_state, _agent);
        // calculate new phase for both collaterals and if any is underwater, set its flag
        Agents.LiquidationPhase newPhaseC1 = 
            _initialLiquidationPhaseForCollateral(_state, _class1CR, _agent.collateralTokenC1);
        if (newPhaseC1 == Agents.LiquidationPhase.LIQUIDATION) {
            _agent.collateralsUnderwater |= Agents.LF_CLASS1;
        }
        Agents.LiquidationPhase newPhasePool = 
            _initialLiquidationPhaseForCollateral(_state, _poolCR, CollateralToken.POOL);
        if (newPhasePool == Agents.LiquidationPhase.LIQUIDATION) {
            _agent.collateralsUnderwater |= Agents.LF_POOL;
        }
        // restart liquidation (set new phase and start time) if new cr based phase is higher than time based
        Agents.LiquidationPhase newPhase = newPhaseC1 >= newPhasePool ? newPhaseC1 : newPhasePool;
        if (newPhase > currentPhase) {
            _agent.status = Agents.AgentStatus.LIQUIDATION;
            _agent.liquidationStartedAt = SafeCast.toUint64(block.timestamp);
            _agent.initialLiquidationPhase = newPhase;
            _agent.collateralsUnderwater =
                (newPhase == newPhaseC1 ? Agents.LF_CLASS1 : 0) | (newPhase == newPhasePool ? Agents.LF_POOL : 0);
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
        uint256 _collateralRatioBIPS,
        uint256 _collateralIndex
    )
        private view
        returns (Agents.LiquidationPhase)
    {
        CollateralToken.Token storage collateral = _state.collateralTokens[_collateralIndex];
        if (_collateralRatioBIPS >= collateral.minCollateralRatioBIPS) {
            return Agents.LiquidationPhase.NONE;
        } else if (_collateralRatioBIPS >= collateral.ccbMinCollateralRatioBIPS) {
            return Agents.LiquidationPhase.CCB;
        } else {
            return Agents.LiquidationPhase.LIQUIDATION;
        }
    }
    
    // Current liquidation phase (assumed that liquidation/ccb was started in some past transaction,
    // so the result only depends on time, not on current collateral ratio).
    // Beware: the result here can be CCB even if it should be LIQUIDATION because CR dropped.
    function _timeBasedLiquidationPhase(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent
    )
        private view
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

    // Liquidation premium step (depends on time since CCB or liquidation was started)
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function _currentLiquidationStep(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent
    )
        private view
        returns (uint256)
    {
        // calculate premium step based on time since liquidation started
        bool startedInCCB = _agent.status == Agents.AgentStatus.LIQUIDATION 
            && _agent.initialLiquidationPhase == Agents.LiquidationPhase.CCB;
        uint256 ccbTime = startedInCCB ? _state.settings.ccbTimeSeconds : 0;
        uint256 liquidationStart = _agent.liquidationStartedAt + ccbTime;
        uint256 step = (block.timestamp - liquidationStart) / _state.settings.liquidationStepSeconds;
        return Math.min(step, _state.settings.liquidationCollateralFactorBIPS.length - 1);
    }


    // Liquidation premium step (depends on time, but is capped by the current collateral ratio)
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function _currentLiquidationFactorBIPS(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        uint256 _class1CR,
        uint256 _poolCR
    )
        private view
        returns (uint256 _c1FactorBIPS, uint256 _poolFactorBIPS)
    {
        uint256 step = _currentLiquidationStep(_state, _agent);
        uint256 factorBIPS = _state.settings.liquidationCollateralFactorBIPS[step];
        // All premiums are expressed as factor BIPS.
        // Current algorithm for splitting payment: use liquidationCollateralFactorBIPS for class1 and
        // pay the rest from pool. If any factor exceeeds the CR of that collateral, pay that collateral at
        // its CR and pay more of the other. If both collaterals exceed CR, limit both to their CRs.
        _c1FactorBIPS = Math.min(_state.settings.liquidationFactorClass1BIPS, factorBIPS);
        if (_c1FactorBIPS > _class1CR) {
            _c1FactorBIPS = _class1CR;
        }
        _poolFactorBIPS = factorBIPS - _c1FactorBIPS;
        if (_poolFactorBIPS > _poolCR) {
            _poolFactorBIPS = _poolCR;
            _c1FactorBIPS = Math.min(factorBIPS - _poolFactorBIPS, _class1CR);
        }
    }

    // Calculate the amount of liquidation that gets agent to safety.
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function _maxLiquidationAmountAMG(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        uint256 _collateralRatioBIPS,
        uint256 _factorBIPS,
        uint256 _collateralIndex
    )
        private view
        returns (uint256)
    {
        // for full liquidation, all minted amount can be liquidated
        if (_agent.status == Agents.AgentStatus.FULL_LIQUIDATION) {
            return _agent.mintedAMG;
        }
        // otherwise, liquidate just enough to get agent to safety
        CollateralToken.Token storage collateral = _state.collateralTokens[_collateralIndex];
        uint256 targetRatioBIPS = collateral.safetyMinCollateralRatioBIPS;
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
    
    // Share of amount paid by pool that is the fault of the agent
    // (affects how many of the agent's pool tokens will be slashed).
    function _agentResponsibilityWei(Agents.Agent storage _agent, uint256 _amount) private view returns (uint256) {
        if (_agent.status == Agents.AgentStatus.FULL_LIQUIDATION || _agent.collateralsUnderwater == Agents.LF_CLASS1) {
            return _amount;
        } else if (_agent.collateralsUnderwater == Agents.LF_POOL) {
            return 0;
        } else {    // both collaterals were underwater - only half responisibility assigned to agent
            return _amount / 2;
        }
    }
    
    // The collateral ratio (BIPS) for deciding whether agent is in liquidation or CCB is the maximum
    // of the ratio calculated from FTSO price and the ratio calculated from trusted voters' price.
    // In this way, liquidation due to bad FTSO providers bunching together is less likely.
    function getCollateralRatioBIPS(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        address _agentVault,
        AgentCollateral.Kind _collateralKind
    )
        internal view
        returns (uint256 _collateralRatioBIPS, uint256 _amgToTokenWeiPrice)
    {
        (uint256 fullCollateral, uint256 amgToTokenWeiPrice, uint256 amgToTokenWeiPriceTrusted) =
            AgentCollateral.collateralDataWithTrusted(_state, _agent, _agentVault, _collateralKind);
        uint256 ratio = AgentCollateral.collateralRatioBIPS(_agent, fullCollateral, amgToTokenWeiPrice);
        uint256 ratioTrusted = AgentCollateral.collateralRatioBIPS(_agent, fullCollateral, amgToTokenWeiPriceTrusted);
        _amgToTokenWeiPrice = amgToTokenWeiPrice;
        _collateralRatioBIPS = Math.max(ratio, ratioTrusted);
    }
}
