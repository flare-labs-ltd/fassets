import { HardhatRuntimeEnvironment } from "hardhat/types";
import { FAssetContractStore } from "./contracts";
import { loadDeployAccounts, ZERO_ADDRESS } from "./deploy-utils";


export async function deploySCProofVerifier(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying SCProofVerifier`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const SCProofVerifier = artifacts.require("SCProofVerifier");

    const scProofVerifier = await SCProofVerifier.new(contracts.StateConnector.address);

    contracts.add("SCProofVerifier", "SCProofVerifier.sol", scProofVerifier.address);
}

export async function deployPriceReader(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying PriceReader`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const PriceReader = artifacts.require("FtsoV1PriceReader");

    const priceReader = await PriceReader.new(contracts.AddressUpdater.address, contracts.FtsoRegistry.address);

    contracts.add("PriceReader", "PriceReader.sol", priceReader.address);
}

export async function deployUserWhitelist(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying UserWhitelist`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const Whitelist = artifacts.require("Whitelist");

    const { deployer } = loadDeployAccounts(hre);

    const whitelist = await Whitelist.new(contracts.GovernanceSettings.address, deployer, false);

    contracts.add(`UserWhitelist`, "Whitelist.sol", whitelist.address, { mustSwitchToProduction: true });
}

export async function deployAgentOwnerRegistry(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying AgentOwnerRegistry`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AgentOwnerRegistry = artifacts.require("AgentOwnerRegistry");

    const { deployer } = loadDeployAccounts(hre);

    const whitelist = await AgentOwnerRegistry.new(contracts.GovernanceSettings.address, deployer, true);

    contracts.add("AgentOwnerRegistry", "AgentOwnerRegistry.sol", whitelist.address, { mustSwitchToProduction: true });
}

export async function deployAgentVaultFactory(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying AgentVaultFactory`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AgentVault = artifacts.require("AgentVault");
    const AgentVaultFactory = artifacts.require("AgentVaultFactory");

    const agentVaultImplementation = await AgentVault.new(ZERO_ADDRESS);
    const agentVaultFactory = await AgentVaultFactory.new(agentVaultImplementation.address);

    contracts.add("AgentVaultProxyImplementation", "AgentVault.sol", agentVaultImplementation.address);
    contracts.add("AgentVaultFactory", "AgentVaultFactory.sol", agentVaultFactory.address);
}

export async function deployCollateralPoolFactory(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying CollateralPoolFactory`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const CollateralPool = artifacts.require("CollateralPool");
    const CollateralPoolFactory = artifacts.require("CollateralPoolFactory");

    const collateralPoolImplementation = await CollateralPool.new(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, 0, 0, 0);
    const collateralPoolFactory = await CollateralPoolFactory.new(collateralPoolImplementation.address);

    contracts.add("CollateralPoolProxyImplementation", "CollateralPool.sol", collateralPoolImplementation.address);
    contracts.add("CollateralPoolFactory", "CollateralPoolFactory.sol", collateralPoolFactory.address);
}

export async function deployCollateralPoolTokenFactory(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying CollateralPoolTokenFactory`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const CollateralPoolToken = artifacts.require("CollateralPoolToken");
    const CollateralPoolTokenFactory = artifacts.require("CollateralPoolTokenFactory");

    const collateralPoolTokenImplementation = await CollateralPoolToken.new(ZERO_ADDRESS, "", "");
    const collateralPoolTokenFactory = await CollateralPoolTokenFactory.new(collateralPoolTokenImplementation.address);

    contracts.add("CollateralPoolTokenProxyImplementation", "CollateralPoolToken.sol", collateralPoolTokenImplementation.address);
    contracts.add("CollateralPoolTokenFactory", "CollateralPoolTokenFactory.sol", collateralPoolTokenFactory.address);
}
