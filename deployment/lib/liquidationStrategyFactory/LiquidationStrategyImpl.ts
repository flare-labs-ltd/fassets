import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ChainContracts, newContract } from "../contracts";
import { deployedCodeMatches } from "../deploy-utils";
import { JsonParameterSchema } from "../JsonParameterSchema";
import { ILiquidationStrategyFactory } from "./ILiquidationStrategyFactory";
import { LiquidationStrategyImplSettings } from "./LiquidationStrategyImplSettings";

export class LiquidationStrategyImpl implements ILiquidationStrategyFactory<LiquidationStrategyImplSettings> {
    name = 'LiquidationStrategyImpl';

    schema = new JsonParameterSchema<LiquidationStrategyImplSettings>(require('../../../deployment/config/LiquidationStrategyImplSettings.schema.json'));

    async deployLibrary(hre: HardhatRuntimeEnvironment, contracts: ChainContracts): Promise<string> {
        const liquidationStrategyArtifact = hre.artifacts.readArtifactSync('LiquidationStrategyImpl');
        if (await deployedCodeMatches(liquidationStrategyArtifact, contracts.LiquidationStrategyImpl?.address)) {
            return contracts.LiquidationStrategyImpl!.address;
        }
        const LiquidationStrategy = hre.artifacts.require('LiquidationStrategyImpl');
        const liquidationStrategy = LiquidationStrategy.new();
        contracts.LiquidationStrategyImpl = newContract('LiquidationStrategyImpl', 'LiquidationStrategyImpl', liquidationStrategy.address);
        return liquidationStrategy.address;
    }

    encodeSettings(settings: LiquidationStrategyImplSettings): string {
        return web3.eth.abi.encodeParameters(['uint256', 'uint256[]', 'uint256[]'],
            [settings.liquidationStepSeconds, settings.liquidationCollateralFactorBIPS, settings.liquidationFactorClass1BIPS]);
    }
}
