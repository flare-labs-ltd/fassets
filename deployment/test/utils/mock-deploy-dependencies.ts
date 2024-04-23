import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { toBNExp } from '../../../lib/utils/helpers';
import { testDeployGovernanceSettings } from "../../../test/utils/contract-test-helpers";
import { ContractStore } from "../../lib/contracts";
import { loadDeployAccounts, requiredEnvironmentVariable } from "../../lib/deploy-utils";

const AddressUpdater = artifacts.require('AddressUpdater');
const StateConnectorMock = artifacts.require('StateConnectorMock');
const WNat = artifacts.require('WNat');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const FtsoManagerMock = artifacts.require('FtsoManagerMock');
const FtsoMock = artifacts.require('FtsoMock');
const VPContract = artifacts.require('VPContract');

const ftsoList: Array<[string, string, number, number]> = [
    ['NAT', 'FtsoNat', 5, 0.20],
    ['testUSDC', 'FtsoUSDC', 5, 1.01],
    ['testUSDT', 'FtsoUSDT', 5, 0.99],
    ['testETH', 'FtsoETH', 5, 3000],
    ['ALGO', 'FtsoAlgo', 5, 0.30],
    ['BTC', 'FtsoBtc', 5, 20_000],
    ['DOGE', 'FtsoDoge', 5, 0.05],
    ['LTC', 'FtsoLtc', 5, 50],
    ['XRP', 'FtsoXrp', 5, 0.50],
];

export async function mockDeployDependencies(hre: HardhatRuntimeEnvironment, contractsFile: string) {
    const { deployer } = loadDeployAccounts(hre);
    const governance = requiredEnvironmentVariable('GOVERNANCE_PUBLIC_KEY');

    // GovernanceSettings
    const governanceSettings = await testDeployGovernanceSettings(governance, 1, [governance, deployer]);

    // AddressUpdater
    const addressUpdater = await AddressUpdater.new(deployer);
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["AddressUpdater"], [addressUpdater.address], { from: deployer });
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["GovernanceSettings"], [governanceSettings.address], { from: deployer });

    // StateConnector
    const stateConnector = await StateConnectorMock.new();
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["StateConnector"], [stateConnector.address], { from: deployer });

    // WNat
    const wNat = await WNat.new(deployer, "Wrapped Native", "WNAT");
    const vpContract = await VPContract.new(wNat.address, false);
    await wNat.setWriteVpContract(vpContract.address, { from: deployer });
    await wNat.setReadVpContract(vpContract.address, { from: deployer });
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["WNat"], [wNat.address], { from: deployer });

    // FtsoRegistry
    const ftsoRegistry = await FtsoRegistryMock.new();
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["FtsoRegistry"], [ftsoRegistry.address], { from: deployer });

    // FtsoManager
    const ftsoManager = await FtsoManagerMock.new();
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["FtsoManager"], [ftsoManager.address], { from: deployer });

    // create contracts
    const contracts = new ContractStore(contractsFile, true);
    contracts.add('GovernanceSettings', 'GovernanceSettings.sol', governanceSettings.address);
    contracts.add('AddressUpdater', 'AddressUpdater.sol', addressUpdater.address);
    contracts.add('StateConnector', 'StateConnectorMock.sol', stateConnector.address);
    contracts.add('WNat', 'WNat.sol', wNat.address);
    contracts.add('FtsoRegistry', 'FtsoRegistryMock.sol', ftsoRegistry.address);
    contracts.add('FtsoManager', 'FtsoManagerMock.sol', ftsoManager.address);

    // add FTSOs
    for (const [symbol, contractName, decimals, initPrice] of ftsoList) {
        const ftso = await FtsoMock.new(symbol, decimals);
        await ftso.setCurrentPrice(toBNExp(initPrice, decimals), 0);
        await ftso.setCurrentPriceFromTrustedProviders(toBNExp(initPrice, decimals), 0);
        await ftsoRegistry.addFtso(ftso.address);
        contracts.add(contractName, "Ftso.sol", ftso.address);
    }

    // console.log('FTSO indices:', (await ftsoRegistry.getSupportedIndices()).map(Number));
    // console.log('FTSO symbols:', await ftsoRegistry.getSupportedSymbols());
    // console.log('FTSOs:', await ftsoRegistry.getSupportedFtsos());

    // switch to production
    await addressUpdater.switchToProductionMode();
    await wNat.switchToProductionMode();
}
