import hre from "hardhat";
import { runAsyncMain, sleep } from "../../../lib/utils/helpers";
import { FAssetContractStore } from "../../lib/contracts";
import { loadDeployAccounts, networkConfigName } from "../../lib/deploy-utils";

const IFtsoRegistry = artifacts.require('flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol:IFtsoRegistry' as 'IFtsoRegistry');
const FtsoPriceReader = artifacts.require('FtsoV1PriceReader');
const FakePriceReader = artifacts.require('FakePriceReader');

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
    const priceReader = await FakePriceReader.new(deployer, { from: deployer});
    // set initial prices
    const ftsoRegistry = await IFtsoRegistry.at(contracts.FtsoRegistry.address);
    const ftsoPriceReader = await FtsoPriceReader.at(contracts.PriceReader!.address);
    const symbols = await ftsoRegistry.getSupportedSymbols();
    for (const symbol of symbols) {
        const { 0: price, 1: timestamp, 2: decimals } = await ftsoPriceReader.getPrice(symbol);
        console.log(`Setting price for ${symbol}, decimals=${decimals} price=${price}`);
        await priceReader.setDecimals(symbol, decimals, { from: deployer });
        await priceReader.setPrice(symbol, price, { from: deployer });
        await priceReader.setPriceFromTrustedProviders(symbol, price, { from: deployer });
        await sleep(5000);
    }
    // priceReader.
    contracts.add("FakePriceReader", 'FakePriceReader.sol', priceReader.address);
}
