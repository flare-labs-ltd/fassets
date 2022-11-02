import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { toBNExp } from '../../../lib/utils/helpers';
import { testDeployGovernanceSettings } from "../contract-test-helpers";
import { ChainContracts, newContract, saveContracts } from "../../../deployment/lib/contracts";
import { loadDeployAccounts, requiredEnvironmentVariable } from "../../../deployment/lib/deploy-utils";

const AddressUpdater = artifacts.require('AddressUpdater');
const StateConnectorMock = artifacts.require('StateConnectorMock');
const WNat = artifacts.require('WNat');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const FtsoManagerMock = artifacts.require('FtsoManagerMock');
const FtsoMock = artifacts.require('FtsoMock');

const ftsoList: Array<[string, string, number]> = [
    ['NAT', 'FtsoNat', 0.20],
    ['ALGO', 'FtsoAlgo', 0.30],
    ['BTC', 'FtsoBtc', 20_000],
    ['DOGE', 'FtsoDoge', 0.05],
    ['LTC', 'FtsoLtc', 50],
    ['XRP', 'FtsoXrp', 0.50],
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
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["WNat"], [wNat.address], { from: deployer });
    
    // FtsoRegistry
    const ftsoRegistry = await FtsoRegistryMock.new();
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["FtsoRegistry"], [ftsoRegistry.address], { from: deployer });

    // FtsoManager
    const ftsoManager = await FtsoManagerMock.new();
    await addressUpdater.addOrUpdateContractNamesAndAddresses(["FtsoManager"], [ftsoManager.address], { from: deployer });

    // create contracts
    const contracts: ChainContracts = {
        GovernanceSettings: newContract('GovernanceSettings', 'GovernanceSettings.sol', governanceSettings.address),
        AddressUpdater: newContract('AddressUpdater', 'AddressUpdater.sol', addressUpdater.address),
        StateConnector: newContract('StateConnector', 'StateConnectorMock.sol', stateConnector.address),
        WNat: newContract('WNat', 'WNat.sol', wNat.address),
        FtsoRegistry: newContract('FtsoRegistry', 'FtsoRegistryMock.sol', ftsoRegistry.address),
        FtsoManager: newContract('FtsoManager', 'FtsoManagerMock.sol', ftsoManager.address),
    };
    
    // add FTSOs
    for (const [symbol, contractName, initPrice] of ftsoList) {
        const ftso = await FtsoMock.new(symbol);
        await ftso.setCurrentPrice(toBNExp(initPrice, 5), 0);
        await ftso.setCurrentPriceFromTrustedProviders(toBNExp(initPrice, 5), 0);
        await ftsoRegistry.addFtso(ftso.address);
        contracts[contractName] = newContract(contractName, "Ftso.sol", ftso.address);
    }
    
    // console.log('FTSO indices:', (await ftsoRegistry.getSupportedIndices()).map(Number));
    // console.log('FTSO symbols:', await ftsoRegistry.getSupportedSymbols());
    // console.log('FTSOs:', await ftsoRegistry.getSupportedFtsos());

    // switch to production
    await addressUpdater.switchToProductionMode();
    await wNat.switchToProductionMode();

    // save contracts
    saveContracts(contractsFile, contracts);
}
