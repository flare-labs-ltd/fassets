import "dotenv/config";

import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-web3";
import fs from "fs/promises";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import { task } from "hardhat/config";
import path from "path";
import 'solidity-coverage';
import {
    deployAgentOwnerRegistry,
    deployAgentVaultFactory, deployAssetManager, deployAssetManagerController, deployCollateralPoolFactory,
    deployCollateralPoolTokenFactory, deployPriceReader, deploySCProofVerifier, deployUserWhitelist, switchAllToProductionMode, verifyAssetManager, verifyAssetManagerController
} from "./deployment/lib/deploy-fasset-contracts";
import { linkContracts } from "./deployment/lib/link-contracts";
import "./type-extensions";

// import config used for compilation
import config from "./hardhatSetup.config";
import { FAssetContractStore } from "./deployment/lib/contracts";
import { networkConfigName } from "./deployment/lib/deploy-utils";


task("link-contracts", "Link contracts with external libraries")
    .addVariadicPositionalParam("contracts", "The contract names to link")
    .addOptionalParam("mapfile", "Name for the map file with deployed library mapping addresses; if omitted, no map file is read or created")
    .setAction(async ({ contracts, mapfile }, hre) => {
        await linkContracts(hre, contracts, mapfile);
    });

task("deploy-asset-manager-dependencies", "Deploy some or all asset managers. Optionally also deploys asset manager controller.")
    .setAction(async ({ }, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await deploySCProofVerifier(hre, contracts);
        await deployPriceReader(hre, contracts);
        await deployAgentOwnerRegistry(hre, contracts);
        await deployUserWhitelist(hre, contracts);
        await deployAgentVaultFactory(hre, contracts);
        await deployCollateralPoolFactory(hre, contracts);
        await deployCollateralPoolTokenFactory(hre, contracts);
    });

task("deploy-asset-managers", "Deploy some or all asset managers. Optionally also deploys asset manager controller.")
    .addFlag("deployController", "Also deploy AssetManagerController, AgentVaultFactory and SCProofVerifier")
    .addFlag("all", "Deploy all asset managers (for all parameter files in the directory)")
    .addVariadicPositionalParam("managers", "Asset manager file names (default extension is .json). Must be in the directory deployment/config/${networkConfig}. Alternatively, add -all flag to use all parameter files in the directory.", [])
    .setAction(async ({ managers, deployController, all }, hre) => {
        const networkConfig = networkConfigName(hre);
        const configDir = `deployment/config/${networkConfig}`;
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        const managerParameterFiles = await getManagerFiles(all, configDir, managers);
        // optionally run the deploy together with controller
        if (deployController) {
            await deployAssetManagerController(hre, contracts, managerParameterFiles);
        } else {
            for (const paramFile of managerParameterFiles) {
                await deployAssetManager(hre, paramFile, contracts, true);
            }
        }
    });

task("verify-asset-manager", "Verify deployed asset manager.")
    .addParam("parametersFile", "The asset manager config file.")
    .setAction(async ({ parametersFile }, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await verifyAssetManager(hre, parametersFile, contracts);
    });

task("verify-asset-manager-controller", "Verify deployed asset manager controller.")
    .setAction(async ({ }, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await verifyAssetManagerController(hre, contracts);
    });

task("switch-to-production", "Switch all deployed files to production mode.")
    .setAction(async ({ }, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await switchAllToProductionMode(hre, contracts);
    });

async function getManagerFiles(all: boolean, configDir: string, managers: string[]) {
    if (all) {
        // get all files from the config dir
        const managerFiles = await fs.readdir(configDir, { withFileTypes: true });
        return managerFiles
            .filter(f => f.isFile() && f.name.endsWith('.json'))
            .map(f => path.join(configDir, f.name));
    } else if (managers.length > 0) {
        // use files provided on command line, optionally adding suffix '.json'
        return managers.map((name: string) => {
            const parts = path.parse(name);
            return path.join(configDir, `${parts.name}${parts.ext || '.json'}`);
        });
    } else {
        console.error('Provide a nonempty list of managers to deploy or --all to use all parameter files in the directory.');
        process.exit(1);
    }
}

export default config;
