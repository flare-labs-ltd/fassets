// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "../../utils/lib/SafeBips.sol";
import "../../utils/lib/MathUtils.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./Conversion.sol";
import "./Redemptions.sol";
import "./AgentCollateral.sol";


library Liquidation {
    using SafeMath for uint256;
    using SafeCast for uint256;
    using MathUtils for uint256;
    using SafePct for uint256;
    using SafeBips for uint256;
    using SafeBips for uint64;
    
    // Start collateral ratio based agent's liquidation (Agent.Status.LIQUIDATION)
    function startLiquidation(
        address _agentVault
    )
        external
    {
        Agent.State storage agent = Agent.get(_agentVault);
        // if already in full liquidation or destroying, do nothing
        if (agent.status == Agent.Status.FULL_LIQUIDATION
            || agent.status == Agent.Status.DESTROYING) return;
        (uint256 class1CR,) = getCollateralRatioBIPS(agent, _agentVault, Collateral.Kind.AGENT_CLASS1);
        (uint256 poolCR,) = getCollateralRatioBIPS(agent, _agentVault, Collateral.Kind.POOL);
        _upgradeLiquidationPhase(agent, _agentVault, class1CR, poolCR);
    }

    // Liquidate agent's position.
    // Automatically starts / upgrades agent's liquidation status.
    function liquidate(
        address _agentVault,
        uint256 _amountUBA
    )
        external
        returns (uint256 _liquidatedAmountUBA, uint256 _amountPaidC1, uint256 _amountPaidPool)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        // agent in status DESTROYING cannot be backing anything, so there can be no liquidation
        if (agent.status == Agent.Status.DESTROYING) return (0, 0, 0);
        // calculate both CRs
        (uint256 class1CR, uint256 amgToC1WeiPrice) = 
            getCollateralRatioBIPS(agent, _agentVault, Collateral.Kind.AGENT_CLASS1);
        (uint256 poolCR, uint256 amgToPoolWeiPrice) = 
            getCollateralRatioBIPS(agent, _agentVault, Collateral.Kind.POOL);
        // allow one-step liquidation (without calling startLiquidation first)
        Agent.LiquidationPhase currentPhase =
            _upgradeLiquidationPhase(agent, _agentVault, class1CR, poolCR);
        require(currentPhase == Agent.LiquidationPhase.LIQUIDATION, "not in liquidation");
        // calculate liquidation amount
        (uint256 class1FactorBIPS, uint256 poolFactorBIPS) =
            _currentLiquidationFactorBIPS(agent, class1CR, poolCR);
        uint256 maxLiquidatedAMG = Math.max(
            _maxLiquidationAmountAMG(agent, class1CR, class1FactorBIPS, agent.collateralTokenC1),
            _maxLiquidationAmountAMG(agent, poolCR, poolFactorBIPS, CollateralToken.POOL));
        uint64 amountToLiquidateAMG = 
            Math.min(maxLiquidatedAMG, Conversion.convertUBAToAmg(_amountUBA)).toUint64();
        // liquidate redemption tickets
        (uint64 liquidatedAmountAMG,) = Redemptions.selfCloseOrLiquidate(_agentVault, amountToLiquidateAMG);
        // pay the liquidator (class1)
        if (class1FactorBIPS > 0) {
            uint256 rewardC1Wei = Conversion.convertAmgToTokenWei(liquidatedAmountAMG.mulBips(class1FactorBIPS), 
                amgToC1WeiPrice);
            _amountPaidC1 = Agents.payoutClass1(agent, _agentVault, msg.sender, rewardC1Wei);
        }
        // pay the liquidator (from pool)
        if (poolFactorBIPS > 0) {
            uint256 rewardPoolWei = 
                Conversion.convertAmgToTokenWei(liquidatedAmountAMG.mulBips(poolFactorBIPS), amgToPoolWeiPrice);
            _amountPaidPool = Agents.payoutFromPool(agent, msg.sender, rewardPoolWei, 
                _agentResponsibilityWei(agent, rewardPoolWei));
        }
        // try to pull agent out of liquidation
        _endLiquidationIfHealthy(agent, _agentVault);
        // burn liquidated fassets
        _liquidatedAmountUBA = Conversion.convertAmgToUBA(liquidatedAmountAMG);
        AssetManagerState.getSettings().fAsset.burn(msg.sender, _liquidatedAmountUBA);
        // notify about liquidation
        emit AMEvents.LiquidationPerformed(_agentVault, msg.sender, _liquidatedAmountUBA);
    }
    
    // Cancel liquidation, requires that agent is healthy.
    function endLiquidation(
        address _agentVault
    )
        external
    {
        Agent.State storage agent = Agent.get(_agentVault);
        _endLiquidationIfHealthy(agent, _agentVault);
        require(agent.status == Agent.Status.NORMAL, "cannot stop liquidation");
    }

    // Start full agent liquidation (Agent.Status.FULL_LIQUIDATION)
    function startFullLiquidation(
        address _agentVault
    )
        internal
    {
        Agent.State storage agent = Agent.get(_agentVault);
        // if already in full liquidation or destroying, do nothing
        if (agent.status == Agent.Status.FULL_LIQUIDATION
            || agent.status == Agent.Status.DESTROYING) return;
        // if current phase is not LIQUIDATION, restart in LIQUIDATION phase
        Agent.LiquidationPhase currentPhase = _timeBasedLiquidationPhase(agent);
        if (currentPhase != Agent.LiquidationPhase.LIQUIDATION) {
            agent.liquidationStartedAt = block.timestamp.toUint64();
            agent.initialLiquidationPhase = Agent.LiquidationPhase.LIQUIDATION;
        }
        agent.status = Agent.Status.FULL_LIQUIDATION;
        emit AMEvents.FullLiquidationStarted(_agentVault, block.timestamp);
    }

    // Cancel liquidation if the agent is healthy.
    function endLiquidationIfHealthy(
        address _agentVault
    )
        internal
    {
        Agent.State storage agent = Agent.get(_agentVault);
        _endLiquidationIfHealthy(agent, _agentVault);
    }
    
    // For use in FullAgentInfo.
    function currentLiquidationPhase(
        Agent.State storage _agent,
        address _agentVault
    )
        internal view
        returns (Agent.LiquidationPhase)
    {
        Agent.LiquidationPhase currentPhase = _timeBasedLiquidationPhase(_agent);
        if (currentPhase != Agent.LiquidationPhase.CCB) return currentPhase;
        // For CCB we must also check if the CR has dropped below CCB-CR.
        // Note that we don't need to check this for phase=NORMAL, because in that case the liquidation must
        // still be triggered via startLiquidation() or liquidate().
        (uint256 class1CR,) = getCollateralRatioBIPS(_agent, _agentVault, Collateral.Kind.AGENT_CLASS1);
        (uint256 poolCR,) = getCollateralRatioBIPS(_agent, _agentVault, Collateral.Kind.POOL);
        Agent.LiquidationPhase newPhaseC1 = 
            _initialLiquidationPhaseForCollateral(class1CR, _agent.collateralTokenC1);
        Agent.LiquidationPhase newPhasePool = 
            _initialLiquidationPhaseForCollateral(poolCR, CollateralToken.POOL);
        Agent.LiquidationPhase newPhase = newPhaseC1 >= newPhasePool ? newPhaseC1 : newPhasePool;
        return newPhase > currentPhase ? newPhase : currentPhase;
    }
    
    // Cancel liquidation if the agent is healthy.
    function _endLiquidationIfHealthy(
        Agent.State storage _agent,
        address _agentVault
    )
        private
    {
        // can only stop plain liquidation (full liquidation can only stop when there are no more minted assets)
        if (_agent.status != Agent.Status.LIQUIDATION) return;
        // agent's current collateral ratio
        (uint256 class1CR,) = getCollateralRatioBIPS(_agent, _agentVault, Collateral.Kind.AGENT_CLASS1);
        (uint256 poolCR,) = getCollateralRatioBIPS(_agent, _agentVault, Collateral.Kind.POOL);
        // target collateral ratio is minCollateralRatioBIPS for CCB and safetyMinCollateralRatioBIPS for LIQUIDATION
        Agent.LiquidationPhase currentPhase = _timeBasedLiquidationPhase(_agent);
        uint256 targetRatioClass1BIPS = _targetRatioBIPS(currentPhase, _agent.collateralTokenC1,
            (_agent.collateralsUnderwater & Agent.LF_CLASS1) != 0);
        uint256 targetRatioPoolBIPS = _targetRatioBIPS(currentPhase, CollateralToken.POOL,
            (_agent.collateralsUnderwater & Agent.LF_POOL) != 0);
        // if agent is safe, restore status to NORMAL
        if (class1CR >= targetRatioClass1BIPS && poolCR >= targetRatioPoolBIPS) {
            _agent.status = Agent.Status.NORMAL;
            _agent.liquidationStartedAt = 0;
            _agent.initialLiquidationPhase = Agent.LiquidationPhase.NONE;
            _agent.collateralsUnderwater = 0;
            emit AMEvents.LiquidationEnded(_agentVault);
        }
    }
    
    function _targetRatioBIPS(
        Agent.LiquidationPhase _currentPhase,
        uint256 _collateralIndex,
        bool _collateralTypeUnderwater
    )
        private view
        returns (uint256)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        CollateralToken.Data storage collateral = state.collateralTokens[_collateralIndex];
        if (_currentPhase == Agent.LiquidationPhase.CCB || !_collateralTypeUnderwater) {
            return collateral.minCollateralRatioBIPS;
        } else {
            return collateral.safetyMinCollateralRatioBIPS;
        }
    }

    // Upgrade (CR-based) liquidation phase (NONE -> CCR -> LIQUIDATION), based on agent's collateral ratio.
    // When in full liquidation mode, do nothing.
    function _upgradeLiquidationPhase(
        Agent.State storage _agent,
        address _agentVault,
        uint256 _class1CR,
        uint256 _poolCR
    )
        private
        returns (Agent.LiquidationPhase)
    {
        Agent.LiquidationPhase currentPhase = _timeBasedLiquidationPhase(_agent);
        // calculate new phase for both collaterals and if any is underwater, set its flag
        Agent.LiquidationPhase newPhaseC1 = 
            _initialLiquidationPhaseForCollateral(_class1CR, _agent.collateralTokenC1);
        if (newPhaseC1 == Agent.LiquidationPhase.LIQUIDATION) {
            _agent.collateralsUnderwater |= Agent.LF_CLASS1;
        }
        Agent.LiquidationPhase newPhasePool = 
            _initialLiquidationPhaseForCollateral(_poolCR, CollateralToken.POOL);
        if (newPhasePool == Agent.LiquidationPhase.LIQUIDATION) {
            _agent.collateralsUnderwater |= Agent.LF_POOL;
        }
        // restart liquidation (set new phase and start time) if new cr based phase is higher than time based
        Agent.LiquidationPhase newPhase = newPhaseC1 >= newPhasePool ? newPhaseC1 : newPhasePool;
        if (newPhase > currentPhase) {
            _agent.status = Agent.Status.LIQUIDATION;
            _agent.liquidationStartedAt = block.timestamp.toUint64();
            _agent.initialLiquidationPhase = newPhase;
            _agent.collateralsUnderwater =
                (newPhase == newPhaseC1 ? Agent.LF_CLASS1 : 0) | (newPhase == newPhasePool ? Agent.LF_POOL : 0);
            if (newPhase == Agent.LiquidationPhase.CCB) {
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
        uint256 _collateralRatioBIPS,
        uint256 _collateralIndex
    )
        private view
        returns (Agent.LiquidationPhase)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        CollateralToken.Data storage collateral = state.collateralTokens[_collateralIndex];
        if (_collateralRatioBIPS >= collateral.minCollateralRatioBIPS) {
            return Agent.LiquidationPhase.NONE;
        } else if (_collateralRatioBIPS >= collateral.ccbMinCollateralRatioBIPS) {
            return Agent.LiquidationPhase.CCB;
        } else {
            return Agent.LiquidationPhase.LIQUIDATION;
        }
    }
    
    // Current liquidation phase (assumed that liquidation/ccb was started in some past transaction,
    // so the result only depends on time, not on current collateral ratio).
    // Beware: the result here can be CCB even if it should be LIQUIDATION because CR dropped.
    function _timeBasedLiquidationPhase(
        Agent.State storage _agent
    )
        private view
        returns (Agent.LiquidationPhase)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        Agent.Status status = _agent.status;
        if (status == Agent.Status.LIQUIDATION) {
            bool inCCB = _agent.initialLiquidationPhase == Agent.LiquidationPhase.CCB
                && block.timestamp <= _agent.liquidationStartedAt + settings.ccbTimeSeconds;
            return inCCB ? Agent.LiquidationPhase.CCB : Agent.LiquidationPhase.LIQUIDATION;
        } else if (status == Agent.Status.FULL_LIQUIDATION) {
            return Agent.LiquidationPhase.LIQUIDATION;
        } else {    // any other status - NORMAL or DESTROYING
            return Agent.LiquidationPhase.NONE;
        }
    }

    // Liquidation premium step (depends on time since CCB or liquidation was started)
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function _currentLiquidationStep(
        Agent.State storage _agent
    )
        private view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        // calculate premium step based on time since liquidation started
        bool startedInCCB = _agent.status == Agent.Status.LIQUIDATION 
            && _agent.initialLiquidationPhase == Agent.LiquidationPhase.CCB;
        uint256 ccbTime = startedInCCB ? settings.ccbTimeSeconds : 0;
        uint256 liquidationStart = _agent.liquidationStartedAt + ccbTime;
        uint256 step = (block.timestamp - liquidationStart) / settings.liquidationStepSeconds;
        return Math.min(step, settings.liquidationCollateralFactorBIPS.length - 1);
    }


    // Liquidation premium step (depends on time, but is capped by the current collateral ratio)
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function _currentLiquidationFactorBIPS(
        Agent.State storage _agent,
        uint256 _class1CR,
        uint256 _poolCR
    )
        private view
        returns (uint256 _c1FactorBIPS, uint256 _poolFactorBIPS)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 step = _currentLiquidationStep(_agent);
        uint256 factorBIPS = settings.liquidationCollateralFactorBIPS[step];
        // All premiums are expressed as factor BIPS.
        // Current algorithm for splitting payment: use liquidationCollateralFactorBIPS for class1 and
        // pay the rest from pool. If any factor exceeeds the CR of that collateral, pay that collateral at
        // its CR and pay more of the other. If both collaterals exceed CR, limit both to their CRs.
        _c1FactorBIPS = Math.min(settings.liquidationFactorClass1BIPS, factorBIPS);
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
        Agent.State storage _agent,
        uint256 _collateralRatioBIPS,
        uint256 _factorBIPS,
        uint256 _collateralIndex
    )
        private view
        returns (uint256)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        // for full liquidation, all minted amount can be liquidated
        if (_agent.status == Agent.Status.FULL_LIQUIDATION) {
            return _agent.mintedAMG;
        }
        // otherwise, liquidate just enough to get agent to safety
        CollateralToken.Data storage collateral = state.collateralTokens[_collateralIndex];
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
        maxLiquidatedAMG = maxLiquidatedAMG.roundUp(state.settings.lotSizeAMG);
        return Math.min(maxLiquidatedAMG, _agent.mintedAMG);
    }
    
    // Share of amount paid by pool that is the fault of the agent
    // (affects how many of the agent's pool tokens will be slashed).
    function _agentResponsibilityWei(Agent.State storage _agent, uint256 _amount) private view returns (uint256) {
        if (_agent.status == Agent.Status.FULL_LIQUIDATION || _agent.collateralsUnderwater == Agent.LF_CLASS1) {
            return _amount;
        } else if (_agent.collateralsUnderwater == Agent.LF_POOL) {
            return 0;
        } else {    // both collaterals were underwater - only half responisibility assigned to agent
            return _amount / 2;
        }
    }
    
    // The collateral ratio (BIPS) for deciding whether agent is in liquidation or CCB is the maximum
    // of the ratio calculated from FTSO price and the ratio calculated from trusted voters' price.
    // In this way, liquidation due to bad FTSO providers bunching together is less likely.
    function getCollateralRatioBIPS(
        Agent.State storage _agent,
        address _agentVault,
        Collateral.Kind _collateralKind
    )
        internal view
        returns (uint256 _collateralRatioBIPS, uint256 _amgToTokenWeiPrice)
    {
        (uint256 fullCollateral, uint256 amgToTokenWeiPrice, uint256 amgToTokenWeiPriceTrusted) =
            AgentCollateral.collateralDataWithTrusted(_agent, _agentVault, _collateralKind);
        uint256 ratio = AgentCollateral.collateralRatioBIPS(_agent, fullCollateral, amgToTokenWeiPrice);
        uint256 ratioTrusted = AgentCollateral.collateralRatioBIPS(_agent, fullCollateral, amgToTokenWeiPriceTrusted);
        _amgToTokenWeiPrice = amgToTokenWeiPrice;
        _collateralRatioBIPS = Math.max(ratio, ratioTrusted);
    }
}
