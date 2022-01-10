// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeBips.sol";
import "./Agents.sol";
import "./AssetManagerSettings.sol";
import "./AssetManagerState.sol";
import "./Conversion.sol";
import "./Redemption.sol";
import "../interface/IAgentVault.sol";

library Liquidation {
    using SafeCast for uint256;
    using SafePct for uint256;
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using SafeBips for uint256;
    using SafeBips for uint64;
    
    // Start agent's liquidation - if already in liquidation, can only update to full liquidation
    function startLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault,
        bool _fullLiquidation
    )
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        uint256 fullCollateral = IAgentVault(_agentVault).fullCollateral();
        uint256 amgToNATWeiPrice = Conversion.calculateAmgToNATWeiPrice(_state.settings);
        (Agents.LiquidationPhase liquidationPhase, uint16 premiumFactorBIPS) = 
            getInitialLiquidationPhase(agent, _state.settings, fullCollateral, amgToNATWeiPrice, _fullLiquidation);

        if (agent.status == Agents.AgentStatus.NORMAL || 
                (_fullLiquidation && agent.status == Agents.AgentStatus.LIQUIDATION)) {
            agent.status = _fullLiquidation ? Agents.AgentStatus.FULL_LIQUIDATION : Agents.AgentStatus.LIQUIDATION;
            agent.liquidationState.liquidationStartedAt = SafeCast.toUint64(block.timestamp);
            agent.liquidationState.initialLiquidationPhase = liquidationPhase;
            agent.liquidationState.initialPremiumFactorBIPS = premiumFactorBIPS;
        }
    }

    // liquidate agent's position
    function liquidate(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint64 _amountAMG
    )
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.status != Agents.AgentStatus.NORMAL, "not in liquidation");
        uint256 fullCollateral = IAgentVault(_agentVault).fullCollateral();
        uint256 amgToNATWeiPrice = Conversion.calculateAmgToNATWeiPrice(_state.settings);
        (Agents.LiquidationPhase liquidationPhase, bool isEnough, uint64 maxAmountAMG, uint16 premiumFactorBIPS) = 
            getCurrentLiquidationPhase(agent, _state.settings, fullCollateral, amgToNATWeiPrice);
        require(liquidationPhase != Agents.LiquidationPhase.CCB, "in CCB");

        uint64 fAssetAMG = agent.reservedAMG.add64(agent.mintedAMG).add64(agent.redeemingAMG);
        uint64 amountToLiquidateAMG = Math.min(maxAmountAMG, _amountAMG).toUint64();
        uint64 liquidatedAmountAMG = Redemption.liquidate(_state, msg.sender, _agentVault, amountToLiquidateAMG);

        uint256 liquidationValueNATWei;
        if (!isEnough) { // 100% collateral premium is not enough - calculate proportion
            liquidationValueNATWei = (fullCollateral.sub(agent.withdrawalAnnouncedNATWei))
                .mulDiv(liquidatedAmountAMG, fAssetAMG);
        } else {
            liquidationValueNATWei = Conversion.convertAmgToNATWei(liquidatedAmountAMG, amgToNATWeiPrice);
            if (liquidationPhase == Agents.LiquidationPhase.COLLATERAL_PREMIUM) { // get collateral
                liquidationValueNATWei = liquidationValueNATWei.mulBips(_state.settings.initialMinCollateralRatioBIPS);
            }
            // multiply with price or collateral premium
            liquidationValueNATWei = liquidationValueNATWei.mulBips(premiumFactorBIPS);
        }

        IAgentVault(_agentVault).liquidate(msg.sender, liquidationValueNATWei);
    }

    // Cancel agent's liquidation
    function cancelLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint256 _fullCollateral,
        uint256 _amgToNATWeiPrice
    )
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.status == Agents.AgentStatus.LIQUIDATION, "not in (normal) liquidation");
        require(isAgentHealthy(agent, _state.settings, _fullCollateral, _amgToNATWeiPrice), "collateral too small");
        require(agent.freeUnderlyingBalanceUBA >= 0, "free underlying balance < 0");
        agent.status = Agents.AgentStatus.NORMAL;
        delete agent.liquidationState;
    }

    function isAgentHealthy(
        Agents.Agent storage _agent,
        AssetManagerSettings.Settings storage _settings,
        uint256 _fullCollateral,
        uint256 _amgToNATWeiPrice
    )
        internal view
        returns (bool)
    {
        bool inLqdtn = _agent.status != Agents.AgentStatus.NORMAL;
        uint256 mintingAMG = uint256(_agent.reservedAMG).add(_agent.mintedAMG);
        uint256 mintingCollateral = Conversion.convertAmgToNATWei(mintingAMG, _amgToNATWeiPrice)
            .mulBips(inLqdtn ? _settings.liquidationMinCollateralRatioBIPS : _settings.initialMinCollateralRatioBIPS);
        uint256 redeemingCollateral = Agents.lockedRedeemingCollateralWei(_agent, _settings, _amgToNATWeiPrice);
        return mintingCollateral.add(redeemingCollateral).add(_agent.withdrawalAnnouncedNATWei) <= _fullCollateral;
    }

    function isAgentInCCB(
        Agents.Agent storage _agent,
        AssetManagerSettings.Settings storage _settings,
        uint256 _fullCollateral,
        uint256 _amgToNATWeiPrice
    )
        internal view
        returns (bool)
    {
        uint256 mintingAMG = uint256(_agent.reservedAMG).add(_agent.mintedAMG);
        uint256 mintingCollateral = Conversion.convertAmgToNATWei(mintingAMG, _amgToNATWeiPrice)
            .mulBips(_settings.liquidationMinCollateralCallBandBIPS);
        uint256 redeemingCollateral = Agents.lockedRedeemingCollateralWei(_agent, _settings, _amgToNATWeiPrice);
        return mintingCollateral.add(redeemingCollateral).add(_agent.withdrawalAnnouncedNATWei) <= _fullCollateral;
    }

    // liquidate a part of position
    function isLiquidationPhase1(
        Agents.Agent storage _agent,
        AssetManagerSettings.Settings storage _settings,
        uint256 _fullCollateral,
        uint256 _amgToNATWeiPrice
    )
        internal view
        returns (bool _isPhase1)
    {
        (_isPhase1, ) = calculateLiquidationAmountForPhase1(_agent, _settings, _fullCollateral, _amgToNATWeiPrice);
    }

    
    // liquidate a part of position - only `_agent.mintedAMG` amount can be liquidated
    function calculateLiquidationAmountForPhase1(
        Agents.Agent storage _agent,
        AssetManagerSettings.Settings storage _settings,
        uint256 _fullCollateral,
        uint256 _amgToNATWeiPrice
    )
        internal view
        returns (bool _isPhase1, uint64 _liquidationAmountAMG)
    {
        uint256 mintingCollateral = Conversion.convertAmgToNATWei(_agent.reservedAMG, _amgToNATWeiPrice)
            .mulBips(_settings.liquidationMinCollateralRatioBIPS);
        uint256 redeemingCollateral = Agents.lockedRedeemingCollateralWei(_agent, _settings, _amgToNATWeiPrice);

        uint256 reservedCollateral = mintingCollateral.add(redeemingCollateral).add(_agent.withdrawalAnnouncedNATWei);
        if (reservedCollateral > _fullCollateral) {
            return (false, 0); // not phase 1
        }
        uint256 mintedNATWei = Conversion.convertAmgToNATWei(_agent.mintedAMG, _amgToNATWeiPrice);

        // do not use more than it should be reserved
        // if liquidation due to no underlying chain topup, agent can have a lot of free collateral
        uint256 remainingCollateral = Math.min(_fullCollateral - reservedCollateral, // guarded by if condition 
            mintedNATWei.mulBips(_settings.initialMinCollateralRatioBIPS));

        if (mintedNATWei.mulBips(_settings.liquidationPricePremiumBIPS) > remainingCollateral) {
            return (false, 0); // not phase 1
        }

        uint256 freeUnderlyingBalanceLiquidationAmountAMG = 0;
        if (_agent.freeUnderlyingBalanceUBA < 0) {
            freeUnderlyingBalanceLiquidationAmountAMG = uint256(-_agent.freeUnderlyingBalanceUBA)
                .div(_settings.assetMintingGranularityUBA);
            if (_agent.freeUnderlyingBalanceUBA % _settings.assetMintingGranularityUBA != 0) {
                freeUnderlyingBalanceLiquidationAmountAMG += 1;
            }
            if (freeUnderlyingBalanceLiquidationAmountAMG > _agent.mintedAMG) {
                return (false, 0); // not pahse 1
            }
        }

        // required collateral for the agent's postion to be healthy
        uint256 requiredCollateral = mintedNATWei.mulBips(_settings.liquidationMinCollateralRatioBIPS)
            .add(reservedCollateral);

        uint256 healthyLiquidationAmountAMG = 0;
        if (requiredCollateral > _fullCollateral) { // unhealthy position
            uint256 numerator = (requiredCollateral - _fullCollateral)
                .mul(Conversion.AMG_NATWEI_PRICE_SCALE).mul(SafeBips.MAX_BIPS);
            uint256 denominator = _amgToNATWeiPrice
                .mul(_settings.liquidationMinCollateralRatioBIPS - _settings.liquidationPricePremiumBIPS);

            healthyLiquidationAmountAMG = numerator.div(denominator);

            if (numerator % denominator != 0) {
                healthyLiquidationAmountAMG += 1;
            }
            // TODO  check healthyLiquidationAmountAMG <= _agent.mintedAMG;
        }

        return (true, Math.max(freeUnderlyingBalanceLiquidationAmountAMG, healthyLiquidationAmountAMG).toUint64());
    }

    // liquidate full position
    function isLiquidationPhase2(
        Agents.Agent storage _agent,
        AssetManagerSettings.Settings storage _settings,
        uint256 _fullCollateral,
        uint256 _amgToNATWeiPrice,
        uint256 _collateralPremiumFactorBIPS
    )
        internal view
        returns (bool)
    {
        uint256 mintingAMG = uint256(_agent.reservedAMG).add(_agent.mintedAMG);
        uint256 mintingNATWei = Conversion.convertAmgToNATWei(mintingAMG, _amgToNATWeiPrice);
        uint256 redeemingCollateral = Agents.lockedRedeemingCollateralWei(_agent, _settings, _amgToNATWeiPrice);

        uint256 reservedCollateral = redeemingCollateral.add(_agent.withdrawalAnnouncedNATWei);
        if (reservedCollateral > _fullCollateral) {
            return false;
        }

        // do not use more than it should be reserved
        // if liquidation due to illegal payment or no underlying chain topup, agent can have a lot of free collateral
        uint256 remainingCollateral = Math.min(_fullCollateral - reservedCollateral, // guarded by if condition, 
            mintingNATWei.mulBips(_settings.initialMinCollateralRatioBIPS));

        return remainingCollateral.mulBips(_collateralPremiumFactorBIPS) >= mintingNATWei;
    }

    function getInitialLiquidationPhase(
        Agents.Agent storage _agent,
        AssetManagerSettings.Settings storage _settings,
        uint256 _fullCollateral,
        uint256 _amgToNATWeiPrice,
        bool _fullLiquidation
    )
        internal view
        returns (Agents.LiquidationPhase _phase, uint16 _premiumFactorBIPS)
    {
        if (!_fullLiquidation && _agent.freeUnderlyingBalanceUBA >= 0 &&
            isAgentInCCB(_agent, _settings, _fullCollateral, _amgToNATWeiPrice)) {
            return (Agents.LiquidationPhase.CCB, 0);
        } else if (!_fullLiquidation && isLiquidationPhase1(_agent, _settings, _fullCollateral, _amgToNATWeiPrice)) {
            return (Agents.LiquidationPhase.PRICE_PREMIUM, _settings.liquidationPricePremiumBIPS);
        } else {
            (, _premiumFactorBIPS) = 
                getCollateralPremiumFactor(_agent, _settings, _fullCollateral, _amgToNATWeiPrice, 0, 0);
            return (Agents.LiquidationPhase.COLLATERAL_PREMIUM, _premiumFactorBIPS);
        }
    }

    // min collateral premium factor, so that position is healthy again
    // if this is not possible, return the last one (100%)
    function getCollateralPremiumFactor(
        Agents.Agent storage _agent,
        AssetManagerSettings.Settings storage _settings,
        uint256 _fullCollateral,
        uint256 _amgToNATWeiPrice,
        uint256 _startPosition,
        uint16 _minPremiumFactorBIPS
    )
        internal view
        returns (bool _isEnough, uint16 _premiumFactorBIPS)
    {
        uint256 len = _settings.liquidationCollateralPremiumBIPS.length;
        if (_startPosition >= len) {
            _startPosition = len - 1;
        }
        for (uint256 i = _startPosition; i < len; i++) {
            _premiumFactorBIPS = _settings.liquidationCollateralPremiumBIPS[i];
            if (_premiumFactorBIPS < _minPremiumFactorBIPS) {
                continue;
            }
            if (isLiquidationPhase2(_agent, _settings, _fullCollateral, _amgToNATWeiPrice, _premiumFactorBIPS)) {
                return (true, _premiumFactorBIPS);
            }
        }

        return (false, _premiumFactorBIPS);
    }

    // get liquidation phase according to initial liquidation phase and time elapsed
    // returns current liquidation phase, bool if there is enough collateral to pay normally for liquidated amount,
    // amount that can be liquidated, premium factor - price or collateral premium
    function getCurrentLiquidationPhase(
        Agents.Agent storage _agent,
        AssetManagerSettings.Settings storage _settings,
        uint256 _fullCollateral,
        uint256 _amgToNATWeiPrice
    )
        internal view
        returns (Agents.LiquidationPhase _phase, bool _isEnough, uint64 _maxAmountAMG, uint16 _premiumFactorBIPS)
    {
        Agents.LiquidationPhase initialLiquidationPhase = _agent.liquidationState.initialLiquidationPhase;
        uint256 steps = block.timestamp.sub(_agent.liquidationState.liquidationStartedAt)
            .div(_settings.newLiquidationStepAfterMinSeconds);

        if (initialLiquidationPhase == Agents.LiquidationPhase.CCB) {
            if (steps == 0 && isAgentInCCB(_agent, _settings, _fullCollateral, _amgToNATWeiPrice)) {
                return (Agents.LiquidationPhase.CCB, true, 0, 0); // still in initial state
            } else {
                // if not in CCB anymore or if below liquidationMinCollateralCallBandBIPS
                if (steps <= 1) {
                    (_isEnough, _maxAmountAMG) = 
                        calculateLiquidationAmountForPhase1(_agent, _settings, _fullCollateral, _amgToNATWeiPrice);
                    if (_isEnough) {
                        return (Agents.LiquidationPhase.PRICE_PREMIUM, _isEnough, 
                            _maxAmountAMG, _settings.liquidationPricePremiumBIPS);
                    }
                }
                
                // phase 2 - collateral premium
                (, uint256 startPos) = steps.trySub(2);
                (_isEnough, _premiumFactorBIPS) =
                    getCollateralPremiumFactor(_agent, _settings, _fullCollateral, _amgToNATWeiPrice, startPos, 0);
                return (Agents.LiquidationPhase.COLLATERAL_PREMIUM, _isEnough, _agent.mintedAMG, _premiumFactorBIPS);
            }
        } else if (initialLiquidationPhase == Agents.LiquidationPhase.PRICE_PREMIUM) {
            if (steps == 0) { // still in phase 1
                (_isEnough, _maxAmountAMG) = 
                    calculateLiquidationAmountForPhase1(_agent, _settings, _fullCollateral, _amgToNATWeiPrice);
                if (_isEnough) {
                    return (Agents.LiquidationPhase.PRICE_PREMIUM, true, 
                        _maxAmountAMG, _settings.liquidationPricePremiumBIPS);
                }
            }

            // phase 2 - collateral premium
            (, uint256 startPos) = steps.trySub(1);
            (_isEnough, _premiumFactorBIPS) =
                getCollateralPremiumFactor(_agent, _settings, _fullCollateral, _amgToNATWeiPrice, startPos, 0);
            return (Agents.LiquidationPhase.COLLATERAL_PREMIUM, _isEnough, _agent.mintedAMG, _premiumFactorBIPS);
        } else { // phase 2 - collateral premium
            (_isEnough, _premiumFactorBIPS) =
                getCollateralPremiumFactor(_agent, _settings, _fullCollateral, _amgToNATWeiPrice, steps,
                _agent.liquidationState.initialPremiumFactorBIPS);
            return (Agents.LiquidationPhase.COLLATERAL_PREMIUM, _isEnough, _agent.mintedAMG, _premiumFactorBIPS);
        }
    }
}
