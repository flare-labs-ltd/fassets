// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../data/AssetManagerState.sol";
import "./LiquidationStrategyImplSettings.sol";
import "../Agents.sol";
import "../CollateralTypes.sol";

library LiquidationStrategyImpl {
    using Agents for Agent.State;
    using CollateralTypes for CollateralTypeInt.Data;

    function initialize(bytes memory _encodedSettings) external {
        LiquidationStrategyImplSettings.verifyAndUpdate(_encodedSettings);
    }

    function updateSettings(bytes memory _encodedSettings) external {
        LiquidationStrategyImplSettings.verifyAndUpdate(_encodedSettings);
    }

    function getSettings() external view returns (bytes memory) {
        return LiquidationStrategyImplSettings.getEncoded();
    }

    // Liquidation premium step (depends on time, but is capped by the current collateral ratio)
    // assumed: agentStatus == LIQUIDATION/FULL_LIQUIDATION && liquidationPhase == LIQUIDATION
    function currentLiquidationFactorBIPS(
        address _agentVault,
        uint256 _class1CR,
        uint256 _poolCR
    )
        external view
        returns (uint256 _c1FactorBIPS, uint256 _poolFactorBIPS)
    {
        LiquidationStrategyImplSettings.Data storage settings = LiquidationStrategyImplSettings.get();
        Agent.State storage agent = Agent.get(_agentVault);
        uint256 step = _currentLiquidationStep(agent);
        uint256 factorBIPS = settings.liquidationCollateralFactorBIPS[step];
        // All premiums are expressed as factor BIPS.
        // Current algorithm for splitting payment: use liquidationCollateralFactorBIPS for class1 and
        // pay the rest from pool. If any factor exceeds the CR of that collateral, pay that collateral at
        // its CR and pay more of the other. If both collaterals exceed CR, limit both to their CRs.
        _c1FactorBIPS = Math.min(settings.liquidationFactorClass1BIPS[step], factorBIPS);
        // prevent paying with invalid token (if there is enough of the other tokens)
        // TODO: should we remove this - is it better to pay with invalidated class1 then with pool?
        CollateralTypeInt.Data storage class1Collateral = agent.getClass1Collateral();
        CollateralTypeInt.Data storage poolCollateral = agent.getPoolCollateral();
        if (!class1Collateral.isValid() && poolCollateral.isValid()) {
            // class1 collateral invalid - pay everything with pool collateral
            _c1FactorBIPS = 0;
        } else if (class1Collateral.isValid() && !poolCollateral.isValid()) {
            // pool collateral - pay everything with class1 collateral
            _c1FactorBIPS = factorBIPS;
        }
        // never exceed CR of tokens
        if (_c1FactorBIPS > _class1CR) {
            _c1FactorBIPS = _class1CR;
        }
        _poolFactorBIPS = factorBIPS - _c1FactorBIPS;
        if (_poolFactorBIPS > _poolCR) {
            _poolFactorBIPS = _poolCR;
            _c1FactorBIPS = Math.min(factorBIPS - _poolFactorBIPS, _class1CR);
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
        AssetManagerSettings.Data storage globalSettings = AssetManagerState.getSettings();
        LiquidationStrategyImplSettings.Data storage settings = LiquidationStrategyImplSettings.get();
        // calculate premium step based on time since liquidation started
        bool startedInCCB = _agent.status == Agent.Status.LIQUIDATION
            && _agent.initialLiquidationPhase == Agent.LiquidationPhase.CCB;
        uint256 ccbTime = startedInCCB ? globalSettings.ccbTimeSeconds : 0;
        uint256 liquidationStart = _agent.liquidationStartedAt + ccbTime;
        uint256 step = (block.timestamp - liquidationStart) / settings.liquidationStepSeconds;
        return Math.min(step, settings.liquidationCollateralFactorBIPS.length - 1);
    }
}
