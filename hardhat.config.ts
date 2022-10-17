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
import 'solidity-coverage';
import "./type-extensions";
import { linkContracts } from "./deployment/lib/link-contracts";

// import config used for compilation
import config from "./hardhatSetup.config";
import { deployAgentVaultFactory, deployAssetManagerController, deployAttestationClient } from "./deployment/lib/deploy-asset-manager";


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
    .addOptionalParam("mapfile", "Name for the map file with deployed library mapping addresses; if omitted, no map file is created")
    .setAction(async ({ contracts, mapfile }, hre) => {
        await linkContracts(hre, contracts, mapfile);
    });

task("deploy-fasset-contracts", "Deploy attestation client, agent vault factory, asset manager controller and asset managers")
    .addPositionalParam("networkConfig", "The network config name, e.g. `local`, `songbird`, `flare`. Must have matching directory deployment/config/${networkConfig} and file deployment/deploys/${networkConfig}.json containing contract addresses.")
    .setAction(async ({ networkConfig }, hre) => {
        const parametersFile = `deployment/config/${networkConfig}/asset-manager-controller.json`;
        const contractsFile = `deployment/deploys/${networkConfig}.json`;
        await deployAttestationClient(hre, contractsFile);
        await deployAgentVaultFactory(hre, contractsFile);
        await deployAssetManagerController(hre, parametersFile, contractsFile);
    });

extendEnvironment((hre) => {
    hre.getChainConfigParameters = getChainConfigParameters;
});

export default config;
