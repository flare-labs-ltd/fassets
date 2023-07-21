import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ILiquidationStrategyContract } from "../../../typechain-truffle";
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
        const LiquidationStrategy = hre.artifacts.require('LiquidationStrategyImpl') as ILiquidationStrategyContract;
        const liquidationStrategy = await LiquidationStrategy.new();
        contracts.LiquidationStrategyImpl = newContract('LiquidationStrategyImpl', 'LiquidationStrategyImpl.sol', liquidationStrategy.address);
        return liquidationStrategy.address;
    }

    encodeSettings(settings: LiquidationStrategyImplSettings): string {
        return web3.eth.abi.encodeParameters(['uint256', 'uint256[]', 'uint256[]'],
            [settings.liquidationStepSeconds, settings.liquidationCollateralFactorBIPS, settings.liquidationFactorVaultCollateralBIPS]);
    }
}
