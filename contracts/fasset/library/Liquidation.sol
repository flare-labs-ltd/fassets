// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "../../utils/lib/MathUtils.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./Conversion.sol";
import "./Redemptions.sol";
import "./AgentCollateral.sol";
import "./LiquidationStrategy.sol";


library Liquidation {
    using SafeMath for uint256;
    using SafeCast for uint256;
    using MathUtils for uint256;
    using SafePct for *;
    using Agent for Agent.State;
    using Agents for Agent.State;

    struct CRData {
        uint256 class1CR;
        uint256 poolCR;
        uint256 amgToC1WeiPrice;
        uint256 amgToPoolWeiPrice;
    }

    // Start collateral ratio based agent's liquidation (Agent.Status.LIQUIDATION)
    function startLiquidation(
        address _agentVault
    )
        external
    {
        Agent.State storage agent = Agent.get(_agentVault);
        // if already in full liquidation or destroying, do nothing
        if (agent.status == Agent.Status.FULL_LIQUIDATION || agent.status == Agent.Status.DESTROYING) return;
        CRData memory cr = getCollateralRatiosBIPS(agent);
        _upgradeLiquidationPhase(agent, cr);
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
        CRData memory cr = getCollateralRatiosBIPS(agent);
        // allow one-step liquidation (without calling startLiquidation first)
        Agent.LiquidationPhase currentPhase = _upgradeLiquidationPhase(agent, cr);
        require(currentPhase == Agent.LiquidationPhase.LIQUIDATION, "not in liquidation");
        // liquidate redemption tickets
        (uint64 liquidatedAmountAMG, uint256 payoutC1Wei, uint256 payoutPoolWei) =
            _performLiquidation(agent, cr, Conversion.convertUBAToAmg(_amountUBA));
        _liquidatedAmountUBA = Conversion.convertAmgToUBA(liquidatedAmountAMG);
        // pay the liquidator
        if (payoutC1Wei > 0) {
            _amountPaidC1 = Agents.payoutClass1(agent, msg.sender, payoutC1Wei);
        }
        if (payoutPoolWei > 0) {
            uint256 agentResponsibilityWei = _agentResponsibilityWei(agent, payoutPoolWei);
            _amountPaidPool = Agents.payoutFromPool(agent, msg.sender, payoutPoolWei, agentResponsibilityWei);
        }
        // try to pull agent out of liquidation
        endLiquidationIfHealthy(agent);
        // burn liquidated fassets
        Redemptions.burnFAssets(msg.sender, _liquidatedAmountUBA);
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
        endLiquidationIfHealthy(agent);
        require(agent.status == Agent.Status.NORMAL, "cannot stop liquidation");
    }

    // Start full agent liquidation (Agent.Status.FULL_LIQUIDATION)
    function startFullLiquidation(
        Agent.State storage _agent
    )
        internal
    {
        // if already in full liquidation or destroying, do nothing
        if (_agent.status == Agent.Status.FULL_LIQUIDATION
            || _agent.status == Agent.Status.DESTROYING) return;
        // if current phase is not LIQUIDATION, restart in LIQUIDATION phase
        Agent.LiquidationPhase currentPhase = _timeBasedLiquidationPhase(_agent);
        if (currentPhase != Agent.LiquidationPhase.LIQUIDATION) {
            _agent.liquidationStartedAt = block.timestamp.toUint64();
            _agent.initialLiquidationPhase = Agent.LiquidationPhase.LIQUIDATION;
        }
        _agent.status = Agent.Status.FULL_LIQUIDATION;
        emit AMEvents.FullLiquidationStarted(_agent.vaultAddress(), block.timestamp);
    }

    // Cancel liquidation if the agent is healthy.
    function endLiquidationIfHealthy(
        Agent.State storage _agent
    )
        internal
    {
        // can only stop plain liquidation (full liquidation can only stop when there are no more minted assets)
        if (_agent.status != Agent.Status.LIQUIDATION) return;
        // agent's current collateral ratio
        CRData memory cr = getCollateralRatiosBIPS(_agent);
        // target collateral ratio is minCollateralRatioBIPS for CCB and safetyMinCollateralRatioBIPS for LIQUIDATION
        Agent.LiquidationPhase currentPhase = _timeBasedLiquidationPhase(_agent);
        uint256 targetRatioClass1BIPS = _targetRatioBIPS(_agent, currentPhase, Collateral.Kind.AGENT_CLASS1);
        uint256 targetRatioPoolBIPS = _targetRatioBIPS(_agent, currentPhase, Collateral.Kind.POOL);
        // if agent is safe, restore status to NORMAL
        if (cr.class1CR >= targetRatioClass1BIPS && cr.poolCR >= targetRatioPoolBIPS) {
            _agent.status = Agent.Status.NORMAL;
            _agent.liquidationStartedAt = 0;
            _agent.initialLiquidationPhase = Agent.LiquidationPhase.NONE;
            _agent.collateralsUnderwater = 0;
            emit AMEvents.LiquidationEnded(_agent.vaultAddress());
        }
    }

    // For use in FullAgentInfo.
    function currentLiquidationPhase(
        Agent.State storage _agent
    )
        internal view
        returns (Agent.LiquidationPhase)
    {
        Agent.LiquidationPhase currentPhase = _timeBasedLiquidationPhase(_agent);
        if (currentPhase != Agent.LiquidationPhase.CCB) return currentPhase;
        // For CCB we must also check if the CR has dropped below CCB-CR.
        // Note that we don't need to check this for phase=NORMAL, because in that case the liquidation must
        // still be triggered via startLiquidation() or liquidate().
        CRData memory cr = getCollateralRatiosBIPS(_agent);
        Agent.LiquidationPhase newPhaseClass1 =
            _initialLiquidationPhaseForCollateral(cr.class1CR, _agent.class1CollateralIndex);
        Agent.LiquidationPhase newPhasePool =
            _initialLiquidationPhaseForCollateral(cr.poolCR, _agent.poolCollateralIndex);
        Agent.LiquidationPhase newPhase = newPhaseClass1 >= newPhasePool ? newPhaseClass1 : newPhasePool;
        return newPhase > currentPhase ? newPhase : currentPhase;
    }

    function getCollateralRatiosBIPS(
        Agent.State storage _agent
    )
        internal view
        returns (CRData memory)
    {
        (uint256 class1CR, uint256 amgToC1WeiPrice) = getCollateralRatioBIPS(_agent, Collateral.Kind.AGENT_CLASS1);
        (uint256 poolCR, uint256 amgToPoolWeiPrice) = getCollateralRatioBIPS(_agent, Collateral.Kind.POOL);
        return CRData({
            class1CR: class1CR,
            poolCR: poolCR,
            amgToC1WeiPrice: amgToC1WeiPrice,
            amgToPoolWeiPrice: amgToPoolWeiPrice
        });
    }

    // The collateral ratio (BIPS) for deciding whether agent is in liquidation or CCB is the maximum
    // of the ratio calculated from FTSO price and the ratio calculated from trusted voters' price.
    // In this way, liquidation due to bad FTSO providers bunching together is less likely.
    function getCollateralRatioBIPS(
        Agent.State storage _agent,
        Collateral.Kind _collateralKind
    )
        internal view
        returns (uint256 _collateralRatioBIPS, uint256 _amgToTokenWeiPrice)
    {
        (Collateral.Data memory _data, Collateral.Data memory _trustedData) =
            _collateralDataWithTrusted(_agent, _collateralKind);
        uint256 ratio = AgentCollateral.collateralRatioBIPS(_data, _agent);
        uint256 ratioTrusted = AgentCollateral.collateralRatioBIPS(_trustedData, _agent);
        _amgToTokenWeiPrice = _data.amgToTokenWeiPrice;
        _collateralRatioBIPS = Math.max(ratio, ratioTrusted);
    }

    // Upgrade (CR-based) liquidation phase (NONE -> CCR -> LIQUIDATION), based on agent's collateral ratio.
    // When in full liquidation mode, do nothing.
    function _upgradeLiquidationPhase(
        Agent.State storage _agent,
        CRData memory _cr
    )
        private
        returns (Agent.LiquidationPhase)
    {
        Agent.LiquidationPhase currentPhase = _timeBasedLiquidationPhase(_agent);
        // calculate new phase for both collaterals and if any is underwater, set its flag
        Agent.LiquidationPhase newPhaseClass1 =
            _initialLiquidationPhaseForCollateral(_cr.class1CR, _agent.class1CollateralIndex);
        if (newPhaseClass1 == Agent.LiquidationPhase.LIQUIDATION) {
            _agent.collateralsUnderwater |= Agent.LF_CLASS1;
        }
        Agent.LiquidationPhase newPhasePool =
            _initialLiquidationPhaseForCollateral(_cr.poolCR, _agent.poolCollateralIndex);
        if (newPhasePool == Agent.LiquidationPhase.LIQUIDATION) {
            _agent.collateralsUnderwater |= Agent.LF_POOL;
        }
        // restart liquidation (set new phase and start time) if new cr based phase is higher than time based
        Agent.LiquidationPhase newPhase = newPhaseClass1 >= newPhasePool ? newPhaseClass1 : newPhasePool;
        if (newPhase > currentPhase) {
            _agent.status = Agent.Status.LIQUIDATION;
            _agent.liquidationStartedAt = block.timestamp.toUint64();
            _agent.initialLiquidationPhase = newPhase;
            _agent.collateralsUnderwater =
                (newPhase == newPhaseClass1 ? Agent.LF_CLASS1 : 0) | (newPhase == newPhasePool ? Agent.LF_POOL : 0);
            if (newPhase == Agent.LiquidationPhase.CCB) {
                emit AMEvents.AgentInCCB(_agent.vaultAddress(), block.timestamp);
            } else {
                emit AMEvents.LiquidationStarted(_agent.vaultAddress(), block.timestamp);
            }
            return newPhase;
        }
        return currentPhase;
    }

    function _performLiquidation(
        Agent.State storage _agent,
        CRData memory _cr,
        uint64 _amountAMG
    )
        private
        returns (uint64 _liquidatedAMG, uint256 _payoutC1Wei, uint256 _payoutPoolWei)
    {
        // split liquidation payment between agent class1 and pool
        (uint256 class1Factor, uint256 poolFactor) =
            LiquidationStrategy.currentLiquidationFactorBIPS(_agent, _cr.class1CR, _cr.poolCR);
        // calculate liquidation amount
        uint256 maxLiquidatedAMG = Math.max(
            _maxLiquidationAmountAMG(_agent, _cr.class1CR, class1Factor, Collateral.Kind.AGENT_CLASS1),
            _maxLiquidationAmountAMG(_agent, _cr.poolCR, poolFactor, Collateral.Kind.POOL));
        uint64 amountToLiquidateAMG = Math.min(maxLiquidatedAMG, _amountAMG).toUint64();
        // liquidate redemption tickets
        (_liquidatedAMG,) = Redemptions.closeTickets(_agent, amountToLiquidateAMG);
        // calculate payouts to liquidator
        _payoutC1Wei = Conversion.convertAmgToTokenWei(_liquidatedAMG.mulBips(class1Factor), _cr.amgToC1WeiPrice);
        _payoutPoolWei = Conversion.convertAmgToTokenWei(_liquidatedAMG.mulBips(poolFactor), _cr.amgToPoolWeiPrice);
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

    function _targetRatioBIPS(
        Agent.State storage _agent,
        Agent.LiquidationPhase _currentPhase,
        Collateral.Kind _collateralKind
    )
        private view
        returns (uint256)
    {
        CollateralToken.Data storage collateral = _agent.getCollateral(_collateralKind);
        if (_currentPhase == Agent.LiquidationPhase.CCB || !_agent.collateralUnderwater(_collateralKind)) {
            return collateral.minCollateralRatioBIPS;
        } else {
            return collateral.safetyMinCollateralRatioBIPS;
        }
    }

    // Calculate the amount of liquidation that gets agent to safety.
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function _maxLiquidationAmountAMG(
        Agent.State storage _agent,
        uint256 _collateralRatioBIPS,
        uint256 _factorBIPS,
        Collateral.Kind _collateralKind
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
        uint256 targetRatioBIPS = _targetRatioBIPS(_agent, Agent.LiquidationPhase.LIQUIDATION, _collateralKind);
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
    function _agentResponsibilityWei(
        Agent.State storage _agent,
        uint256 _amount
    )
        private view
        returns (uint256)
    {
        if (_agent.status == Agent.Status.FULL_LIQUIDATION || _agent.collateralsUnderwater == Agent.LF_CLASS1) {
            return _amount;
        } else if (_agent.collateralsUnderwater == Agent.LF_POOL) {
            return 0;
        } else {    // both collaterals were underwater - only half responsibility assigned to agent
            return _amount / 2;
        }
    }

    // Used for calculating liquidation collateral ratio.
    function _collateralDataWithTrusted(
        Agent.State storage _agent,
        Collateral.Kind _kind
    )
        private view
        returns (Collateral.Data memory _data, Collateral.Data memory _trustedData)
    {
        CollateralToken.Data storage collateral = _agent.getCollateral(_kind);
        address owner = _agent.getCollateralOwner(_kind);
        // A simple way to force agents still holding expired collateral tokens into liquidation is just to
        // set fullCollateral for expired types to 0.
        // This will also make all liquidation payments in the other collateral type.
        // TODO: 1) is this ok?  2) test if it works.
        uint256 fullCollateral = CollateralTokens.isValid(collateral) ? collateral.token.balanceOf(owner) : 0;
        (uint256 price, uint256 trusted) = Conversion.currentAmgPriceInTokenWeiWithTrusted(collateral);
        _data = Collateral.Data({ kind: _kind, fullCollateral: fullCollateral, amgToTokenWeiPrice: price });
        _trustedData = Collateral.Data({ kind: _kind, fullCollateral: fullCollateral, amgToTokenWeiPrice: trusted });
    }
}
