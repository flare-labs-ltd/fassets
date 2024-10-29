import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { testDeployGovernanceSettings } from "../../../test/utils/contract-test-helpers";
import { FAssetContractStore } from "../../lib/contracts";
import { loadDeployAccounts, requiredEnvironmentVariable } from "../../lib/deploy-utils";

const AddressUpdater = artifacts.require('AddressUpdater');
const RelayMock = artifacts.require('RelayMock');
const FdcHubMock = artifacts.require('FdcHubMock');
const WNat = artifacts.require('WNat');
const VPContract = artifacts.require('VPContract');
const FdcVerification = artifacts.require('FdcVerificationMock');

export async function mockDeployDependencies(hre: HardhatRuntimeEnvironment, contractsFile: string) {
    const { deployer } = loadDeployAccounts(hre);
    const governance = requiredEnvironmentVariable('GOVERNANCE_PUBLIC_KEY');

    // GovernanceSettings
    const governanceSettings = await testDeployGovernanceSettings(governance, 1, [governance, deployer]);

    // AddressUpdater
    const addressUpdater = await AddressUpdater.new(deployer);
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["AddressUpdater"], [addressUpdater.address], { from: deployer });
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["GovernanceSettings"], [governanceSettings.address], { from: deployer });

    // FdcHub
    const fdcHub = await FdcHubMock.new();
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["FdcHub"], [fdcHub.address], { from: deployer });

    // Relay
    const relay = await RelayMock.new();
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["Relay"], [relay.address], { from: deployer });

    // FDCVerification
    const fdcVerification = await FdcVerification.new(relay.address, 200);
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["FdcVerification"], [fdcVerification.address], { from: deployer });

    // WNat
    const wNat = await WNat.new(deployer, "Wrapped Native", "WNAT");
    const vpContract = await VPContract.new(wNat.address, false);
    await wNat.setWriteVpContract(vpContract.address, { from: deployer });
    await wNat.setReadVpContract(vpContract.address, { from: deployer });
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["WNat"], [wNat.address], { from: deployer });

    // create contracts
    const contracts = new FAssetContractStore(contractsFile, true);
    contracts.add('GovernanceSettings', 'GovernanceSettings.sol', governanceSettings.address);
    contracts.add('AddressUpdater', 'AddressUpdater.sol', addressUpdater.address);
    contracts.add('Relay', 'RelayMock.sol', relay.address);
    contracts.add('FdcHub', 'FdcHubMock.sol', fdcHub.address);
    contracts.add('FdcVerification', 'FdcVerificationMock.sol', fdcVerification.address);
    contracts.add('WNat', 'WNat.sol', wNat.address);

    // console.log('FTSO indices:', (await ftsoRegistry.getSupportedIndices()).map(Number));
    // console.log('FTSO symbols:', await ftsoRegistry.getSupportedSymbols());
    // console.log('FTSOs:', await ftsoRegistry.getSupportedFtsos());

    // switch to production
    await addressUpdater.switchToProductionMode();
    await wNat.switchToProductionMode();
}
