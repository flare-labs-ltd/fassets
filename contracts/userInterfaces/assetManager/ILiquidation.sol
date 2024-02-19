// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

/**
 * Liquidation
 */
interface ILiquidation {
    /**
     * Checks that the agent's collateral is too low and if true, starts the agent's liquidation.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * NOTE: always succeeds and returns the new liquidation status.
     * @param _agentVault agent vault address
     * @return _liquidationStatus 0=no liquidation, 1=CCB, 2=liquidation
     * @return _liquidationStartTs if the status is LIQUIDATION, the timestamp when liquidation started;
     *  if the status is CCB, the timestamp when liquidation will start; otherwise 0
     */
    function startLiquidation(
        address _agentVault
    ) external
        returns (uint8 _liquidationStatus, uint256 _liquidationStartTs);

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
    ) external
        returns (uint256 _liquidatedAmountUBA, uint256 _amountPaidVault, uint256 _amountPaidPool);

    /**
     * When the agent's collateral reaches the safe level during liquidation, the liquidation
     * process can be stopped by calling this method.
     * Full liquidation (i.e. the liquidation triggered by illegal underlying payment)
     * cannot be stopped.
     * NOTE: anybody can call.
     * NOTE: if the method succeeds, the agent's liquidation has ended.
     * @param _agentVault agent vault address
     */
    function endLiquidation(
        address _agentVault
    ) external;
}
