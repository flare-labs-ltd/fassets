import hre from "hardhat";
import { runAsyncMain } from "../../lib/deploy-utils";
import { FAssetContractStore } from "../../lib/contracts";
import { loadDeployAccounts, networkConfigName, waitFinalize } from "../../lib/deploy-utils";

const IPriceReader = artifacts.require('IPriceReader');
const FakePriceReader = artifacts.require('FakePriceReader');

const SUPPORTED_SYMBOLS = ["CFLR", "testBTC", "testXRP", "testDOGE", "testETH", "testUSDC", "testUSDT"];

// only use when deploying on full flare deploy on hardhat local network (i.e. `deploy_local_hardhat_commands` was run in flare-smart-contracts project)
runAsyncMain(async () => {
    const network = networkConfigName(hre);
    const contractsFile = `deployment/deploys/${network}.json`;
    const contracts = new FAssetContractStore(contractsFile, true);
    await deployFakePriceReader(contracts);
});

async function deployFakePriceReader(contracts: FAssetContractStore) {
    // create token
    const { deployer } = loadDeployAccounts(hre);
    const priceReader = await waitFinalize(hre, deployer, () => FakePriceReader.new(deployer, { from: deployer}));
    // set initial prices
    const ftsoPriceReader = await IPriceReader.at(contracts.PriceReader!.address);
    for (const symbol of SUPPORTED_SYMBOLS) {
        const { 0: price, 1: timestamp, 2: decimals } = await ftsoPriceReader.getPrice(symbol);
        console.log(`Setting price for ${symbol}, decimals=${decimals} price=${price}`);
        await waitFinalize(hre, deployer, () => priceReader.setDecimals(symbol, decimals, { from: deployer }));
        await waitFinalize(hre, deployer, () => priceReader.setPrice(symbol, price, { from: deployer }));
        await waitFinalize(hre, deployer, () => priceReader.setPriceFromTrustedProviders(symbol, price, { from: deployer }));
    }
    // priceReader.
    contracts.add("FakePriceReader", 'FakePriceReader.sol', priceReader.address);
}
