import BN from "bn.js";
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { AssetManagerSettings } from '../../lib/fasset/AssetManagerTypes';
import { AssetManagerParameters } from './asset-manager-parameters';
import { ChainContracts, loadContracts, newContract, saveContracts } from "./contracts";
import { assetManagerParameters, loadDeployAccounts, ZERO_ADDRESS } from './deploy-utils';

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

export async function deployAssetManagerController(hre: HardhatRuntimeEnvironment, contractsFile: string, managerParameterFiles: string[]) {
    // const artifacts = hre.artifacts as Truffle.Artifacts;

    // console.log(`Deploying AssetManagerController`);

    // const AssetManagerController = artifacts.require("AssetManagerController");

    // const { deployer } = loadDeployAccounts(hre);
    // const contracts = loadContracts(contractsFile);

    // const assetManagerController = await AssetManagerController.new(contracts.GovernanceSettings.address, deployer, contracts.AddressUpdater.address);

    // contracts.AssetManagerController = newContract("AssetManagerController", "AssetManagerController.sol", assetManagerController.address);
    // saveContracts(contractsFile, contracts);

    // // add asset managers before switching to production governance
    // for (const parameterFile of managerParameterFiles) {
    //     console.log(`   deploying AssetManager with config ${parameterFile}`);
    //     const assetManager = await deployAssetManager(hre, parameterFile, contractsFile, false);
    //     await assetManagerController.addAssetManager(assetManager.address, { from: deployer });
    // }

    // await assetManagerController.switchToProductionMode({ from: deployer });

    // console.log(`NOTE: perform governance call 'AddressUpdater(${contracts.AddressUpdater.address}).addOrUpdateContractNamesAndAddresses(["AssetManagerController"], [${assetManagerController.address}])'`);
}

// assumes AssetManager contract artifact has been linked already
export async function deployAssetManager(hre: HardhatRuntimeEnvironment, parametersFile: string, contractsFile: string, standalone: boolean) {
    // const artifacts = hre.artifacts as Truffle.Artifacts;

    // const AssetManager = artifacts.require("AssetManager");
    // const FAsset = artifacts.require('FAsset');

    // const { deployer } = loadDeployAccounts(hre);
    // const parameters = assetManagerParameters.load(parametersFile);

    // const contracts = loadContracts(contractsFile);

    // const fAsset = await FAsset.new(deployer, parameters.fAssetName, parameters.fAssetSymbol, parameters.assetDecimals);

    // const assetManagerSettings = createAssetManagerSettings(contracts, parameters);

    // const assetManager = await AssetManager.new(assetManagerSettings, fAsset.address);

    // await fAsset.setAssetManager(assetManager.address, { from: deployer });

    // const symbol = parameters.fAssetSymbol;
    // contracts[`AssetManager_${symbol}`] = newContract(`AssetManager_${symbol}`, "AssetManager.sol", assetManager.address);
    // contracts[symbol] = newContract(symbol, "FAsset.sol", fAsset.address);
    // saveContracts(contractsFile, contracts);

    // await fAsset.switchToProductionMode({ from: deployer });

    // if (standalone) {
    //     console.log(`NOTE: perform governance call 'AssetManagerController(${contracts.AssetManagerController?.address}).addAssetManager(${assetManager.address})'`);
    // }

    // return assetManager;
}

function bnToString(x: BN | number | string) {
    if (!BN.isBN(x)) {
        x = new BN(x);  // convert to BN to remove spaces etc.
    }
    return x.toString(10);
}

// function createAssetManagerSettings(contracts: ChainContracts, parameters: AssetManagerParameters): AssetManagerSettings {
//     if (!contracts.AssetManagerController || !contracts.AgentVaultFactory || !contracts.AttestationClient) {
//         throw new Error("Missing contracts");
//     }
//     return {
//         assetManagerController: contracts.AssetManagerController.address,
//         agentVaultFactory: contracts.AgentVaultFactory.address,
//         whitelist: contracts.AssetManagerWhitelist?.address ?? ZERO_ADDRESS,
//         attestationClient: contracts.AttestationClient.address,
//         wNat: contracts.WNat.address,
//         ftsoRegistry: contracts.FtsoRegistry.address,
//         natFtsoIndex: 0,        // set by contract constructor
//         assetFtsoIndex: 0,      // set by contract constructor
//         natFtsoSymbol: parameters.natSymbol,
//         assetFtsoSymbol: parameters.assetSymbol,
//         burnAddress: parameters.burnAddress,
//         burnWithSelfDestruct: parameters.burnWithSelfDestruct,
//         chainId: bnToString(parameters.chainId),
//         collateralReservationFeeBIPS: bnToString(parameters.collateralReservationFeeBIPS),
//         assetUnitUBA: bnToString(new BN(10).pow(new BN(parameters.assetDecimals))),
//         assetMintingGranularityUBA: bnToString(parameters.assetMintingGranularityUBA),
//         lotSizeAMG: bnToString(new BN(parameters.lotSize).div(new BN(parameters.assetMintingGranularityUBA))),
//         maxTrustedPriceAgeSeconds: bnToString(parameters.maxTrustedPriceAgeSeconds),
//         requireEOAAddressProof: parameters.requireEOAAddressProof,
//         minCollateralRatioBIPS: bnToString(parameters.minCollateralRatioBIPS),
//         ccbMinCollateralRatioBIPS: bnToString(parameters.ccbMinCollateralRatioBIPS),
//         safetyMinCollateralRatioBIPS: bnToString(parameters.safetyMinCollateralRatioBIPS),
//         underlyingBlocksForPayment: bnToString(parameters.underlyingBlocksForPayment),
//         underlyingSecondsForPayment: bnToString(parameters.underlyingSecondsForPayment),
//         redemptionFeeBIPS: bnToString(parameters.redemptionFeeBIPS),
//         redemptionDefaultFactorBIPS: bnToString(parameters.redemptionDefaultFactorBIPS),
//         confirmationByOthersAfterSeconds: bnToString(parameters.confirmationByOthersAfterSeconds),
//         confirmationByOthersRewardNATWei: bnToString(parameters.confirmationByOthersRewardNATWei),
//         maxRedeemedTickets: bnToString(parameters.maxRedeemedTickets),
//         paymentChallengeRewardBIPS: bnToString(parameters.paymentChallengeRewardBIPS),
//         paymentChallengeRewardNATWei: bnToString(parameters.paymentChallengeRewardNATWei),
//         withdrawalWaitMinSeconds: bnToString(parameters.withdrawalWaitMinSeconds),
//         liquidationCollateralFactorBIPS: parameters.liquidationCollateralFactorBIPS.map(bnToString),
//         ccbTimeSeconds: bnToString(parameters.ccbTimeSeconds),
//         liquidationStepSeconds: bnToString(parameters.liquidationStepSeconds),
//         attestationWindowSeconds: bnToString(parameters.attestationWindowSeconds),
//         minUpdateRepeatTimeSeconds: bnToString(parameters.minUpdateRepeatTimeSeconds),
//         buybackCollateralFactorBIPS: bnToString(parameters.buybackCollateralFactorBIPS),
//         announcedUnderlyingConfirmationMinSeconds: bnToString(parameters.announcedUnderlyingConfirmationMinSeconds),
//     };
// }
