import { deployFacet } from "../lib/deploy-asset-manager-facets";
import { runDeployScript } from "../lib/deploy-scripts";
import { verifyContract } from "../lib/verify-fasset-contracts";

runDeployScript(async ({ hre, artifacts, contracts, deployer }) => {
    const CoreVaultManager = artifacts.require("CoreVaultManager");

    const coreVaultManager = await CoreVaultManager.at(contracts.getAddress("CoreVaultManager_FTestXRP"));

    const newCoreVaultManagerImplAddress = await deployFacet(hre, "CoreVaultManagerImplementation", contracts, deployer, "CoreVaultManager");

    await coreVaultManager.upgradeTo(newCoreVaultManagerImplAddress, { from: deployer });

    await verifyContract(hre, "CoreVaultManagerImplementation", contracts);
});
