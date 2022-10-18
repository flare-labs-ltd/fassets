import BN from "bn.js";
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import path from "path";
import { AssetManagerSettings } from '../../lib/fasset/AssetManagerTypes';
import { AssetManagerNetworkParameters } from "./asset-manager-controller-parameters";
import { AssetManagerParameters } from './asset-manager-parameters';
import { ChainContracts, loadContracts, newContract, saveContracts } from "./contracts";
import { assetManagerControllerParameters, assetManagerParameters, loadDeployAccounts, ZERO_ADDRESS } from './deploy-utils';

export async function deployAttestationClient(hre: HardhatRuntimeEnvironment, contractsFile: string) {
    console.log(`Deploying AttestationClient`);
    
    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AttestationClient = artifacts.require("AttestationClientSC");
    
    const contracts = loadContracts(contractsFile);
    
    const attestationClient = await AttestationClient.new(contracts.StateConnector.address);
    
    contracts.AttestationClient = newContract("AttestationClient", "AttestationClientSC.sol", attestationClient.address);
    saveContracts(contractsFile, contracts);

    console.log(`NOTE: perform governance call 'AddressUpdater(${contracts.AddressUpdater.address}).addOrUpdateContractNamesAndAddresses(["AttestationClient"], [${attestationClient.address}])'`);
}

export async function deployAgentVaultFactory(hre: HardhatRuntimeEnvironment, contractsFile: string) {
    console.log(`Deploying AgentVaultFactory`);
    
    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AgentVaultFactory = artifacts.require("AgentVaultFactory");

    const contracts = loadContracts(contractsFile);

    const agentVaultFactory = await AgentVaultFactory.new();

    contracts.AgentVaultFactory = newContract("AgentVaultFactory", "AgentVaultFactory.sol", agentVaultFactory.address);
    saveContracts(contractsFile, contracts);
    
    console.log(`NOTE: perform governance call 'AddressUpdater(${contracts.AddressUpdater.address}).addOrUpdateContractNamesAndAddresses(["AgentVaultFactory"], [${agentVaultFactory.address}])'`);
}

export async function deployAssetManagerController(hre: HardhatRuntimeEnvironment, parametersFile: string, contractsFile: string) {
    const artifacts = hre.artifacts as Truffle.Artifacts;
    
    console.log(`Deploying AssetManagerController with config ${parametersFile}`);

    const AssetManagerController = artifacts.require("AssetManagerController");
    
    const { deployer } = loadDeployAccounts(hre);
    const parameters = assetManagerControllerParameters.load(parametersFile);
    const contracts = loadContracts(contractsFile);
    
    const assetManagerController = await AssetManagerController.new(contracts.GovernanceSettings.address, deployer, contracts.AddressUpdater.address);
    
    contracts.AssetManagerController = newContract("AssetManagerController", "AssetManagerController.sol", assetManagerController.address);
    saveContracts(contractsFile, contracts);
    
    // add asset managers before switching to production governance
    for (const mgrParamFile of parameters.deployAssetManagerParameterFiles) {
        console.log(`   deploying AssetManager with config ${mgrParamFile}`);
        const mgrParamPath = path.join(path.dirname(parametersFile), mgrParamFile);
        const assetManager = await deployAssetManager(hre, parametersFile, mgrParamPath, contractsFile, false);
        await assetManagerController.addAssetManager(assetManager.address, { from: deployer });
    }
    
    for (const contractName of parameters.attachAssetManagerContractNames) {
        const assetManagerAddress = contracts[contractName];
        if (assetManagerAddress == null) {
            throw new Error(`Unknown asset manager contract ${contractName}`);
        }
        await assetManagerController.addAssetManager(assetManagerAddress.address, { from: deployer });
    }
    
    await assetManagerController.switchToProductionMode({ from: deployer });    

    console.log(`NOTE: perform governance call 'AddressUpdater(${contracts.AddressUpdater.address}).addOrUpdateContractNamesAndAddresses(["AssetManagerController"], [${assetManagerController.address}])'`);
}

// assumes AssetManager contract artifact has been linked already
export async function deployAssetManager(hre: HardhatRuntimeEnvironment, controllerParametersFile: string, parametersFile: string, contractsFile: string, standalone: boolean) {
    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AssetManager = artifacts.require("AssetManager");
    const FAsset = artifacts.require('FAsset');

    const { deployer } = loadDeployAccounts(hre);
    const controllerParameters = assetManagerControllerParameters.load(controllerParametersFile);
    const parameters = assetManagerParameters.load(parametersFile);
    
    const contracts = loadContracts(contractsFile);
    
    const fAsset = await FAsset.new(deployer, parameters.fAssetName, parameters.fAssetSymbol, parameters.assetDecimals);

    const assetManagerSettings = createAssetManagerSettings(contracts, parameters, controllerParameters.networkParameters);

    const assetManager = await AssetManager.new(assetManagerSettings, fAsset.address);

    await fAsset.setAssetManager(assetManager.address, { from: deployer });
    
    const symbol = parameters.fAssetSymbol;
    contracts[`AssetManager_${symbol}`] = newContract(`AssetManager_${symbol}`, "AssetManager.sol", assetManager.address);
    contracts[`FAsset_${symbol}`] = newContract(`FAsset_${symbol}`, "FAsset.sol", fAsset.address);
    saveContracts(contractsFile, contracts);

    await fAsset.switchToProductionMode({ from: deployer });

    if (standalone) {
        console.log(`NOTE: perform governance call 'AssetManagerController(${contracts.AssetManagerController?.address}).addAssetManager(${assetManager.address})'`);
    }

    return assetManager;
}

function bnToString(x: BN | number | string) {
    if (!BN.isBN(x)) {
        x = new BN(x);  // convert to BN to remove spaces etc.
    }
    return x.toString(10);
}

function createAssetManagerSettings(contracts: ChainContracts, parameters: AssetManagerParameters, networkParameters: AssetManagerNetworkParameters): AssetManagerSettings {
    if (!contracts.AssetManagerController || !contracts.AgentVaultFactory || !contracts.AttestationClient) {
        throw new Error("Missing contracts");
    }
    return {
        assetManagerController: contracts.AssetManagerController.address,
        agentVaultFactory: contracts.AgentVaultFactory.address,
        whitelist: contracts.AssetManagerWhitelist?.address ?? ZERO_ADDRESS,
        attestationClient: contracts.AttestationClient.address,
        wNat: contracts.WNat.address,
        ftsoRegistry: contracts.FtsoRegistry.address,
        natFtsoIndex: 0,        // set by contract constructor
        assetFtsoIndex: 0,      // set by contract constructor
        natFtsoSymbol: networkParameters.natSymbol,
        assetFtsoSymbol: parameters.assetSymbol,
        burnAddress: networkParameters.burnAddress,
        burnWithSelfDestruct: networkParameters.burnWithSelfDestruct,
        chainId: bnToString(parameters.chainId),
        collateralReservationFeeBIPS: bnToString(parameters.collateralReservationFeeBIPS),
        assetUnitUBA: bnToString(new BN(10).pow(new BN(parameters.assetDecimals))),
        assetMintingGranularityUBA: bnToString(parameters.assetMintingGranularityUBA),
        lotSizeAMG: bnToString(new BN(parameters.lotSize).div(new BN(parameters.assetMintingGranularityUBA))),
        maxTrustedPriceAgeSeconds: bnToString(parameters.maxTrustedPriceAgeSeconds),
        requireEOAAddressProof: parameters.requireEOAAddressProof,
        minCollateralRatioBIPS: bnToString(parameters.minCollateralRatioBIPS),
        ccbMinCollateralRatioBIPS: bnToString(parameters.ccbMinCollateralRatioBIPS),
        safetyMinCollateralRatioBIPS: bnToString(parameters.safetyMinCollateralRatioBIPS),
        underlyingBlocksForPayment: bnToString(parameters.underlyingBlocksForPayment),
        underlyingSecondsForPayment: bnToString(parameters.underlyingSecondsForPayment),
        redemptionFeeBIPS: bnToString(parameters.redemptionFeeBIPS),
        redemptionDefaultFactorBIPS: bnToString(parameters.redemptionDefaultFactorBIPS),
        confirmationByOthersAfterSeconds: bnToString(parameters.confirmationByOthersAfterSeconds),
        confirmationByOthersRewardNATWei: bnToString(parameters.confirmationByOthersRewardNATWei),
        maxRedeemedTickets: bnToString(parameters.maxRedeemedTickets),
        paymentChallengeRewardBIPS: bnToString(parameters.paymentChallengeRewardBIPS),
        paymentChallengeRewardNATWei: bnToString(parameters.paymentChallengeRewardNATWei),
        withdrawalWaitMinSeconds: bnToString(parameters.withdrawalWaitMinSeconds),
        liquidationCollateralFactorBIPS: parameters.liquidationCollateralFactorBIPS.map(bnToString),
        ccbTimeSeconds: bnToString(parameters.ccbTimeSeconds),
        liquidationStepSeconds: bnToString(parameters.liquidationStepSeconds),
        attestationWindowSeconds: bnToString(parameters.attestationWindowSeconds),
        minUpdateRepeatTimeSeconds: bnToString(parameters.minUpdateRepeatTimeSeconds),
        buybackCollateralFactorBIPS: bnToString(parameters.buybackCollateralFactorBIPS),
        announcedUnderlyingConfirmationMinSeconds: bnToString(parameters.announcedUnderlyingConfirmationMinSeconds),
    };
}
