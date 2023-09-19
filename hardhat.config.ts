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
    deployAgentVaultFactory, deployAssetManager, deployAssetManagerController, deployCollateralPoolFactory,
    deployCollateralPoolTokenFactory, deployPriceReader, deploySCProofVerifier, deployWhitelist, switchAllToProductionMode, verifyAssetManager, verifyAssetManagerController
} from "./deployment/lib/deploy-asset-manager";
import { linkContracts } from "./deployment/lib/link-contracts";
import "./type-extensions";

// import config used for compilation
import config from "./hardhatSetup.config";


task("link-contracts", "Link contracts with external libraries")
    .addVariadicPositionalParam("contracts", "The contract names to link")
    .addOptionalParam("mapfile", "Name for the map file with deployed library mapping addresses; if omitted, no map file is read or created")
    .setAction(async ({ contracts, mapfile }, hre) => {
        await linkContracts(hre, contracts, mapfile);
    });

task("deploy-asset-managers", "Deploy some or all asset managers. Optionally also deploys asset manager controller.")
    .addFlag("link", "Link asset manager before")
    .addFlag("deployController", "Also deploy AssetManagerController, AgentVaultFactory and SCProofVerifier")
    .addParam("networkConfig", "The network config name, e.g. `local`, `songbird`, `flare`. Must have matching directory deployment/config/${networkConfig} and file deployment/deploys/${networkConfig}.json containing contract addresses.")
    .addFlag("all", "Deploy all asset managers (for all parameter files in the directory)")
    .addVariadicPositionalParam("managers", "Asset manager file names (default extension is .json). Must be in the directory deployment/config/${networkConfig}. Alternatively, add -all flag to use all parameter files in the directory.", [])
    .setAction(async ({ networkConfig, managers, link, deployController, all }, hre) => {
        const configDir = `deployment/config/${networkConfig}`;
        const contractsFile = `deployment/deploys/${networkConfig}.json`;
        const managerParameterFiles = await getManagerFiles(all, configDir, managers);
        // optionally link the AssetManager
        if (link) {
            const mapfile = `deployment/deploys/${networkConfig}.libraries.json`
            await linkContracts(hre, ["AssetManager"], mapfile);
        }
        // optionally run the full deploy
        if (deployController) {
            await deploySCProofVerifier(hre, contractsFile);
            await deployPriceReader(hre, contractsFile);
            await deployWhitelist(hre, contractsFile, 'Agent');
            await deployWhitelist(hre, contractsFile, 'User');
            await deployAgentVaultFactory(hre, contractsFile);
            await deployCollateralPoolFactory(hre, contractsFile);
            await deployCollateralPoolTokenFactory(hre, contractsFile);
            await deployAssetManagerController(hre, contractsFile, managerParameterFiles);
        } else {
            for (const paramFile of managerParameterFiles) {
                await deployAssetManager(hre, paramFile, contractsFile, true);
            }
        }
    });

task("verify-asset-manager", "Verify deployed asset manager.")
    .addParam("networkConfig", "The network config name, e.g. `local`, `songbird`, `flare`. Must have matching directory deployment/config/${networkConfig} and file deployment/deploys/${networkConfig}.json containing contract addresses.")
    .addParam("address", "The asset manager address.")
    .addParam("parametersFile", "The asset manager config file.")
    .setAction(async ({ address, parametersFile, networkConfig }, hre) => {
        const contractsFile = `deployment/deploys/${networkConfig}.json`;
        await verifyAssetManager(hre, parametersFile, contractsFile, address);
    });

task("verify-asset-manager-controller", "Verify deployed asset manager controller.")
    .addParam("networkConfig", "The network config name, e.g. `local`, `songbird`, `flare`. Must have matching directory deployment/config/${networkConfig} and file deployment/deploys/${networkConfig}.json containing contract addresses.")
    .setAction(async ({ networkConfig }, hre) => {
        const contractsFile = `deployment/deploys/${networkConfig}.json`;
        await verifyAssetManagerController(hre, contractsFile);
    });

task("switch-to-production", "Switch all deployed files to production mode.")
    .addParam("networkConfig", "The network config name, e.g. `local`, `songbird`, `flare`. Must have matching directory deployment/config/${networkConfig} and file deployment/deploys/${networkConfig}.json containing contract addresses.")
    .setAction(async ({ networkConfig }, hre) => {
        const contractsFile = `deployment/deploys/${networkConfig}.json`;
        await switchAllToProductionMode(hre, contractsFile);
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
