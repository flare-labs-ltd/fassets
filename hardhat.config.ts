import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-web3";
import "@tenderly/hardhat-tenderly";
import * as dotenv from "dotenv";
import "hardhat-contract-sizer";
import 'hardhat-deploy';
import "hardhat-gas-reporter";
import { extendEnvironment, task } from "hardhat/config";
import path from "path";
import 'solidity-coverage';
import { deployAgentVaultFactory, deployAssetManager, deployAssetManagerController, deployAttestationClient } from "./deployment/lib/deploy-asset-manager";
import { linkContracts } from "./deployment/lib/link-contracts";
import "./type-extensions";

// import config used for compilation
import config from "./hardhatSetup.config";


dotenv.config();

function getChainConfigParameters(chainConfig: string | undefined): any {
    if (chainConfig) {
        const parameters = require(`./deployment/chain-config/${process.env.CHAIN_CONFIG}.json`)

        // inject private keys from .env, if they exist
        if (process.env.DEPLOYER_PRIVATE_KEY) {
            parameters.deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
        }
        if (process.env.GENESIS_GOVERNANCE_PRIVATE_KEY) {
            parameters.genesisGovernancePrivateKey = process.env.GENESIS_GOVERNANCE_PRIVATE_KEY
        }
        if (process.env.GOVERNANCE_PRIVATE_KEY) {
            parameters.governancePrivateKey = process.env.GOVERNANCE_PRIVATE_KEY
        }
        if (process.env.GOVERNANCE_PUBLIC_KEY) {
            parameters.governancePublicKey = process.env.GOVERNANCE_PUBLIC_KEY
        }
        // verifyParameters(parameters);
        return parameters;
    } else {
        return undefined;
    }
}

task("link-contracts", "Link contracts with external libraries")
    .addVariadicPositionalParam("contracts", "The contract names to link")
    .addOptionalParam("mapfile", "Name for the map file with deployed library mapping addresses; if omitted, no map file is read or created")
    .setAction(async ({ contracts, mapfile }, hre) => {
        await linkContracts(hre, contracts, mapfile);
    });

task("deploy-asset-manager-controller", "Deploy attestation client, agent vault factory, asset manager controller and asset managers")
    .addParam("networkConfig", "The network config name, e.g. `local`, `songbird`, `flare`. Must have matching directory deployment/config/${networkConfig} and file deployment/deploys/${networkConfig}.json containing contract addresses.")
    .addFlag("link", "Link asset manager before")
    .setAction(async ({ networkConfig, link }, hre) => {
        if (link) {
            await linkContracts(hre, ["AssetManager"], null);
        }
        const parametersFile = `deployment/config/${networkConfig}/asset-manager-controller.json`;
        const contractsFile = `deployment/deploys/${networkConfig}.json`;
        await deployAttestationClient(hre, contractsFile);
        await deployAgentVaultFactory(hre, contractsFile);
        await deployAssetManagerController(hre, parametersFile, contractsFile);
    });

task("deploy-asset-manager", "Deploy a single asset manager. Asset manager controller must be already deployed.")
    .addParam("networkConfig", "The network config name, e.g. `local`, `songbird`, `flare`. Must have matching directory deployment/config/${networkConfig} and file deployment/deploys/${networkConfig}.json containing contract addresses.")
    .addVariadicPositionalParam("managers", "Asset manager file names (default extension is .json). Must be in the directory deployment/config/${networkConfig}.")
    .addFlag("link", "Link asset manager before")
    .setAction(async ({ networkConfig, managers, link }, hre) => {
        if (link) {
            await linkContracts(hre, ["AssetManager"], null);
        }
        const controllerParametersFile = `deployment/config/${networkConfig}/asset-manager-controller.json`;
        const contractsFile = `deployment/deploys/${networkConfig}.json`;
        for (const manager of managers as string[]) {
            const parts = path.parse(manager);
            const managerParametersFile = `deployment/config/${networkConfig}/${parts.name}${parts.ext || '.json'}`;
            await deployAssetManager(hre, controllerParametersFile, managerParametersFile, contractsFile, true);
        }
    });

extendEnvironment((hre) => {
    hre.getChainConfigParameters = getChainConfigParameters;
});

export default config;
