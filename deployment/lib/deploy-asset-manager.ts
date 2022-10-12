import BN from "bn.js";
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { AssetManagerSettings } from '../../lib/fasset/AssetManagerTypes';
import { AssetManagerParameters } from './asset-manager-parameters';
import { loadContracts, newContract, saveContracts, ChainContracts } from "./contracts";
import { assetManagerControllerParameters, assetManagerParameters, loadDeployAccounts, ZERO_ADDRESS } from './deploy-utils';

export async function deployAttestationClient(hre: HardhatRuntimeEnvironment, contractsFile: string) {
    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AttestationClient = artifacts.require("AttestationClientSC");
    
    const contracts = loadContracts(contractsFile);
    
    const attestationClient = await AttestationClient.new(contracts.StateConnector.address);
    
    contracts.AttestationClient = newContract("AttestationClient", "AttestationClientSC.sol", attestationClient.address);
    saveContracts(contractsFile, contracts);

    // MUST do a multisig governance call to
    //      AddressUpdater.addOrUpdateContractNamesAndAddresses(["AttestationClient"], [attestationClient.address])
}

export async function deployAgentVaultFactory(hre: HardhatRuntimeEnvironment, contractsFile: string) {
    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AgentVaultFactory = artifacts.require("AgentVaultFactory");

    const contracts = loadContracts(contractsFile);

    const agentVaultFactory = await AgentVaultFactory.new();

    contracts.AttestationClient = newContract("AgentVaultFactory", "AgentVaultFactory.sol", agentVaultFactory.address);
    saveContracts(contractsFile, contracts);
    
    // MUST do a multisig governance call to
    //      AddressUpdater.addOrUpdateContractNamesAndAddresses(["AgentVaultFactory"], [agentVaultFactory.address])
}

export async function deployAssetManagerController(hre: HardhatRuntimeEnvironment, parametersFile: string, contractsFile: string) {
    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AssetManagerController = artifacts.require("AssetManagerController");
    
    const { deployer } = loadDeployAccounts(hre);
    const parameters = assetManagerControllerParameters.load(parametersFile);
    const contracts = loadContracts(contractsFile);
    
    const assetManagerController = await AssetManagerController.new(contracts.GovernanceSettings.address, deployer, contracts.AddressUpdater.address);
    
    contracts.AssetManagerController = newContract("AssetManagerController", "AssetManagerController.sol", assetManagerController.address);
    saveContracts(contractsFile, contracts);
    
    // add asset managers before switching to production governance
    for (const mgrParamFile of parameters.deployAssetManagerParameterFiles) {
        const assetManager = await deployAssetManager(hre, mgrParamFile, contractsFile);
        await assetManagerController.addAssetManager(assetManager.address, { from: deployer });
    }
    
    for (const assetManagerAddress of parameters.attachAssetManagerAddresses) {
        await assetManagerController.addAssetManager(assetManagerAddress, { from: deployer });
    }
    
    // TODO: await assetManagerController.switchToProduction();

    // MUST do a multisig governance call to
    //      AddressUpdater.addOrUpdateContractNamesAndAddresses(["AssetManagerController"], [assetManagerController.address])
}

// assumes AssetManager has been linked already
export async function deployAssetManager(hre: HardhatRuntimeEnvironment, parametersFile: string, contractsFile: string) {
    const artifacts = hre.artifacts as Truffle.Artifacts;

    const AssetManager = artifacts.require("AssetManager");
    const FAsset = artifacts.require('FAsset');

    const { deployer } = loadDeployAccounts(hre);
    const parameters = assetManagerParameters.load(parametersFile);
    
    const contracts = loadContracts(contractsFile);
    
    const fAsset = await FAsset.new(deployer, parameters.fAssetName, parameters.fAssetSymbol, parameters.assetDecimals);

    const assetManagerSettings = createAssetManagerSettings(contracts, parameters);

    const assetManager = await AssetManager.new(assetManagerSettings, fAsset.address);

    await fAsset.setAssetManager(assetManager.address, { from: deployer });
    
    const symbol = parameters.fAssetSymbol;
    contracts[`AssetManager_${symbol}`] = newContract(`AssetManager_${symbol}`, "AssetManager.sol", assetManager.address);
    contracts[`FAsset_${symbol}`] = newContract(`FAsset_${symbol}`, "FAsset.sol", fAsset.address);
    saveContracts(contractsFile, contracts);

    // TODO: fAsset.switchToProduction({ from: deployer });

    return assetManager;

    // If this this asset manager is not created immediatelly with new controller, MUST do a multisig governance call to
    //      AssetManagerController.addAssetManager(assetManager.address)
}

function createAssetManagerSettings(contracts: ChainContracts, parameters: AssetManagerParameters): AssetManagerSettings {
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
        natFtsoSymbol: parameters.natSymbol,
        assetFtsoSymbol: parameters.assetSymbol,
        burnAddress: ZERO_ADDRESS,
        chainId: parameters.chainId,
        collateralReservationFeeBIPS: parameters.collateralReservationFeeBIPS,
        assetUnitUBA: new BN(10).pow(new BN(parameters.assetDecimals)).toString(),
        assetMintingGranularityUBA: parameters.assetMintingGranularityUBA,
        lotSizeAMG: new BN(parameters.lotSize).div(new BN(parameters.assetMintingGranularityUBA)),
        maxTrustedPriceAgeSeconds: parameters.maxTrustedPriceAgeSeconds,
        requireEOAAddressProof: parameters.requireEOAAddressProof,
        minCollateralRatioBIPS: parameters.minCollateralRatioBIPS,
        ccbMinCollateralRatioBIPS: parameters.ccbMinCollateralRatioBIPS,
        safetyMinCollateralRatioBIPS: parameters.safetyMinCollateralRatioBIPS,
        underlyingBlocksForPayment: parameters.underlyingBlocksForPayment,
        underlyingSecondsForPayment: parameters.underlyingSecondsForPayment,
        redemptionFeeBIPS: parameters.redemptionFeeBIPS,
        redemptionDefaultFactorBIPS: parameters.redemptionDefaultFactorBIPS,
        confirmationByOthersAfterSeconds: parameters.confirmationByOthersAfterSeconds,
        confirmationByOthersRewardNATWei: parameters.confirmationByOthersRewardNATWei,
        maxRedeemedTickets: parameters.maxRedeemedTickets,
        paymentChallengeRewardBIPS: parameters.paymentChallengeRewardBIPS,
        paymentChallengeRewardNATWei: parameters.paymentChallengeRewardNATWei,
        withdrawalWaitMinSeconds: parameters.withdrawalWaitMinSeconds,
        liquidationCollateralFactorBIPS: parameters.liquidationCollateralFactorBIPS,
        ccbTimeSeconds: parameters.ccbTimeSeconds,
        liquidationStepSeconds: parameters.liquidationStepSeconds,
        attestationWindowSeconds: parameters.attestationWindowSeconds,
        timelockSeconds: parameters.timelockSeconds,
        minUpdateRepeatTimeSeconds: parameters.minUpdateRepeatTimeSeconds,
        buybackCollateralFactorBIPS: parameters.buybackCollateralFactorBIPS,
        announcedUnderlyingConfirmationMinSeconds: parameters.announcedUnderlyingConfirmationMinSeconds,
    };
}
