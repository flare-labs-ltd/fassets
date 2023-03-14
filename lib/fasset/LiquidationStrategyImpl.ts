import { BNish } from "../utils/helpers";

export interface LiquidationStrategyImplSettings {
    liquidationStepSeconds: BNish;
    liquidationCollateralFactorBIPS: BNish[];
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
