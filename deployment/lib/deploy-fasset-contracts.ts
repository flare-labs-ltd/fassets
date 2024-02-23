import { encodeAttestationName } from "@flarenetwork/state-connector-protocol";
import BN from "bn.js";
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { AssetManagerSettings, CollateralClass, CollateralType } from '../../lib/fasset/AssetManagerTypes';
import { web3DeepNormalize } from "../../lib/utils/web3normalize";
import { FAssetInstance } from "../../typechain-truffle";
import { JsonParameterSchema } from "./JsonParameterSchema";
import { AssetManagerParameters, CollateralTypeParameters } from './asset-manager-parameters';
import { FAssetContractStore } from "./contracts";
import { createDiamondCutsForAllAssetManagerFacets, deployAllAssetManagerFacets, deployFacet } from "./deploy-asset-manager-facets";
import { ZERO_ADDRESS, abiEncodeCall, loadDeployAccounts } from './deploy-utils';

export const assetManagerParameters = new JsonParameterSchema<AssetManagerParameters>(require('../config/asset-manager-parameters.schema.json'));

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

    const AgentVaultFactory = artifacts.require("AgentVaultFactory");

    const agentVaultFactory = await AgentVaultFactory.new();

    contracts.add("AgentVaultFactory", "AgentVaultFactory.sol", agentVaultFactory.address);
}

export async function deployCollateralPoolFactory(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying CollateralPoolFactory`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const CollateralPoolFactory = artifacts.require("CollateralPoolFactory");

    const collateralPoolFactory = await CollateralPoolFactory.new();

    contracts.add("CollateralPoolFactory", "CollateralPoolFactory.sol", collateralPoolFactory.address);
}

export async function deployCollateralPoolTokenFactory(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying CollateralPoolTokenFactory`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const CollateralPoolTokenFactory = artifacts.require("CollateralPoolTokenFactory");

    const collateralPoolTokenFactory = await CollateralPoolTokenFactory.new();

    contracts.add("CollateralPoolTokenFactory", "CollateralPoolTokenFactory.sol", collateralPoolTokenFactory.address);
}

export async function deployAssetManagerController(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore, managerParameterFiles: string[]) {
    const artifacts = hre.artifacts as Truffle.Artifacts;

    console.log(`Deploying AssetManagerController`);

    const AssetManagerController = artifacts.require("AssetManagerController");

    const { deployer } = loadDeployAccounts(hre);

    const assetManagerController = await AssetManagerController.new(contracts.GovernanceSettings.address, deployer, contracts.AddressUpdater.address);

    contracts.add("AssetManagerController", "AssetManagerController.sol", assetManagerController.address, { mustSwitchToProduction: true });

    // add asset managers before switching to production governance
    for (const parameterFile of managerParameterFiles) {
        console.log(`   deploying AssetManager with config ${parameterFile}`);
        const assetManager = await deployAssetManager(hre, parameterFile, contracts, false);
        await assetManagerController.addAssetManager(assetManager.address, { from: deployer });
    }

    console.log(`NOTE: perform governance call 'AddressUpdater(${contracts.AddressUpdater.address}).addOrUpdateContractNamesAndAddresses(["AssetManagerController"], [${assetManagerController.address}])'`);
}

// assumes AssetManager contract artifact has been linked already
export async function deployAssetManager(hre: HardhatRuntimeEnvironment, parametersFile: string, contracts: FAssetContractStore, standalone: boolean) {
    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AssetManager = artifacts.require("AssetManager");
    const AssetManagerInit = artifacts.require("AssetManagerInit");
    const FAsset = artifacts.require('FAsset');

    const { deployer } = loadDeployAccounts(hre);
    const parameters = assetManagerParameters.load(parametersFile);

    const fAsset = await FAsset.new(deployer, parameters.fAssetName, parameters.fAssetSymbol, parameters.assetName, parameters.assetSymbol, parameters.assetDecimals);

    const poolCollateral = convertCollateralType(contracts, parameters.poolCollateral, CollateralClass.POOL);
    const vaultCollateral = parameters.vaultCollaterals.map(p => convertCollateralType(contracts, p, CollateralClass.VAULT));
    const collateralTypes = [poolCollateral, ...vaultCollateral];

    const assetManagerSettings = web3DeepNormalize(createAssetManagerSettings(contracts, parameters, fAsset));

    // deploy asset manager diamond
    const assetManagerInitAddress = await deployFacet(hre, 'AssetManagerInit', contracts);
    await deployAllAssetManagerFacets(hre, contracts);

    const diamondCuts = await createDiamondCutsForAllAssetManagerFacets(hre, contracts);

    const initParameters = abiEncodeCall(await AssetManagerInit.at(assetManagerInitAddress),
        c => c.init(contracts.GovernanceSettings.address, deployer, assetManagerSettings, collateralTypes));

    const assetManager = await AssetManager.new(diamondCuts, assetManagerInitAddress, initParameters);

    await fAsset.setAssetManager(assetManager.address, { from: deployer });

    const symbol = parameters.fAssetSymbol;
    contracts.add(`AssetManager_${symbol}`, "AssetManager.sol", assetManager.address);
    contracts.add(symbol, "FAsset.sol", fAsset.address, { mustSwitchToProduction: true });

    if (standalone) {
        console.log(`NOTE: perform governance call 'AssetManagerController(${contracts.AssetManagerController?.address}).addAssetManager(${assetManager.address})'`);
    }

    return assetManager;
}

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

export async function verifyAssetManagerController(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    const { deployer } = loadDeployAccounts(hre);
    await hre.run("verify:verify", {
        address: contracts.AssetManagerController!.address,
        constructorArguments: [contracts.GovernanceSettings.address, deployer, contracts.AddressUpdater.address]
    });
}

export async function switchAllToProductionMode(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    const { deployer } = loadDeployAccounts(hre);

    const GovernedBase = artifacts.require("contracts/governance/implementation/GovernedBase.sol:GovernedBase" as 'GovernedBase');

    for (const contract of contracts.list()) {
        if (contract?.mustSwitchToProduction) {
            console.log(`Switching to production: ${contract.name}`);
            const instance = await GovernedBase.at(contract.address);
            await instance.switchToProductionMode({ from: deployer });
            delete contract.mustSwitchToProduction;
            contracts.save();
        }
    }
}

function addressFromParameter(contracts: FAssetContractStore, addressOrName: string) {
    if (addressOrName.startsWith('0x')) return addressOrName;
    const contract = contracts.get(addressOrName);
    if (contract != null) return contract.address;
    throw new Error(`Missing contract ${addressOrName}`);
}

function parseBN(s: string) {
    return new BN(s.replace(/_/g, ''), 10);
}

function convertCollateralType(contracts: FAssetContractStore, parameters: CollateralTypeParameters, collateralClass: CollateralClass): CollateralType {
    return {
        collateralClass: collateralClass,
        token: addressFromParameter(contracts, parameters.token),
        decimals: parameters.decimals,
        validUntil: 0,  // not deprecated
        directPricePair: parameters.directPricePair,
        assetFtsoSymbol: parameters.assetFtsoSymbol,
        tokenFtsoSymbol: parameters.tokenFtsoSymbol,
        minCollateralRatioBIPS: parameters.minCollateralRatioBIPS,
        ccbMinCollateralRatioBIPS: parameters.ccbMinCollateralRatioBIPS,
        safetyMinCollateralRatioBIPS: parameters.safetyMinCollateralRatioBIPS,
    }
}

function createAssetManagerSettings(contracts: FAssetContractStore, parameters: AssetManagerParameters, fAsset: FAssetInstance): AssetManagerSettings {
    if (!contracts.AssetManagerController || !contracts.AgentVaultFactory || !contracts.SCProofVerifier || !contracts.CollateralPoolFactory) {
        throw new Error("Missing contracts");
    }
    const ten = new BN(10);
    const assetUnitUBA = ten.pow(new BN(parameters.assetDecimals));
    const assetMintingGranularityUBA = ten.pow(new BN(parameters.assetDecimals - parameters.assetMintingDecimals));
    return {
        assetManagerController: addressFromParameter(contracts, parameters.assetManagerController ?? 'AssetManagerController'),
        fAsset: fAsset.address,
        agentVaultFactory: addressFromParameter(contracts, parameters.agentVaultFactory ?? 'AgentVaultFactory'),
        collateralPoolFactory: addressFromParameter(contracts, parameters.collateralPoolFactory ?? 'CollateralPoolFactory'),
        collateralPoolTokenFactory: addressFromParameter(contracts, parameters.collateralPoolTokenFactory ?? 'CollateralPoolTokenFactory'),
        scProofVerifier: addressFromParameter(contracts, parameters.scProofVerifier ?? 'SCProofVerifier'),
        priceReader: addressFromParameter(contracts, parameters.priceReader ?? 'PriceReader'),
        whitelist: parameters.userWhitelist ? addressFromParameter(contracts, parameters.userWhitelist) : ZERO_ADDRESS,
        agentOwnerRegistry: addressFromParameter(contracts, parameters.agentOwnerRegistry ?? 'AgentOwnerRegistry'),
        burnAddress: parameters.burnAddress,
        chainId: encodeAttestationName(parameters.chainName),
        poolTokenSuffix: parameters.poolTokenSuffix,
        assetDecimals: parameters.assetDecimals,
        assetUnitUBA: assetUnitUBA,
        assetMintingDecimals: parameters.assetMintingDecimals,
        assetMintingGranularityUBA: assetMintingGranularityUBA,
        minUnderlyingBackingBIPS: parameters.minUnderlyingBackingBIPS,
        mintingCapAMG: parseBN(parameters.mintingCap).div(assetMintingGranularityUBA),
        lotSizeAMG: parseBN(parameters.lotSize).div(assetMintingGranularityUBA),
        requireEOAAddressProof: parameters.requireEOAAddressProof,
        collateralReservationFeeBIPS: parameters.collateralReservationFeeBIPS,
        mintingPoolHoldingsRequiredBIPS: parameters.mintingPoolHoldingsRequiredBIPS,
        maxRedeemedTickets: parameters.maxRedeemedTickets,
        redemptionFeeBIPS: parameters.redemptionFeeBIPS,
        redemptionDefaultFactorVaultCollateralBIPS: parameters.redemptionDefaultFactorVaultCollateralBIPS,
        redemptionDefaultFactorPoolBIPS: parameters.redemptionDefaultFactorPoolBIPS,
        underlyingBlocksForPayment: parameters.underlyingBlocksForPayment,
        underlyingSecondsForPayment: parameters.underlyingSecondsForPayment,
        attestationWindowSeconds: parameters.attestationWindowSeconds,
        averageBlockTimeMS: parameters.averageBlockTimeMS,
        confirmationByOthersAfterSeconds: parameters.confirmationByOthersAfterSeconds,
        confirmationByOthersRewardUSD5: parseBN(parameters.confirmationByOthersRewardUSD5),
        paymentChallengeRewardBIPS: parameters.paymentChallengeRewardBIPS,
        paymentChallengeRewardUSD5: parseBN(parameters.paymentChallengeRewardUSD5),
        ccbTimeSeconds: parameters.ccbTimeSeconds,
        liquidationStepSeconds: parameters.liquidationStepSeconds,
        liquidationCollateralFactorBIPS: parameters.liquidationCollateralFactorBIPS,
        liquidationFactorVaultCollateralBIPS: parameters.liquidationFactorVaultCollateralBIPS,
        maxTrustedPriceAgeSeconds: parameters.maxTrustedPriceAgeSeconds,
        withdrawalWaitMinSeconds: parameters.withdrawalWaitMinSeconds,
        announcedUnderlyingConfirmationMinSeconds: parameters.announcedUnderlyingConfirmationMinSeconds,
        buybackCollateralFactorBIPS: parameters.buybackCollateralFactorBIPS,
        vaultCollateralBuyForFlareFactorBIPS: parameters.vaultCollateralBuyForFlareFactorBIPS,
        minUpdateRepeatTimeSeconds: parameters.minUpdateRepeatTimeSeconds,
        tokenInvalidationTimeMinSeconds: parameters.tokenInvalidationTimeMinSeconds,
        agentExitAvailableTimelockSeconds: parameters.agentExitAvailableTimelockSeconds,
        agentFeeChangeTimelockSeconds: parameters.agentFeeChangeTimelockSeconds,
        agentMintingCRChangeTimelockSeconds: parameters.agentMintingCRChangeTimelockSeconds,
        poolExitAndTopupChangeTimelockSeconds: parameters.poolExitAndTopupChangeTimelockSeconds,
        agentTimelockedOperationWindowSeconds: parameters.agentTimelockedOperationWindowSeconds,
        collateralPoolTokenTimelockSeconds: parameters.collateralPoolTokenTimelockSeconds,
    };
}
