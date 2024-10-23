import { HardhatRuntimeEnvironment } from "hardhat/types";
import { FAssetContractStore } from "./contracts";
import { loadDeployAccounts, waitFinalize, ZERO_ADDRESS } from "./deploy-utils";


export async function deployPriceReader(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying PriceReader`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const PriceReader = artifacts.require("FtsoV1PriceReader");

    const { deployer } = loadDeployAccounts(hre);

    const priceReader = await waitFinalize(hre, deployer, () => PriceReader.new(contracts.AddressUpdater.address, contracts.FtsoRegistry.address, { from: deployer }));

    contracts.add("PriceReader", "PriceReader.sol", priceReader.address);
}

export async function deployUserWhitelist(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying UserWhitelist`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const Whitelist = artifacts.require("Whitelist");

    const { deployer } = loadDeployAccounts(hre);

    const whitelist = await waitFinalize(hre, deployer, () => Whitelist.new(contracts.GovernanceSettings.address, deployer, false, { from: deployer }));

    contracts.add(`UserWhitelist`, "Whitelist.sol", whitelist.address, { mustSwitchToProduction: true });
}

export async function deployAgentOwnerRegistry(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying AgentOwnerRegistry`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AgentOwnerRegistry = artifacts.require("AgentOwnerRegistry");

    const { deployer } = loadDeployAccounts(hre);

    const whitelist = await waitFinalize(hre, deployer, () => AgentOwnerRegistry.new(contracts.GovernanceSettings.address, deployer, true, { from: deployer }));

    contracts.add("AgentOwnerRegistry", "AgentOwnerRegistry.sol", whitelist.address, { mustSwitchToProduction: true });
}

export async function deployAgentVaultFactory(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying AgentVaultFactory`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AgentVault = artifacts.require("AgentVault");
    const AgentVaultFactory = artifacts.require("AgentVaultFactory");

    const { deployer } = loadDeployAccounts(hre);

    const agentVaultImplementation = await waitFinalize(hre, deployer, () => AgentVault.new(ZERO_ADDRESS, { from: deployer }));
    const agentVaultFactory = await waitFinalize(hre, deployer, () => AgentVaultFactory.new(agentVaultImplementation.address, { from: deployer }));

    contracts.add("AgentVaultProxyImplementation", "AgentVault.sol", agentVaultImplementation.address);
    contracts.add("AgentVaultFactory", "AgentVaultFactory.sol", agentVaultFactory.address);
}

export async function deployCollateralPoolFactory(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying CollateralPoolFactory`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const CollateralPool = artifacts.require("CollateralPool");
    const CollateralPoolFactory = artifacts.require("CollateralPoolFactory");

    const { deployer } = loadDeployAccounts(hre);

    const collateralPoolImplementation = await waitFinalize(hre, deployer, () => CollateralPool.new(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, 0, 0, 0, { from: deployer }));
    const collateralPoolFactory = await waitFinalize(hre, deployer, () => CollateralPoolFactory.new(collateralPoolImplementation.address, { from: deployer }));

    contracts.add("CollateralPoolProxyImplementation", "CollateralPool.sol", collateralPoolImplementation.address);
    contracts.add("CollateralPoolFactory", "CollateralPoolFactory.sol", collateralPoolFactory.address);
}

export async function deployCollateralPoolTokenFactory(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying CollateralPoolTokenFactory`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const CollateralPoolToken = artifacts.require("CollateralPoolToken");
    const CollateralPoolTokenFactory = artifacts.require("CollateralPoolTokenFactory");

    const { deployer } = loadDeployAccounts(hre);

    const collateralPoolTokenImplementation = await waitFinalize(hre, deployer, () => CollateralPoolToken.new(ZERO_ADDRESS, "", "", { from: deployer }));
    const collateralPoolTokenFactory = await waitFinalize(hre, deployer, () => CollateralPoolTokenFactory.new(collateralPoolTokenImplementation.address, { from: deployer }));

    contracts.add("CollateralPoolTokenProxyImplementation", "CollateralPoolToken.sol", collateralPoolTokenImplementation.address);
    contracts.add("CollateralPoolTokenFactory", "CollateralPoolTokenFactory.sol", collateralPoolTokenFactory.address);
}
