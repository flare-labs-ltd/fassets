import { HardhatRuntimeEnvironment } from "hardhat/types";
import { JsonParameterSchema } from "../JsonParameterSchema";
import { ContractStore } from "../contracts";

export interface ILiquidationStrategyFactory<SETTINGS> {
    readonly name: string;

    readonly schema: JsonParameterSchema<SETTINGS>;

    deployLibrary(hre: HardhatRuntimeEnvironment, contracts: ContractStore): Promise<string>;

    encodeSettings(settings: SETTINGS): string;
}
