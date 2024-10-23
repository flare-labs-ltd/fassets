// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "../../utils/lib/MathUtils.sol";
import "./data/AssetManagerState.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";
import "./Globals.sol";
import "./Agents.sol";
import "./Conversion.sol";
import "./Redemptions.sol";
import "./AgentCollateral.sol";
import "./LiquidationPaymentStrategy.sol";


library Liquidation {
    using SafeMath for uint256;
    using SafeCast for uint256;
    using MathUtils for uint256;
    using SafePct for *;
    using Agent for Agent.State;
    using Agents for Agent.State;

    struct CRData {
        uint256 vaultCR;
        uint256 poolCR;
        uint256 amgToC1WeiPrice;
        uint256 amgToPoolWeiPrice;
    }

    // Start collateral ratio based agent's liquidation (Agent.Status.LIQUIDATION)
    function startLiquidation(
        address _agentVault
    )
        internal
        returns (Agent.LiquidationPhase _liquidationPhase, uint256 _liquidationStartTs)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        // if already in full liquidation or destroying, do nothing
        if (agent.status == Agent.Status.FULL_LIQUIDATION) {
            return (Agent.LiquidationPhase.LIQUIDATION, agent.liquidationStartedAt);
        }
        if (agent.status == Agent.Status.DESTROYING) {
            return (Agent.LiquidationPhase.NONE, 0);
        }
        // upgrade liquidation based on CR and time
        CRData memory cr = getCollateralRatiosBIPS(agent);
        bool liquidationUpgraded;
        (_liquidationPhase, liquidationUpgraded) = _upgradeLiquidationPhase(agent, cr);
        require(liquidationUpgraded, "liquidation not started");
        _liquidationStartTs = getLiquidationStartTimestamp(agent);
    }

    // Liquidate agent's position.
    // Automatically starts / upgrades agent's liquidation status.
    function liquidate(
        address _agentVault,
        uint256 _amountUBA
    )
        internal
        returns (uint256 _liquidatedAmountUBA, uint256 _amountPaidC1, uint256 _amountPaidPool)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        // agent in status DESTROYING cannot be backing anything, so there can be no liquidation
        if (agent.status == Agent.Status.DESTROYING) return (0, 0, 0);
        // calculate both CRs
        CRData memory cr = getCollateralRatiosBIPS(agent);
        // allow one-step liquidation (without calling startLiquidation first)
        (Agent.LiquidationPhase currentPhase,) = _upgradeLiquidationPhase(agent, cr);
        require(currentPhase == Agent.LiquidationPhase.LIQUIDATION, "not in liquidation");
        // liquidate redemption tickets
        (uint64 liquidatedAmountAMG, uint256 payoutC1Wei, uint256 payoutPoolWei) =
            _performLiquidation(agent, cr, Conversion.convertUBAToAmg(_amountUBA));
        _liquidatedAmountUBA = Conversion.convertAmgToUBA(liquidatedAmountAMG);
        // pay the liquidator
        if (payoutC1Wei > 0) {
            _amountPaidC1 = Agents.payoutFromVault(agent, msg.sender, payoutC1Wei);
        }
        if (payoutPoolWei > 0) {
            uint256 agentResponsibilityWei = _agentResponsibilityWei(agent, payoutPoolWei);
            _amountPaidPool = Agents.payoutFromPool(agent, msg.sender, payoutPoolWei, agentResponsibilityWei);
        }
        // if the agent was already safe due to price changes, there should be no LiquidationPerformed event
        // we do not revert, because it still marks agent as healthy (so there will still be a LiquidationEnded event)
        if (_liquidatedAmountUBA > 0) {
            // burn liquidated fassets
            Redemptions.burnFAssets(msg.sender, _liquidatedAmountUBA);
            // notify about liquidation
            emit IAssetManagerEvents.LiquidationPerformed(_agentVault, msg.sender,
                _liquidatedAmountUBA, _amountPaidC1, _amountPaidPool);
        }
        // try to pull agent out of liquidation
        endLiquidationIfHealthy(agent);
    }

    // Cancel liquidation, requires that agent is healthy.
    function endLiquidation(
        address _agentVault
    )
        internal
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
        Agent.LiquidationPhase currentPhase = currentLiquidationPhase(_agent);
        if (currentPhase != Agent.LiquidationPhase.LIQUIDATION) {
            _agent.liquidationStartedAt = block.timestamp.toUint64();
            _agent.initialLiquidationPhase = Agent.LiquidationPhase.LIQUIDATION;
        }
        _agent.status = Agent.Status.FULL_LIQUIDATION;
        emit IAssetManagerEvents.FullLiquidationStarted(_agent.vaultAddress(), block.timestamp);
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
        Agent.LiquidationPhase currentPhase = currentLiquidationPhase(_agent);
        uint256 targetRatioVaultCollateralBIPS = _targetRatioBIPS(_agent, currentPhase, Collateral.Kind.VAULT);
        uint256 targetRatioPoolBIPS = _targetRatioBIPS(_agent, currentPhase, Collateral.Kind.POOL);
        // if agent is safe, restore status to NORMAL
        if (cr.vaultCR >= targetRatioVaultCollateralBIPS && cr.poolCR >= targetRatioPoolBIPS) {
            _agent.status = Agent.Status.NORMAL;
            _agent.liquidationStartedAt = 0;
            _agent.initialLiquidationPhase = Agent.LiquidationPhase.NONE;
            _agent.collateralsUnderwater = 0;
            emit IAssetManagerEvents.LiquidationEnded(_agent.vaultAddress());
        }
    }

    // Current liquidation phase (assumed that liquidation/ccb was started in some past transaction,
    // so the result only depends on time, not on current collateral ratio).
    // Beware: the result here can be CCB even if it should be LIQUIDATION because CR dropped.
    function currentLiquidationPhase(
        Agent.State storage _agent
    )
        internal view
        returns (Agent.LiquidationPhase)
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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

    function getCollateralRatiosBIPS(
        Agent.State storage _agent
    )
        internal view
        returns (CRData memory)
    {
        (uint256 vaultCR, uint256 amgToC1WeiPrice) = getCollateralRatioBIPS(_agent, Collateral.Kind.VAULT);
        (uint256 poolCR, uint256 amgToPoolWeiPrice) = getCollateralRatioBIPS(_agent, Collateral.Kind.POOL);
        return CRData({
            vaultCR: vaultCR,
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

    function getCCBStartTimestamp(
        Agent.State storage _agent
    )
        internal view
        returns (uint256)
    {
        if (_agent.status != Agent.Status.LIQUIDATION) return 0;
        return _agent.initialLiquidationPhase == Agent.LiquidationPhase.CCB ? _agent.liquidationStartedAt : 0;
    }

    function getLiquidationStartTimestamp(
        Agent.State storage _agent
    )
        internal view
        returns (uint256)
    {
        Agent.Status status = _agent.status;
        if (status == Agent.Status.LIQUIDATION) {
            AssetManagerSettings.Data storage settings = Globals.getSettings();
            bool startedInCCB = _agent.initialLiquidationPhase == Agent.LiquidationPhase.CCB;
            return _agent.liquidationStartedAt + (startedInCCB ? settings.ccbTimeSeconds : 0);
        } else if (status == Agent.Status.FULL_LIQUIDATION) {
            return _agent.liquidationStartedAt;
        } else {    // any other status - NORMAL or DESTROYING
            return 0;
        }
    }

    function getLiquidationFactorsAndMaxAmount(
        Agent.State storage _agent,
        CRData memory _cr
    )
        internal view
        returns (uint256 _vaultFactorBIPS, uint256 _poolFactorBIPS, uint256 _maxLiquidatedUBA)
    {
        Agent.LiquidationPhase currentPhase = currentLiquidationPhase(_agent);
        if (currentPhase != Agent.LiquidationPhase.LIQUIDATION) {
            return (0, 0, 0);
        }
        // split liquidation payment between agent vault and pool
        (_vaultFactorBIPS, _poolFactorBIPS) =
            LiquidationPaymentStrategy.currentLiquidationFactorBIPS(_agent, _cr.vaultCR, _cr.poolCR);
        // calculate liquidation amount
        uint256 maxLiquidatedAMG = Math.max(
            _maxLiquidationAmountAMG(_agent, _cr.vaultCR, _vaultFactorBIPS, Collateral.Kind.VAULT),
            _maxLiquidationAmountAMG(_agent, _cr.poolCR, _poolFactorBIPS, Collateral.Kind.POOL));
        _maxLiquidatedUBA = Conversion.convertAmgToUBA(maxLiquidatedAMG.toUint64());
    }

    // Upgrade (CR-based) liquidation phase (NONE -> CCR -> LIQUIDATION), based on agent's collateral ratio.
    // When in full liquidation mode, do nothing.
    function _upgradeLiquidationPhase(
        Agent.State storage _agent,
        CRData memory _cr
    )
        private
        returns (Agent.LiquidationPhase, bool)
    {
        Agent.LiquidationPhase currentPhase = currentLiquidationPhase(_agent);
        // calculate new phase for both collaterals and if any is underwater, set its flag
        Agent.LiquidationPhase newPhaseVault =
            _initialLiquidationPhaseForCollateral(_cr.vaultCR, _agent.vaultCollateralIndex);
        if (newPhaseVault == Agent.LiquidationPhase.LIQUIDATION) {
            _agent.collateralsUnderwater |= Agent.LF_VAULT;
        }
        Agent.LiquidationPhase newPhasePool =
            _initialLiquidationPhaseForCollateral(_cr.poolCR, _agent.poolCollateralIndex);
        if (newPhasePool == Agent.LiquidationPhase.LIQUIDATION) {
            _agent.collateralsUnderwater |= Agent.LF_POOL;
        }
        // restart liquidation (set new phase and start time) if new cr based phase is higher than time based
        Agent.LiquidationPhase newPhase = newPhaseVault >= newPhasePool ? newPhaseVault : newPhasePool;
        if (newPhase > currentPhase) {
            _agent.status = Agent.Status.LIQUIDATION;
            _agent.liquidationStartedAt = block.timestamp.toUint64();
            _agent.initialLiquidationPhase = newPhase;
            _agent.collateralsUnderwater =
                (newPhase == newPhaseVault ? Agent.LF_VAULT : 0) | (newPhase == newPhasePool ? Agent.LF_POOL : 0);
            if (newPhase == Agent.LiquidationPhase.CCB) {
                emit IAssetManagerEvents.AgentInCCB(_agent.vaultAddress(), block.timestamp);
            } else {
                emit IAssetManagerEvents.LiquidationStarted(_agent.vaultAddress(), block.timestamp);
            }
            return (newPhase, true);
        } else if (
            _agent.status == Agent.Status.LIQUIDATION &&
            _agent.initialLiquidationPhase == Agent.LiquidationPhase.CCB &&
            currentPhase == Agent.LiquidationPhase.LIQUIDATION
        ) {
            // If the liquidation starts because CCB time expired and CR didn't go up, then we still want
            // the LiquidationStarted event to be sent, but it has to be sent just once.
            // So we reset the initial phase to liquidation and send events.
            uint256 liquidationStartedAt = _agent.liquidationStartedAt + Globals.getSettings().ccbTimeSeconds;
            _agent.liquidationStartedAt = liquidationStartedAt.toUint64();
            _agent.initialLiquidationPhase = Agent.LiquidationPhase.LIQUIDATION;
            emit IAssetManagerEvents.LiquidationStarted(_agent.vaultAddress(), liquidationStartedAt);
            return (currentPhase, true);
        }
        return (currentPhase, false);
    }

    function _performLiquidation(
        Agent.State storage _agent,
        CRData memory _cr,
        uint64 _amountAMG
    )
        private
        returns (uint64 _liquidatedAMG, uint256 _payoutC1Wei, uint256 _payoutPoolWei)
    {
        // split liquidation payment between agent vault and pool
        (uint256 vaultFactor, uint256 poolFactor) =
            LiquidationPaymentStrategy.currentLiquidationFactorBIPS(_agent, _cr.vaultCR, _cr.poolCR);
        // calculate liquidation amount
        uint256 maxLiquidatedAMG = Math.max(
            _maxLiquidationAmountAMG(_agent, _cr.vaultCR, vaultFactor, Collateral.Kind.VAULT),
            _maxLiquidationAmountAMG(_agent, _cr.poolCR, poolFactor, Collateral.Kind.POOL));
        uint64 amountToLiquidateAMG = Math.min(maxLiquidatedAMG, _amountAMG).toUint64();
        // liquidate redemption tickets
        (_liquidatedAMG,) = Redemptions.closeTickets(_agent, amountToLiquidateAMG, true);
        // calculate payouts to liquidator
        _payoutC1Wei = Conversion.convertAmgToTokenWei(_liquidatedAMG.mulBips(vaultFactor), _cr.amgToC1WeiPrice);
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
        CollateralTypeInt.Data storage collateral = state.collateralTokens[_collateralIndex];
        if (_collateralRatioBIPS >= collateral.minCollateralRatioBIPS) {
            return Agent.LiquidationPhase.NONE;
        } else if (_collateralRatioBIPS >= collateral.ccbMinCollateralRatioBIPS) {
            return Agent.LiquidationPhase.CCB;
        } else {
            return Agent.LiquidationPhase.LIQUIDATION;
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
        CollateralTypeInt.Data storage collateral = _agent.getCollateral(_collateralKind);
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        maxLiquidatedAMG = maxLiquidatedAMG.roundUp(settings.lotSizeAMG);
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
        if (_agent.status == Agent.Status.FULL_LIQUIDATION || _agent.collateralsUnderwater == Agent.LF_VAULT) {
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
        CollateralTypeInt.Data storage collateral = _agent.getCollateral(_kind);
        address owner = _agent.getCollateralOwner(_kind);
        // A simple way to force agents still holding expired collateral tokens into liquidation is just to
        // set fullCollateral for expired types to 0.
        // This will also make all liquidation payments in the other collateral type.
        uint256 fullCollateral = CollateralTypes.isValid(collateral) ? collateral.token.balanceOf(owner) : 0;
        (uint256 price, uint256 trusted) = Conversion.currentAmgPriceInTokenWeiWithTrusted(collateral);
        _data = Collateral.Data({ kind: _kind, fullCollateral: fullCollateral, amgToTokenWeiPrice: price });
        _trustedData = Collateral.Data({ kind: _kind, fullCollateral: fullCollateral, amgToTokenWeiPrice: trusted });
    }
}
