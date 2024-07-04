import hre from "hardhat";
import { runAsyncMain } from "../../../lib/utils/helpers";
import { FAssetContractStore } from "../../lib/contracts";
import { loadDeployAccounts, networkConfigName } from "../../lib/deploy-utils";

const FakeERC20 = artifacts.require('FakeERC20');

// only use when deploying on full flare deploy on hardhat local network (i.e. `deploy_local_hardhat_commands` was run in flare-smart-contracts project)
runAsyncMain(async () => {
    const network = networkConfigName(hre);
    const contracts = new FAssetContractStore(`deployment/deploys/${network}.json`, true);
    await deployStablecoin(contracts, "Test USDCoin", "testUSDC", 6);
    await deployStablecoin(contracts, "Test Tether", "testUSDT", 6);
    await deployStablecoin(contracts, "Test Ether", "testETH", 18);
});

async function deployStablecoin(contracts: FAssetContractStore, name: string, symbol: string, decimals: number) {
    // create token
    const { deployer } = loadDeployAccounts(hre);
    const token = await FakeERC20.new(contracts.GovernanceSettings.address, deployer, name, symbol, decimals);
    contracts.add(symbol, 'FakeERC20.sol', token.address, { mustSwitchToProduction: true });
}
