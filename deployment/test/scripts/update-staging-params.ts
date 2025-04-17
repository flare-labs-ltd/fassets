import hre from "hardhat";
import { runAsyncMain } from "../../lib/deploy-utils";
import { FAssetContractStore } from "../../lib/contracts";
import { loadDeployAccounts, networkConfigName, waitFinalize } from "../../lib/deploy-utils";

const AssetManager = artifacts.require("IIAssetManager");

runAsyncMain(async () => {
    const networkConfig = networkConfigName(hre);
    const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, false);
    const { deployer } = loadDeployAccounts(hre);

    const managerNames = ["AssetManager_FTestBTC", "AssetManager_FTestDOGE", "AssetManager_FTestXRP", "AssetManager_FSimCoinX"];
    // const managerNames = ["AssetManager_FTestXRP"];

    for (const name of managerNames) {
        const address = contracts.getAddress(name);
        const am = await AssetManager.at(address);
        // await waitFinalize(hre, deployer, () => am.setCoreVaultTransferTimeExtensionSeconds(7200, { from: deployer }));
        // await waitFinalize(hre, deployer, () => am.setCoreVaultRedemptionFeeBIPS(0, { from: deployer }));
        // await waitFinalize(hre, deployer, () => am.setCoreVaultMinimumAmountLeftBIPS(2000, { from: deployer }));
    }
});
