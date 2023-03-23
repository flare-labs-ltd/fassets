import { runAsyncMain, toBNExp } from "../../../lib/utils/helpers";
import { executeTimelockedGovernanceCall } from "../../../test/utils/contract-test-helpers";
import { ChainContracts, loadContracts, newContract, saveContracts } from "../../lib/contracts";

const IIFtsoManager = artifacts.require('IIFtsoManager');
const ERC20Mock = artifacts.require('ERC20Mock');
const FtsoMock = artifacts.require('FtsoMock');

// only use when deploying on full flare deploy on hardhat local network (i.e. `deploy_local_hardhat_commands` was run in flare-smart-contracts project)
runAsyncMain(async () => {
    const contractsFile = "deployment/deploys/hardhat.json";    // doesn't work with others
    const contracts = loadContracts(contractsFile);
    await deployStablecoinAndFtso(contracts, "USDCoin", "USDC", "FtsoUSDC", 5, 1.01);
    await deployStablecoinAndFtso(contracts, "Tether", "USDT", "FtsoUSDT", 5, 0.99);
    saveContracts(contractsFile, contracts);
});

async function deployStablecoinAndFtso(contracts: ChainContracts, name: string, symbol: string, ftsoName: string, decimals: number, initialPrice: number) {
    const ftsoManager = await IIFtsoManager.at(contracts.FtsoManager.address);
    // create token
    const token = await ERC20Mock.new(name, symbol);
    contracts[symbol] = newContract(symbol, 'ERC20Mock.sol', token.address);
    // create ftso
    const ftso = await FtsoMock.new(symbol, decimals);
    await ftso.setCurrentPrice(toBNExp(initialPrice, decimals), 0);
    await ftso.setCurrentPriceFromTrustedProviders(toBNExp(initialPrice, decimals), 0);
    contracts[ftsoName] = newContract(ftsoName, "Ftso.sol", ftso.address);
    // add ftso to FtsoManager (which adds it to FtsoRegistry)
    await executeTimelockedGovernanceCall(ftsoManager, (governance) => ftsoManager.addFtso(ftso.address, { from: governance }));

}
