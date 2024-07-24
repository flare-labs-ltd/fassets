import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CollateralClass } from "../../lib/fasset/AssetManagerTypes";
import { web3DeepNormalize } from "../../lib/utils/web3normalize";
import { FAssetContractStore } from "./contracts";
import { assetManagerParameters, convertCollateralType, createAssetManagerSettings } from "./deploy-asset-manager";
import { createDiamondCutsForAllAssetManagerFacets } from "./deploy-asset-manager-facets";
import { abiEncodeCall, loadDeployAccounts } from "./deploy-utils";

export async function verifyAssetManager(hre: HardhatRuntimeEnvironment, parametersFile: string, contracts: FAssetContractStore) {
    const artifacts = hre.artifacts as Truffle.Artifacts;

    const IIAssetManager = artifacts.require("IIAssetManager");
    const AssetManagerInit = artifacts.require("AssetManagerInit");
    const FAsset = artifacts.require('FAsset');

    const { deployer } = loadDeployAccounts(hre);
    const parameters = assetManagerParameters.load(parametersFile);

    const assetManagerContractName = `AssetManager_${parameters.fAssetSymbol}`;
    const assetManagerAddress = contracts.getRequired(assetManagerContractName).address;

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
        constructorArguments: [diamondCuts, assetManagerInitAddress, initParameters]
    });
}

export async function verifyFAssetToken(hre: HardhatRuntimeEnvironment, parametersFile: string, contracts: FAssetContractStore) {
    const { deployer } = loadDeployAccounts(hre);
    const parameters = assetManagerParameters.load(parametersFile);
    const fAssetAddress = contracts.getRequired(parameters.fAssetSymbol).address;
    console.log(`Verifying ${parameters.fAssetSymbol} at ${fAssetAddress}...`);
    await hre.run("verify:verify", {
        address: fAssetAddress,
        constructorArguments: [deployer, parameters.fAssetName, parameters.fAssetSymbol, parameters.assetName, parameters.assetSymbol, parameters.assetDecimals]
    });
}

export async function verifyAssetManagerController(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    const { deployer } = loadDeployAccounts(hre);
    await hre.run("verify:verify", {
        address: contracts.AssetManagerController!.address,
        constructorArguments: [contracts.GovernanceSettings.address, deployer, contracts.AddressUpdater.address]
    });
}

export async function verifyCollateralPool(hre: HardhatRuntimeEnvironment, poolAddress: string) {
    const artifacts = hre.artifacts as Truffle.Artifacts;

    const CollateralPool = artifacts.require("CollateralPool");
    const CollateralPoolToken = artifacts.require("CollateralPoolToken");

    const cp = await CollateralPool.at(poolAddress);
    const vault = await cp.agentVault();
    const assetManager = await cp.assetManager();
    const fasset = await cp.fAsset();
    const exitCollateralRatioBIPS = await cp.exitCollateralRatioBIPS();
    const topupCollateralRatioBIPS = await cp.topupCollateralRatioBIPS();
    const topupTokenPriceFactorBIPS = await cp.topupTokenPriceFactorBIPS();

    try {
        console.log(`Verifying CollateralPool at ${poolAddress}`);
        await hre.run("verify:verify", {
            address: poolAddress,
            constructorArguments: [vault, assetManager, fasset, String(exitCollateralRatioBIPS), String(topupCollateralRatioBIPS), String(topupTokenPriceFactorBIPS)]
        });
    } catch (e: any) {
        console.error(`Error verifying CollateralPool: ${e.message ?? e}`);
        process.exitCode = 1;
    }

    const tokenAddress = await cp.poolToken();
    const cpt = await CollateralPoolToken.at(tokenAddress);
    const cptName = await cpt.name();
    const cptSymbol = await cpt.symbol();

    try {
        console.log(`Verifying CollateralPoolToken at ${tokenAddress}`);
        await hre.run("verify:verify", {
            address: tokenAddress,
            constructorArguments: [poolAddress, cptName, cptSymbol]
        });
    } catch (e: any) {
        console.error(`Error verifying CollateralPoolToken: ${e.message ?? e}`);
        process.exitCode = 1;
    }
}
