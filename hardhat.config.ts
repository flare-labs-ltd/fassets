// import config used for compilation
import config from "./hardhatSetup.config";

import "@nomiclabs/hardhat-ethers";
// Use also truffle and web3 for backward compatibility
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

extendEnvironment((hre) => {
    hre.getChainConfigParameters = getChainConfigParameters;
});

// // Rig up deployment tasks
// task("deploy-contracts", "Deploy all contracts")
//     .addFlag("quiet", "Suppress console output")
//     .setAction(async (args, hre, runSuper) => {
//         const parameters = getChainConfigParameters(process.env.CHAIN_CONFIG);
//         if (parameters) {
//             await deployContracts(hre, parameters, args.quiet);
//         } else {
//             throw Error("CHAIN_CONFIG environment variable not set. Must be parameter json file name.")
//         }
//     });

export default config;
