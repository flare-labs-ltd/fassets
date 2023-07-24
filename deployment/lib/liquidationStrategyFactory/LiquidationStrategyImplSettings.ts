type integer = number;

export interface LiquidationStrategyImplSettings {
    /**
     * JSON schema url
     */
    $schema?: string;

    /**
     * If there was no liquidator for the current liquidation offer,
     * go to the next step of liquidation after a certain period of time.
     * @minimum 0
     */
    liquidationStepSeconds: integer;

    /**
     * Factor with which to multiply the asset price in native currency to obtain the payment
     * to the liquidator.
     * Expressed in BIPS, e.g. [12000, 16000, 20000] means that the liquidator will be paid 1.2, 1.6 and 2.0
     * times the market price of the liquidated assets.
     * Values in the array must increase and be greater than 100%.
     * @minItems 1
     */
    liquidationCollateralFactorBIPS: integer[];

    /**
     * Factor with which to multiply the asset price in native currency to obtain the payment
     * to the liquidator in vault collateral. The rest (up to liquidationCollateralFactorBIPS) is paid from the pool.
     * The length of this array must be the same as the length of liquidationCollateralFactorBIPS array.
     * @minItems 1
     */
    liquidationFactorVaultCollateralBIPS: integer[];
}
