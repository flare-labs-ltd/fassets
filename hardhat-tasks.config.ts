import "dotenv/config";

import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-web3";
import fs from "fs/promises";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import { task } from "hardhat/config";
import path from "path";
import 'solidity-coverage';
import { FAssetContractStore } from "./deployment/lib/contracts";
import { deployAssetManager, deployAssetManagerController, switchAllToProductionMode } from "./deployment/lib/deploy-asset-manager";
import { deployAgentOwnerRegistry, deployAgentVaultFactory, deployCollateralPoolFactory, deployCollateralPoolTokenFactory, deployUserWhitelist } from "./deployment/lib/deploy-asset-manager-dependencies";
import { deployCuts } from "./deployment/lib/deploy-cuts";
import { deployPriceReaderV2, verifyFtsoV2PriceStore } from "./deployment/lib/deploy-ftsov2-price-store";
import { networkConfigName } from "./deployment/lib/deploy-utils";
import { linkContracts } from "./deployment/lib/link-contracts";
import { verifyAllAssetManagerFacets, verifyAssetManager, verifyAssetManagerController, verifyContract } from "./deployment/lib/verify-fasset-contracts";
import "./type-extensions";


task("link-contracts", "Link contracts with external libraries")
    .addVariadicPositionalParam("contracts", "The contract names to link")
    .addOptionalParam("mapfile", "Name for the map file with deployed library mapping addresses; if omitted, no map file is read or created")
    .setAction(async ({ contracts, mapfile }, hre) => {
        await linkContracts(hre, contracts, mapfile);
    });

task("deploy-price-reader-v2", "Deploy price reader v2.")
    .setAction(async ({}, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await deployPriceReaderV2(hre, contracts);
    });

task("deploy-asset-manager-dependencies", "Deploy some or all asset managers. Optionally also deploys asset manager controller.")
    .setAction(async ({}, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await deployAgentOwnerRegistry(hre, contracts);
        await deployUserWhitelist(hre, contracts);
        await deployAgentVaultFactory(hre, contracts);
        await deployCollateralPoolFactory(hre, contracts);
        await deployCollateralPoolTokenFactory(hre, contracts);
    });

task("deploy-asset-managers", "Deploy some or all asset managers. Optionally also deploys asset manager controller.")
    .addFlag("deployController", "Also deploy AssetManagerController, AgentVaultFactory and FdcVerification")
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

task("verify-contract", "Verify a contract in contracts.json.")
    .addFlag("force", "re-verify partially verified contract")
    .addPositionalParam("contract", "name or address of the contract to verify.")
    .addVariadicPositionalParam("constructorArgs", "constructor arguments", [])
    .setAction(async ({ force, contract, constructorArgs }, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await verifyContract(hre, contract, contracts, constructorArgs, force);
    });

task("verify-asset-manager", "Verify deployed asset manager.")
    .addParam("parametersFile", "The asset manager config file.")
    .setAction(async ({ parametersFile }, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await verifyAssetManager(hre, parametersFile, contracts);
    });

task("verify-asset-manager-controller", "Verify deployed asset manager controller.")
    .setAction(async ({}, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await verifyAssetManagerController(hre, contracts);
    });

task("verify-price-reader-v2", "Verify deployed price reader v2.")
    .setAction(async ({}, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await verifyFtsoV2PriceStore(hre, contracts);
    });

task("verify-asset-manager-facets", "Verify all asset manager facets.")
    .setAction(async ({ }, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await verifyAllAssetManagerFacets(hre, contracts);
    });

task("switch-to-production", "Switch all deployed files to production mode.")
    .setAction(async ({}, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await switchAllToProductionMode(hre, contracts);
    });

task("diamond-cut", "Create diamond cut defined by JSON file.")
    .addPositionalParam("json", "Diamond cut JSON definition file")
    .addFlag("execute", "Execute diamond cut; if not set, just print calldata. Execute is automatically disabled in production mode.")
    .setAction(async ({ json, execute }, hre) => {
        const networkConfig = networkConfigName(hre);
        const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
        await deployCuts(hre, contracts, json, { execute: execute, verbose: true });
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
