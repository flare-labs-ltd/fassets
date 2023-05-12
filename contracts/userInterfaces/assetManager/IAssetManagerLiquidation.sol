// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * Agent liquidation.
 */
interface IAssetManagerLiquidation {
    /**
     * Checks that the agent's collateral is too low and if true, starts agent's liquidation.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _agentVault agent vault address
     */
    function startLiquidation(
        address _agentVault
    ) external;

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
     * @return _amountPaidClass1 amount paid to liquidator (in agents class 1)
     * @return _amountPaidPool amount paid to liquidator (in NAT from pool)
     */
    function liquidate(
        address _agentVault,
        uint256 _amountUBA
    ) external
        returns (uint256 _liquidatedAmountUBA, uint256 _amountPaidClass1, uint256 _amountPaidPool);

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
    ) external;
}
