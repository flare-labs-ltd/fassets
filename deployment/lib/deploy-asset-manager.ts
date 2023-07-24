import BN from "bn.js";
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { AssetManagerSettings, CollateralClass, CollateralType } from '../../lib/fasset/AssetManagerTypes';
import { web3DeepNormalize } from "../../lib/utils/web3normalize";
import { FAssetInstance } from "../../typechain-truffle";
import { JsonParameterSchema } from "./JsonParameterSchema";
import { AssetManagerParameters, CollateralTypeParameters } from './asset-manager-parameters';
import { ChainContracts, loadContracts, newContract, saveContracts } from "./contracts";
import { ZERO_ADDRESS, loadDeployAccounts, requiredEnvironmentVariable } from './deploy-utils';
import { ILiquidationStrategyFactory } from "./liquidationStrategyFactory/ILiquidationStrategyFactory";
import { LiquidationStrategyImpl } from "./liquidationStrategyFactory/LiquidationStrategyImpl";

export const assetManagerParameters = new JsonParameterSchema<AssetManagerParameters>(require('../config/asset-manager-parameters.schema.json'));

export const liquidationStrategyFactories: Record<string, () => ILiquidationStrategyFactory<any>> = {
    LiquidationStrategyImpl: () => new LiquidationStrategyImpl(),
}

export async function deploySCProofVerifier(hre: HardhatRuntimeEnvironment, contractsFile: string) {
    console.log(`Deploying SCProofVerifier`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const SCProofVerifier = artifacts.require("SCProofVerifier");

    const contracts = loadContracts(contractsFile);

    const scProofVerifier = await SCProofVerifier.new(contracts.StateConnector.address);

    contracts.SCProofVerifier = newContract("SCProofVerifier", "SCProofVerifier.sol", scProofVerifier.address);
    saveContracts(contractsFile, contracts);
}

export async function deployPriceReader(hre: HardhatRuntimeEnvironment, contractsFile: string) {
    console.log(`Deploying PriceReader`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const PriceReader = artifacts.require("FtsoV1PriceReader");

    const contracts = loadContracts(contractsFile);

    const priceReader = await PriceReader.new(contracts.AddressUpdater.address, contracts.FtsoRegistry.address);

    contracts.PriceReader = newContract("PriceReader", "PriceReader.sol", priceReader.address);
    saveContracts(contractsFile, contracts);
}

export async function deployWhitelist(hre: HardhatRuntimeEnvironment, contractsFile: string, kind: 'Agent' | 'User') {
    console.log(`Deploying ${kind}Whitelist`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const Whitelist = artifacts.require("Whitelist");

    const { deployer } = loadDeployAccounts(hre);
    const contracts = loadContracts(contractsFile);

    const revokeSupported = kind === 'Agent';
    const whitelist = await Whitelist.new(contracts.GovernanceSettings.address, deployer, revokeSupported);

    contracts[`${kind}Whitelist`] = newContract(`${kind}Whitelist`, "Whitelist.sol", whitelist.address, { mustSwitchToProduction: true });
    saveContracts(contractsFile, contracts);
}

export async function deployAgentVaultFactory(hre: HardhatRuntimeEnvironment, contractsFile: string) {
    console.log(`Deploying AgentVaultFactory`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AgentVaultFactory = artifacts.require("AgentVaultFactory");

    const contracts = loadContracts(contractsFile);

    const agentVaultFactory = await AgentVaultFactory.new();

    contracts.AgentVaultFactory = newContract("AgentVaultFactory", "AgentVaultFactory.sol", agentVaultFactory.address);
    saveContracts(contractsFile, contracts);
}

export async function deployCollateralPoolFactory(hre: HardhatRuntimeEnvironment, contractsFile: string) {
    console.log(`Deploying CollateralPoolFactory`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const CollateralPoolFactory = artifacts.require("CollateralPoolFactory");

    const contracts = loadContracts(contractsFile);

    const collateralPoolFactory = await CollateralPoolFactory.new();

    contracts.CollateralPoolFactory = newContract("CollateralPoolFactory", "CollateralPoolFactory.sol", collateralPoolFactory.address);
    saveContracts(contractsFile, contracts);
}

export async function deployCollateralPoolTokenFactory(hre: HardhatRuntimeEnvironment, contractsFile: string) {
    console.log(`Deploying CollateralPoolTokenFactory`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const CollateralPoolTokenFactory = artifacts.require("CollateralPoolTokenFactory");

    const contracts = loadContracts(contractsFile);

    const collateralPoolTokenFactory = await CollateralPoolTokenFactory.new();

    contracts.CollateralPoolTokenFactory = newContract("CollateralPoolTokenFactory", "CollateralPoolTokenFactory.sol", collateralPoolTokenFactory.address);
    saveContracts(contractsFile, contracts);
}

export async function deployAssetManagerController(hre: HardhatRuntimeEnvironment, contractsFile: string, managerParameterFiles: string[]) {
    const artifacts = hre.artifacts as Truffle.Artifacts;

    console.log(`Deploying AssetManagerController`);

    const AssetManagerController = artifacts.require("AssetManagerController");

    const { deployer } = loadDeployAccounts(hre);
    const contracts = loadContracts(contractsFile);

    const assetManagerController = await AssetManagerController.new(contracts.GovernanceSettings.address, deployer, contracts.AddressUpdater.address);

    contracts.AssetManagerController = newContract("AssetManagerController", "AssetManagerController.sol", assetManagerController.address, { mustSwitchToProduction: true });
    saveContracts(contractsFile, contracts);

    // add asset managers before switching to production governance
    for (const parameterFile of managerParameterFiles) {
        console.log(`   deploying AssetManager with config ${parameterFile}`);
        const assetManager = await deployAssetManager(hre, parameterFile, contractsFile, false);
        await assetManagerController.addAssetManager(assetManager.address, { from: deployer });
    }

    console.log(`NOTE: perform governance call 'AddressUpdater(${contracts.AddressUpdater.address}).addOrUpdateContractNamesAndAddresses(["AssetManagerController"], [${assetManagerController.address}])'`);
}

// assumes AssetManager contract artifact has been linked already
export async function deployAssetManager(hre: HardhatRuntimeEnvironment, parametersFile: string, contractsFile: string, standalone: boolean) {
    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AssetManager = artifacts.require("AssetManager");
    const FAsset = artifacts.require('FAsset');


    const { deployer } = loadDeployAccounts(hre);
    const parameters = assetManagerParameters.load(parametersFile);

    const contracts = loadContracts(contractsFile);

    const fAsset = await FAsset.new(deployer, parameters.fAssetName, parameters.fAssetSymbol, parameters.assetDecimals);

    const [addressValidatorArtifact, addressValidatorConstructorArgs] = parameters.underlyingAddressValidator;
    const AddressValidator = hre.artifacts.require(addressValidatorArtifact);
    const addressValidator = await AddressValidator.new(...addressValidatorConstructorArgs) as Truffle.ContractInstance;

    const poolCollateral = convertCollateralType(contracts, parameters.poolCollateral, CollateralClass.POOL);
    const vaultCollateral = parameters.vaultCollaterals.map(p => convertCollateralType(contracts, p, CollateralClass.VAULT));
    const collateralTypes = [poolCollateral, ...vaultCollateral];

    const liquidationStrategyFactory = liquidationStrategyFactories[parameters.liquidationStrategy]();
    const liquidationStrategy = await liquidationStrategyFactory.deployLibrary(hre, contracts);
    const liquidationStrategySettings = liquidationStrategyFactory.schema.validate(parameters.liquidationStrategySettings);
    const liquidationStrategySettingsEnc = liquidationStrategyFactory.encodeSettings(liquidationStrategySettings)

    const assetManagerSettings = web3DeepNormalize(createAssetManagerSettings(contracts, parameters, fAsset, liquidationStrategy, addressValidator.address));

    // console.log(JSON.stringify(assetManagerSettings, null, 4));

    const assetManager = await AssetManager.new(assetManagerSettings, collateralTypes, liquidationStrategySettingsEnc);

    await fAsset.setAssetManager(assetManager.address, { from: deployer });

    const symbol = parameters.fAssetSymbol;
    contracts[`AssetManager_${symbol}`] = newContract(`AssetManager_${symbol}`, "AssetManager.sol", assetManager.address);
    contracts[symbol] = newContract(symbol, "FAsset.sol", fAsset.address, { mustSwitchToProduction: true });
    contracts[`AddressValidator_${symbol}`] = newContract(`AddressValidator_${symbol}`, `${addressValidatorArtifact}.sol`, addressValidator.address);
    saveContracts(contractsFile, contracts);

    if (standalone) {
        console.log(`NOTE: perform governance call 'AssetManagerController(${contracts.AssetManagerController?.address}).addAssetManager(${assetManager.address})'`);
    }

    return assetManager;
}

export async function switchAllToProductionMode(hre: HardhatRuntimeEnvironment, contractsFile: string) {
    const { deployer } = loadDeployAccounts(hre);
    const contracts = loadContracts(contractsFile);

    const GovernedBase = artifacts.require("contracts/governance/implementation/GovernedBase.sol:GovernedBase" as 'GovernedBase');

    for (const contract of Object.values(contracts)) {
        if (contract?.mustSwitchToProduction) {
            console.log(`Switching to production: ${contract.name}`);
            const instance = await GovernedBase.at(contract.address);
            await instance.switchToProductionMode({ from: deployer });
            delete contract.mustSwitchToProduction;
            saveContracts(contractsFile, contracts);
        }
    }
}

function addressFromParameter(contracts: ChainContracts, addressOrName: string) {
    if (addressOrName.startsWith('0x')) return addressOrName;
    const contract = contracts[addressOrName];
    if (contract != null) return contract.address;
    throw new Error(`Missing contract ${addressOrName}`);
}

function parseBN(s: string) {
    return new BN(s.replace(/_/g, ''), 10);
}

function convertCollateralType(contracts: ChainContracts, parameters: CollateralTypeParameters, collateralClass: CollateralClass): CollateralType {
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

function createAssetManagerSettings(contracts: ChainContracts, parameters: AssetManagerParameters, fAsset: FAssetInstance, liquidationStrategy: string, addressValidator: string): AssetManagerSettings {
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
        agentWhitelist: addressFromParameter(contracts, parameters.agentWhitelist ?? 'AgentWhitelist'),
        underlyingAddressValidator: addressValidator,
        liquidationStrategy: liquidationStrategy,
        burnAddress: parameters.burnAddress,
        chainId: parameters.chainId,
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
        maxTrustedPriceAgeSeconds: parameters.maxTrustedPriceAgeSeconds,
        withdrawalWaitMinSeconds: parameters.withdrawalWaitMinSeconds,
        announcedUnderlyingConfirmationMinSeconds: parameters.announcedUnderlyingConfirmationMinSeconds,
        buybackCollateralFactorBIPS: parameters.buybackCollateralFactorBIPS,
        vaultCollateralBuyForFlareFactorBIPS: parameters.vaultCollateralBuyForFlareFactorBIPS,
        minUpdateRepeatTimeSeconds: parameters.minUpdateRepeatTimeSeconds,
        tokenInvalidationTimeMinSeconds: parameters.tokenInvalidationTimeMinSeconds,
        agentExitAvailableTimelockSeconds: parameters.agentExitAvailableTimelockSeconds,
        agentFeeChangeTimelockSeconds: parameters.agentFeeChangeTimelockSeconds,
        agentCollateralRatioChangeTimelockSeconds: parameters.agentCollateralRatioChangeTimelockSeconds,
    };
}
