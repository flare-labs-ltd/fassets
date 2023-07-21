import {
    AddressUpdaterEvents, AgentVaultFactoryEvents, AssetManagerControllerEvents, SCProofVerifierEvents, ContingencyPoolFactoryEvents,
    ERC20Events, FtsoManagerEvents, FtsoEvents, FtsoRegistryEvents, StateConnectorEvents, WNatEvents, ContingencyPoolTokenFactoryEvents, PriceReaderEvents
} from "../../../lib/fasset/IAssetContext";
import { ContractWithEvents } from "../../../lib/utils/events/truffle";
import {
    AddressUpdaterInstance, AgentVaultFactoryInstance, AssetManagerControllerInstance, SCProofVerifierInstance, ContingencyPoolFactoryInstance,
    ERC20MockInstance, FtsoManagerMockInstance, FtsoMockInstance, FtsoRegistryMockInstance, GovernanceSettingsInstance, StateConnectorMockInstance, WNatInstance, ContingencyPoolTokenFactoryInstance, IPriceReaderInstance
} from "../../../typechain-truffle";
import { createFtsoMock } from "../../utils/test-settings";
import { GENESIS_GOVERNANCE_ADDRESS } from "../../utils/constants";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { testChainInfo, TestNatInfo, testNatInfo } from "./TestChainInfo";

const AgentVaultFactory = artifacts.require('AgentVaultFactory');
const ContingencyPoolFactory = artifacts.require("ContingencyPoolFactory");
const ContingencyPoolTokenFactory = artifacts.require("ContingencyPoolTokenFactory");
const SCProofVerifier = artifacts.require('SCProofVerifier');
const FtsoV1PriceReader = artifacts.require('FtsoV1PriceReader');
const AssetManagerController = artifacts.require('AssetManagerController');
const AddressUpdater = artifacts.require('AddressUpdater');
const WNat = artifacts.require('WNat');
const ERC20Mock = artifacts.require("ERC20Mock");
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const FtsoManagerMock = artifacts.require('FtsoManagerMock');
const StateConnector = artifacts.require('StateConnectorMock');
const GovernanceSettings = artifacts.require('GovernanceSettings');

// common context shared between several asset managers

// indexed by "key" (nat, usdc, etc.) or "ftso symbol" (NAT, USDC, etc.)
export type TestContextFtsos = Record<string, ContractWithEvents<FtsoMockInstance, FtsoEvents>>;

export class CommonContext {
    static deepCopyWithObjectCreate = true;

    constructor(
        public governance: string,
        public governanceSettings: GovernanceSettingsInstance,
        public addressUpdater: ContractWithEvents<AddressUpdaterInstance, AddressUpdaterEvents>,
        public assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>,
        public stateConnector: ContractWithEvents<StateConnectorMockInstance, StateConnectorEvents>,
        public agentVaultFactory: ContractWithEvents<AgentVaultFactoryInstance, AgentVaultFactoryEvents>,
        public contingencyPoolFactory: ContractWithEvents<ContingencyPoolFactoryInstance, ContingencyPoolFactoryEvents>,
        public contingencyPoolTokenFactory: ContractWithEvents<ContingencyPoolTokenFactoryInstance, ContingencyPoolTokenFactoryEvents>,
        public scProofVerifier: ContractWithEvents<SCProofVerifierInstance, SCProofVerifierEvents>,
        public priceReader: ContractWithEvents<IPriceReaderInstance, PriceReaderEvents>,
        public ftsoRegistry: ContractWithEvents<FtsoRegistryMockInstance, FtsoRegistryEvents>,
        public ftsoManager: ContractWithEvents<FtsoManagerMockInstance, FtsoManagerEvents>,
        public natInfo: TestNatInfo,
        public wNat: ContractWithEvents<WNatInstance, WNatEvents>,
        public stablecoins: Record<string, ContractWithEvents<ERC20MockInstance, ERC20Events>>,
        public ftsos: TestContextFtsos
    ) { }

    static async createTest(governance: string): Promise<CommonContext> {
        // create governance settings
        const governanceSettings = await GovernanceSettings.new();
        await governanceSettings.initialise(governance, 60, [governance], { from: GENESIS_GOVERNANCE_ADDRESS });
        // create state connector
        const stateConnector = await StateConnector.new();
        // create attestation client
        const scProofVerifier = await SCProofVerifier.new(stateConnector.address);
        // create address updater
        const addressUpdater = await AddressUpdater.new(governance); // don't switch to production
        // create WNat token
        const wNat = await WNat.new(governance, testNatInfo.name, testNatInfo.symbol);
        await setDefaultVPContract(wNat, governance);
        // create stablecoins
        const stablecoins = {
            USDC: await ERC20Mock.new("USDCoin", "USDC"),
            USDT: await ERC20Mock.new("Tether", "USDT"),
        };
        // create ftso registry
        const ftsoRegistry = await FtsoRegistryMock.new();
        // create ftsos
        const ftsos = await createTestFtsos(ftsoRegistry);
        // create FTSO manager mock (just for notifying about epoch finalization)
        const ftsoManager = await FtsoManagerMock.new();
        // add some addresses to address updater
        await addressUpdater.addOrUpdateContractNamesAndAddresses(
            ["GovernanceSettings", "AddressUpdater", "StateConnector", "FtsoManager", "FtsoRegistry", "WNat"],
            [governanceSettings.address, addressUpdater.address, stateConnector.address, ftsoManager.address, ftsoRegistry.address, wNat.address],
            { from: governance });
        // create price reader
        const priceReader = await FtsoV1PriceReader.new(addressUpdater.address, ftsoRegistry.address);
        // create agent vault factory
        const agentVaultFactory = await AgentVaultFactory.new();
        // create collateral pool and token factory
        const contingencyPoolFactory = await ContingencyPoolFactory.new();
        const contingencyPoolTokenFactory = await ContingencyPoolTokenFactory.new();
        // create asset manager controller
        const assetManagerController = await AssetManagerController.new(governanceSettings.address, governance, addressUpdater.address);
        await assetManagerController.switchToProductionMode({ from: governance });
        // collect
        return new CommonContext(governance, governanceSettings, addressUpdater, assetManagerController, stateConnector,
            agentVaultFactory, contingencyPoolFactory, contingencyPoolTokenFactory,
            scProofVerifier, priceReader, ftsoRegistry, ftsoManager, testNatInfo, wNat, stablecoins, ftsos);
    }
}

async function createTestFtsos(ftsoRegistry: FtsoRegistryMockInstance): Promise<TestContextFtsos> {
    const res: Partial<TestContextFtsos> = { };
    res[testNatInfo.symbol] = await createFtsoMock(ftsoRegistry, testNatInfo.symbol, testNatInfo.startPrice);
    res["USDC"] = await createFtsoMock(ftsoRegistry, "USDC", 1.01);
    res["USDT"] = await createFtsoMock(ftsoRegistry, "USDT", 0.99);
    for (const ci of Object.values(testChainInfo)) {
        res[ci.symbol] = await createFtsoMock(ftsoRegistry, ci.symbol, ci.startPrice);
    }
    return res as TestContextFtsos;
}
