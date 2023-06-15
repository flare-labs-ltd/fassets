import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-web3";
import * as dotenv from "dotenv";
import fs from "fs";
import glob from "glob";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import { TASK_COMPILE, TASK_TEST_GET_TEST_FILES } from 'hardhat/builtin-tasks/task-names';
import { HardhatUserConfig, task } from "hardhat/config";
import path from "path";
import 'solidity-coverage';
import "./type-extensions";
import { trace } from "./lib/utils/helpers";
const intercept = require('intercept-stdout');

// allow glob patterns in test file args
task(TASK_TEST_GET_TEST_FILES, async ({ testFiles }: { testFiles: string[] }, { config }) => {
    const cwd = process.cwd();
    if (testFiles.length === 0) {
        const testPath = path.relative(cwd, config.paths.tests).replace(/\\/g, '/');    // glob doesn't work with windows paths
        testFiles = [testPath + '/**/*.{js,ts}'];
    }
    return testFiles.flatMap(pattern => glob.sync(pattern) as string[])
        .map(fname => path.resolve(cwd, fname));
});

// Override solc compile task and filter out useless warnings
task(TASK_COMPILE)
    .setAction(async (args, hre, runSuper) => {
        intercept((text: any) => {
            if (/MockContract.sol/.test(text) && text.match(/Warning: SPDX license identifier not provided in source file/)) return '';
            if (/MockContract.sol/.test(text) &&
                /Warning: This contract has a payable fallback function, but no receive ether function/.test(text)) return '';
            if (/FlareSmartContracts.sol/.test(text) &&
                /Warning: Visibility for constructor is ignored./.test(text)) return '';
            if (/VPToken.sol/.test(text) &&
                /Warning: Visibility for constructor is ignored./.test(text)) return '';
            if (/ReentrancyGuard.sol/.test(text) &&
                /Warning: Visibility for constructor is ignored/.test(text)) return '';
            return text;
        });
        await runSuper(args);
    });

dotenv.config();

let accounts = [
    // In Truffle, default account is always the first one.
    ...(process.env.DEPLOYER_PRIVATE_KEY ? [{ privateKey: process.env.DEPLOYER_PRIVATE_KEY, balance: "100000000000000000000000000000000" }] : []),
    ...JSON.parse(fs.readFileSync('test-1020-accounts.json').toString()).slice(0, process.env.TENDERLY == 'true' ? 150 : 2000).filter((x: any) => x.privateKey != process.env.DEPLOYER_PRIVATE_KEY),
    ...(process.env.GENESIS_GOVERNANCE_PRIVATE_KEY ? [{ privateKey: process.env.GENESIS_GOVERNANCE_PRIVATE_KEY, balance: "100000000000000000000000000000000" }] : []),
    ...(process.env.GOVERNANCE_PRIVATE_KEY ? [{ privateKey: process.env.GOVERNANCE_PRIVATE_KEY, balance: "100000000000000000000000000000000" }] : []),
];

const config: HardhatUserConfig = {
    defaultNetwork: "hardhat",

    networks: {
        develop: {
            url: "http://127.0.0.1:9650/ext/bc/C/rpc",
            gas: 10000000,
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        scdev: {
            url: "http://127.0.0.1:9650/ext/bc/C/rpc",
            gas: 8000000,
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        staging: {
            url: process.env.STAGING_RPC || "http://127.0.0.1:9650/ext/bc/C/rpc",
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        songbird: {
            url: process.env.SONGBIRD_RPC || "https://songbird-api.flare.network/ext/C/rpc",
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        flare: {
            url: process.env.FLARE_RPC || "https://flare-api.flare.network/ext/C/rpc",
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        coston: {
            url: process.env.COSTON_RPC || "https://coston-api.flare.network/ext/C/rpc",
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        coston2: {
            url: process.env.COSTON2_RPC || "https://coston2-api.flare.network/ext/C/rpc",
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        hardhat: {
            accounts,
            blockGasLimit: 125000000 // 10x ETH gas
        },
        local: {
            url: 'http://127.0.0.1:8545',
            chainId: 31337
        }
    },
    solidity: {
        compilers: [
            {
                version: "0.8.20",
                settings: {
                    evmVersion: "london",
                    optimizer: {
                        enabled: true,
                        runs: 200
                    }
                }
            },
            {
                version: "0.7.6",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200
                    }
                }
            }
        ],
        overrides: {
            "contracts/utils/Imports.sol": {
                version: "0.6.12",
                settings: {}
            },
            "@gnosis.pm/mock-contract/contracts/MockContract.sol": {
                version: "0.6.12",
                settings: {}
            }
        }
    },
    paths: {
        sources: "./contracts/",
        tests: process.env.TEST_PATH || "./test/{unit,integration}",
        cache: "./cache",
        artifacts: "./artifacts"
    },
    mocha: {
        timeout: 1000000000
    },
    gasReporter: {
        showTimeSpent: true,
        outputFile: ".gas-report.txt"
    }
};

export default config;
