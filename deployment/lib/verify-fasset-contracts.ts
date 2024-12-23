import { glob } from "glob";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CollateralClass } from "../../lib/fasset/AssetManagerTypes";
import { web3DeepNormalize } from "../../lib/utils/web3normalize";
import { Contract, ContractStore, FAssetContractStore } from "./contracts";
import { assetManagerParameters, convertCollateralType, createAssetManagerSettings } from "./deploy-asset-manager";
import { assetManagerFacets, assetManagerFacetsDeployedByDiamondCut, createDiamondCutsForAllAssetManagerFacets } from "./deploy-asset-manager-facets";
import { abiEncodeCall, loadDeployAccounts } from "./deploy-utils";

export async function verifyContract(hre: HardhatRuntimeEnvironment, contractNameOrAddress: string, contracts: FAssetContractStore, constructorArgs: string[], force: boolean) {
    const contract = contracts.get(contractNameOrAddress) ?? contracts.list().find(c => c.address === contractNameOrAddress);
    if (contract == null) {
        throw new Error(`Unknow contract ${contractNameOrAddress}`);
    }
    constructorArgs = constructorArgs.map(arg => {
        if (arg.startsWith('@')) return contracts.getAddress(arg.slice(1));
        return arg;
    });
    await hre.run("verify:verify", {
        address: contract.address,
        constructorArguments: constructorArgs,
        contract: await qualifiedName(contract),
        force: force
    });
}

export async function verifyAssetManager(hre: HardhatRuntimeEnvironment, parametersFile: string, contracts: FAssetContractStore) {
    const artifacts = hre.artifacts as Truffle.Artifacts;

    const IIAssetManager = artifacts.require("IIAssetManager");
    const AssetManagerInit = artifacts.require("AssetManagerInit");
    const FAsset = artifacts.require('FAsset');

    const { deployer } = loadDeployAccounts(hre);
    const parameters = assetManagerParameters.load(parametersFile);

    const assetManagerContractName = `AssetManager_${parameters.fAssetSymbol}`;
    const assetManagerContract = contracts.getRequired(assetManagerContractName);
    const assetManagerAddress = assetManagerContract.address;

    console.log(`Verifying ${assetManagerContractName} at ${assetManagerAddress}...`);

    const assetManager = await IIAssetManager.at(assetManagerAddress);

    const fAsset = await FAsset.at(await assetManager.fAsset());

    const poolCollateral = convertCollateralType(contracts, parameters.poolCollateral, CollateralClass.POOL);
    const vaultCollateral = parameters.vaultCollaterals.map(p => convertCollateralType(contracts, p, CollateralClass.VAULT));
    const collateralTypes = [poolCollateral, ...vaultCollateral];

    const assetManagerSettings = web3DeepNormalize(createAssetManagerSettings(contracts, parameters, fAsset));

    const assetManagerInitAddress = contracts.getRequired('AssetManagerInit').address;
    const diamondCuts = await createDiamondCutsForAllAssetManagerFacets(hre, contracts);

    const initParameters = abiEncodeCall(await AssetManagerInit.at(assetManagerInitAddress),
        c => c.init(contracts.GovernanceSettings.address, deployer, assetManagerSettings, collateralTypes));

    await hre.run("verify:verify", {
        address: assetManagerAddress,
        constructorArguments: [diamondCuts, assetManagerInitAddress, initParameters],
        contract: await qualifiedName(assetManagerContract)
    });

    const fAssetContract = contracts.getRequired(parameters.fAssetSymbol);

    await hre.run("verify:verify", {
        address: fAsset.address,
        constructorArguments: [fAssetContract.address, parameters.fAssetName, parameters.fAssetSymbol, parameters.assetName, parameters.assetSymbol, parameters.assetDecimals],
        contract: await qualifiedName(fAssetContract),
        force: true
    });
}

export async function verifyAssetManagerController(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    const { deployer } = loadDeployAccounts(hre);
    await hre.run("verify:verify", {
        address: contracts.AssetManagerController!.address,
        constructorArguments: [contracts.getAddress('AssetManagerControllerImplementation'), contracts.GovernanceSettings.address, deployer, contracts.AddressUpdater.address],
        contract: await qualifiedName(contracts.AssetManagerController!)
    });
}

export async function verifyAllAssetManagerFacets(hre: HardhatRuntimeEnvironment, contracts: ContractStore) {
    for (const facetName of [...assetManagerFacets, ...assetManagerFacetsDeployedByDiamondCut]) {
        try {
            console.log(`Verifying facet ${facetName}...`);
            const contract = contracts.getRequired(facetName);
            await hre.run("verify:verify", {
                address: contract.address,
                constructorArguments: [],
                contract: await qualifiedName(contract)
            });
        } catch (error) {
            console.error(`!!! Error verifying facet ${facetName}: ${error}`);
        }
    }
}

async function qualifiedName(contract: Contract) {
    const artifact = await findArtifact(contract.contractName);
    return `${artifact}:${contract.contractName.replace(/\.sol$/, "")}`;
}

async function findArtifact(fname: string) {
    const allPathsX = await glob(`**/${fname}`, { cwd: 'artifacts/' });
    const allPaths = allPathsX.map(pth => pth.replace(/\\/g, '/'));
    if (allPaths.length === 0) {
        throw new Error(`Artifact ${fname} not found`);
    } else if (allPaths.length >= 2) {
        throw new Error(`Multiple paths for artifact ${fname}: ${JSON.stringify(allPaths)}`);
    }
    return allPaths[0];
}
