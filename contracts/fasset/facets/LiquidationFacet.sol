// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../userInterfaces/assetManager/ILiquidation.sol";
import "../library/Liquidation.sol";
import "./AssetManagerBase.sol";


contract LiquidationFacet is AssetManagerBase, ILiquidation {
    /**
     * Checks that the agent's collateral is too low and if true, starts agent's liquidation.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _agentVault agent vault address
     * @return _liquidationStatus 0=no liquidation, 1=CCB, 2=liquidation
     * @return _liquidationStartAt if the status is LIQUIDATION, the timestamp when liquidation started;
     *  if the status is CCB, the timestamp when liquidation will start; otherwise 0
     */
    function startLiquidation(
        address _agentVault
    )
        external override
        onlyWhitelistedSender
        returns (uint8 _liquidationStatus, uint256 _liquidationStartAt)
    {
        (Agent.LiquidationPhase phase, uint256 startTs) = Liquidation.startLiquidation(_agentVault);
        _liquidationStatus = uint8(phase);
        _liquidationStartAt = startTs;
    }

    /**
     * Burns up to `_amountUBA` f-assets owned by the caller and pays
     * the caller the corresponding amount of native currency with premium
     * (premium depends on the liquidation state).
     * If the agent isn't in liquidation yet, but satisfies conditions,
     * automatically puts the agent in liquidation status.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _agentVault agent vault address
     * @param _amountUBA the amount of f-assets to liquidate
     * @return _liquidatedAmountUBA liquidated amount of f-asset
     * @return _amountPaidVault amount paid to liquidator (in agent's vault collateral)
     * @return _amountPaidPool amount paid to liquidator (in NAT from pool)
     */
    function liquidate(
        address _agentVault,
        uint256 _amountUBA
    )
        external override
        onlyWhitelistedSender
        returns (uint256 _liquidatedAmountUBA, uint256 _amountPaidVault, uint256 _amountPaidPool)
    {
        return Liquidation.liquidate(_agentVault, _amountUBA);
    }

    /**
     * When agent's collateral reaches safe level during liquidation, the liquidation
     * process can be stopped by calling this method.
     * Full liquidation (i.e. the liquidation triggered by illegal underlying payment)
     * cannot be stopped.
     * NOTE: anybody can call.
     * @param _agentVault agent vault address
     */
    function endLiquidation(
        address _agentVault
    )
        external override
    {
        Liquidation.endLiquidation(_agentVault);
    }
}
