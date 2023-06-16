import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ChainContracts } from "../contracts";
import { JsonParameterSchema } from "../JsonParameterSchema";

export interface ILiquidationStrategyFactory<SETTINGS> {
    readonly name: string;

    readonly schema: JsonParameterSchema<SETTINGS>;

    deployLibrary(hre: HardhatRuntimeEnvironment, contracts: ChainContracts): Promise<string>;

    encodeSettings(settings: SETTINGS): string;
}
