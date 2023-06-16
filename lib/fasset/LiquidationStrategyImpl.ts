type BNish = BN | number | string;

export interface LiquidationStrategyImplSettings {
    /**
     * If there was no liquidator for the current liquidation offer,
     * go to the next step of liquidation after a certain period of time.
     */
    liquidationStepSeconds: BNish;

    /**
     * Factor with which to multiply the asset price in native currency to obtain the payment
     * to the liquidator.
     * Expressed in BIPS, e.g. [12000, 16000, 20000] means that the liquidator will be paid 1.2, 1.6 and 2.0
     * times the market price of the liquidated assets.
     * Values in array must increase and be greater than 100%.
     * @minItems 1
     */
    liquidationCollateralFactorBIPS: BNish[];

    /**
     * Factor with which to multiply the asset price in native currency to obtain the payment
     * to the liquidator in class1 collateral. The rest (up to liquidationCollateralFactorBIPS) is paid from the pool.
     * The length of this array must be the same as the length of liquidationCollateralFactorBIPS array.
     */
    liquidationFactorClass1BIPS: BNish[];
}

export function encodeLiquidationStrategyImplSettings(settings: LiquidationStrategyImplSettings) {
    return web3.eth.abi.encodeParameters(['uint256', 'uint256[]', 'uint256[]'],
        [settings.liquidationStepSeconds, settings.liquidationCollateralFactorBIPS, settings.liquidationFactorClass1BIPS]);
}

export function decodeLiquidationStrategyImplSettings(encoded: string): LiquidationStrategyImplSettings {
    const { 0: liquidationStepSeconds, 1: liquidationCollateralFactorBIPS, 2: liquidationFactorClass1BIPS } =
        web3.eth.abi.decodeParameters(['uint256', 'uint256[]', 'uint256[]'], encoded);
    return { liquidationStepSeconds, liquidationCollateralFactorBIPS, liquidationFactorClass1BIPS };
}
