import { runAsyncMain } from "../../../lib/utils/helpers";
import { ChainContracts, loadContracts, newContract, saveContracts } from "../../lib/contracts";
import { requiredEnvironmentVariable } from "../../lib/deploy-utils";

const ERC20Mock = artifacts.require('ERC20Mock');

// only use when deploying on full flare deploy on hardhat local network (i.e. `deploy_local_hardhat_commands` was run in flare-smart-contracts project)
runAsyncMain(async () => {
    const network = requiredEnvironmentVariable('NETWORK_CONFIG');
    const contractsFile = `deployment/deploys/${network}.json`;
    const contracts = loadContracts(contractsFile);
    await deployStablecoin(contracts, "USDCoin", "USDC");
    await deployStablecoin(contracts, "Tether", "USDT");
    saveContracts(contractsFile, contracts);
});

async function deployStablecoin(contracts: ChainContracts, name: string, symbol: string) {
    // create token
    const token = await ERC20Mock.new(name, symbol);
    contracts[symbol] = newContract(symbol, 'ERC20Mock.sol', token.address);
}
