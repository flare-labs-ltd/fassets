// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "./data/AssetManagerState.sol";
import "./Agents.sol";
import "./CollateralTypes.sol";

library LiquidationPaymentStrategy {
    using Agent for Agent.State;
    using Agents for Agent.State;
    using CollateralTypes for CollateralTypeInt.Data;

    // Liquidation premium step (depends on time, but is capped by the current collateral ratio)
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function currentLiquidationFactorBIPS(
        Agent.State storage _agent,
        uint256 _vaultCR,
        uint256 _poolCR
    )
        internal view
        returns (uint256 _c1FactorBIPS, uint256 _poolFactorBIPS)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 step = _currentLiquidationStep(_agent);
        uint256 factorBIPS = settings.liquidationCollateralFactorBIPS[step];
        // All premiums are expressed as factor BIPS.
        // Current algorithm for splitting payment: use liquidationCollateralFactorBIPS for vault collateral and
        // pay the rest from pool. If any factor exceeds the CR of that collateral, pay that collateral at
        // its CR and pay more of the other. If both collaterals exceed CR, limit both to their CRs.
        _c1FactorBIPS = Math.min(settings.liquidationFactorVaultCollateralBIPS[step], factorBIPS);
        // prevent paying with invalid token (if there is enough of the other tokens)
        // TODO: should we remove this - is it better to pay with invalidated vault collateral then with pool?
        CollateralTypeInt.Data storage vaultCollateral = _agent.getVaultCollateral();
        CollateralTypeInt.Data storage poolCollateral = _agent.getPoolCollateral();
        if (!vaultCollateral.isValid() && poolCollateral.isValid()) {
            // vault collateral invalid - pay everything with pool collateral
            _c1FactorBIPS = 0;
        } else if (vaultCollateral.isValid() && !poolCollateral.isValid()) {
            // pool collateral - pay everything with vault collateral
            _c1FactorBIPS = factorBIPS;
        }
        // never exceed CR of tokens
        if (_c1FactorBIPS > _vaultCR) {
            _c1FactorBIPS = _vaultCR;
        }
        _poolFactorBIPS = factorBIPS - _c1FactorBIPS;
        if (_poolFactorBIPS > _poolCR) {
            _poolFactorBIPS = _poolCR;
            _c1FactorBIPS = Math.min(factorBIPS - _poolFactorBIPS, _vaultCR);
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
}
