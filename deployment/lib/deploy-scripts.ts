import hre from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { FAssetContractStore } from "./contracts";
import { loadDeployAccounts, networkConfigName, runAsyncMain } from "./deploy-utils";

export interface DeployScriptEnvironment {
    hre: HardhatRuntimeEnvironment;
    artifacts: Truffle.Artifacts;
    networkConfig: string;
    contracts: FAssetContractStore;
    deployer: string;
}

export function deployScriptEnvironment(): DeployScriptEnvironment {
    const artifacts = hre.artifacts as Truffle.Artifacts;
    const networkConfig = networkConfigName(hre);
    const contracts = new FAssetContractStore(`deployment/deploys/${networkConfig}.json`, true);
    const { deployer } = loadDeployAccounts(hre);
    return { hre, artifacts, networkConfig, contracts, deployer };
}

export function runDeployScript(script: (environment: DeployScriptEnvironment) => Promise<void>) {
    runAsyncMain(async () => {
        await script(deployScriptEnvironment());
    });
}
