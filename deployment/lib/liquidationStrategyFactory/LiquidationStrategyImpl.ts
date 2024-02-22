import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ILiquidationStrategyContract } from "../../../typechain-truffle";
import { JsonParameterSchema } from "../JsonParameterSchema";
import { ContractStore } from "../contracts";
import { deployedCodeMatches } from "../deploy-utils";
import { ILiquidationStrategyFactory } from "./ILiquidationStrategyFactory";
import { LiquidationStrategyImplSettings } from "./LiquidationStrategyImplSettings";

export class LiquidationStrategyImpl implements ILiquidationStrategyFactory<LiquidationStrategyImplSettings> {
    name = 'LiquidationStrategyImpl';

    schema = new JsonParameterSchema<LiquidationStrategyImplSettings>(require('../../../deployment/config/LiquidationStrategyImplSettings.schema.json'));

    async deployLibrary(hre: HardhatRuntimeEnvironment, contracts: ContractStore): Promise<string> {
        const liquidationStrategyArtifact = hre.artifacts.readArtifactSync('LiquidationStrategyImpl');
        const deployedCodeAddress = contracts.get('LiquidationStrategyImpl')?.address;
        if (await deployedCodeMatches(liquidationStrategyArtifact, deployedCodeAddress)) {
            return deployedCodeAddress!;
        }
        const LiquidationStrategy = hre.artifacts.require('LiquidationStrategyImpl') as ILiquidationStrategyContract;
        const liquidationStrategy = await LiquidationStrategy.new();
        contracts.add('LiquidationStrategyImpl', 'LiquidationStrategyImpl.sol', liquidationStrategy.address);
        return liquidationStrategy.address;
    }

    encodeSettings(settings: LiquidationStrategyImplSettings): string {
        return web3.eth.abi.encodeParameters(['uint256', 'uint256[]', 'uint256[]'],
            [settings.liquidationStepSeconds, settings.liquidationCollateralFactorBIPS, settings.liquidationFactorVaultCollateralBIPS]);
    }
}
