import { constants, time } from "@openzeppelin/test-helpers";
import {
    AddressUpdaterEvents, AgentVaultFactoryEvents, AssetManagerControllerEvents, FdcVerificationEvents, CollateralPoolFactoryEvents,
    ERC20Events, FtsoManagerEvents, FtsoEvents, FtsoRegistryEvents, WNatEvents, CollateralPoolTokenFactoryEvents, PriceReaderEvents,
    FdcHubEvents, RelayEvents
} from "../../../lib/fasset/IAssetContext";
import { ContractWithEvents } from "../../../lib/utils/events/truffle";
import { requireNotNull, toBNExp, WEEKS } from "../../../lib/utils/helpers";
import {
    AddressUpdaterInstance, AgentVaultFactoryInstance, AssetManagerControllerInstance, CollateralPoolFactoryInstance,
    ERC20MockInstance, FtsoManagerMockInstance, FtsoMockInstance, FtsoRegistryMockInstance, GovernanceSettingsInstance, WNatInstance, CollateralPoolTokenFactoryInstance, IPriceReaderInstance,
    RelayMockInstance,
    FdcHubMockInstance,
    FdcVerificationMockInstance
} from "../../../typechain-truffle";
import { GENESIS_GOVERNANCE_ADDRESS } from "../../utils/constants";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { TestChainInfo, testChainInfo, TestNatInfo, testNatInfo } from "./TestChainInfo";
import { newAssetManagerController } from "../../utils/fasset/CreateAssetManager";

const AgentVault = artifacts.require("AgentVault");
const AgentVaultFactory = artifacts.require('AgentVaultFactory');
const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolFactory = artifacts.require("CollateralPoolFactory");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");
const CollateralPoolTokenFactory = artifacts.require("CollateralPoolTokenFactory");
const FdcVerification = artifacts.require('FdcVerificationMock');
const FtsoV2PriceStoreMock = artifacts.require('FtsoV2PriceStoreMock');
const AddressUpdater = artifacts.require('AddressUpdater');
const WNat = artifacts.require('WNat');
const ERC20Mock = artifacts.require("ERC20Mock");
const Relay = artifacts.require('RelayMock');
const FdcHub = artifacts.require('FdcHubMock');
const GovernanceSettings = artifacts.require('GovernanceSettings');

// common context shared between several asset managers

export class CommonContext {
    static deepCopyWithObjectCreate = true;

    constructor(
        public governance: string,
        public governanceSettings: GovernanceSettingsInstance,
        public addressUpdater: ContractWithEvents<AddressUpdaterInstance, AddressUpdaterEvents>,
        public assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>,
        public relay: ContractWithEvents<RelayMockInstance, RelayEvents>,
        public fdcHub: ContractWithEvents<FdcHubMockInstance, FdcHubEvents>,
        public agentVaultFactory: ContractWithEvents<AgentVaultFactoryInstance, AgentVaultFactoryEvents>,
        public collateralPoolFactory: ContractWithEvents<CollateralPoolFactoryInstance, CollateralPoolFactoryEvents>,
        public collateralPoolTokenFactory: ContractWithEvents<CollateralPoolTokenFactoryInstance, CollateralPoolTokenFactoryEvents>,
        public fdcVerification: ContractWithEvents<FdcVerificationMockInstance, FdcVerificationEvents>,
        public priceReader: ContractWithEvents<IPriceReaderInstance, PriceReaderEvents>,
        public priceStore: ContractWithEvents<FtsoV2PriceStoreMockInstance, FtsoV2PriceStoreEvents>,
        public natInfo: TestNatInfo,
        public wNat: ContractWithEvents<WNatInstance, WNatEvents>,
        public stablecoins: Record<string, ContractWithEvents<ERC20MockInstance, ERC20Events>>,
    ) { }

    static async createTest(governance: string): Promise<CommonContext> {
        // create governance settings
        const governanceSettings = await GovernanceSettings.new();
        await governanceSettings.initialise(governance, 60, [governance], { from: GENESIS_GOVERNANCE_ADDRESS });
        // create FdcHub
        const fdcHub = await FdcHub.new();
        // create Relay
        const relay = await Relay.new();
        // create attestation client
        const fdcVerification = await FdcVerification.new(relay.address, 200);
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
        // create price reader
        const priceStore = await createMockFtsoV2PriceStore(governanceSettings.address, governance, addressUpdater.address, testChainInfo);
        // add some addresses to address updater
        await addressUpdater.addOrUpdateContractNamesAndAddresses(
            ["GovernanceSettings", "AddressUpdater", "FdcHub", "Relay", "FtsoV2PriceStore", "WNat"],
            [governanceSettings.address, addressUpdater.address, fdcHub.address, relay.address, priceStore.address, wNat.address],
            { from: governance });
        // create agent vault factory
        const agentVaultImplementation = await AgentVault.new(constants.ZERO_ADDRESS);
        const agentVaultFactory = await AgentVaultFactory.new(agentVaultImplementation.address);
        // create collateral pool factory
        const collateralPoolImplementation = await CollateralPool.new(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, 0, 0, 0);
        const collateralPoolFactory = await CollateralPoolFactory.new(collateralPoolImplementation.address);
        // create collateral pool token factory
        const collateralPoolTokenImplementation = await CollateralPoolToken.new(constants.ZERO_ADDRESS, "", "");
        const collateralPoolTokenFactory = await CollateralPoolTokenFactory.new(collateralPoolTokenImplementation.address);
        // create asset manager controller
        const assetManagerController = await newAssetManagerController(governanceSettings.address, governance, addressUpdater.address);
        await assetManagerController.switchToProductionMode({ from: governance });
        // collect
        return new CommonContext(governance, governanceSettings, addressUpdater, assetManagerController, relay, fdcHub,
            agentVaultFactory, collateralPoolFactory, collateralPoolTokenFactory,
            fdcVerification, priceStore, priceStore, testNatInfo, wNat, stablecoins);
    }
}

export async function createMockFtsoV2PriceStore(governanceSettingsAddress: string, initialGovernance: string, addressUpdater: string, assetChainInfos: Record<string, TestChainInfo>) {
    const currentTime = await time.latest();
    const votingEpochDurationSeconds = 90;
    const firstVotingRoundStartTs = currentTime.toNumber() - 1 * WEEKS;
    const ftsoScalingProtocolId = 100;
    // create store
    const priceStore = await FtsoV2PriceStoreMock.new(governanceSettingsAddress, initialGovernance, addressUpdater,
        firstVotingRoundStartTs, votingEpochDurationSeconds, ftsoScalingProtocolId);
    // setup
    const feedIdArr = ["0xc1", "0xc2", "0xc3"];
    const symbolArr = ["NAT", "USDC", "USDT"];
    const decimalsArr = [5, 5, 5];
    for (const [i, ci] of Object.values(assetChainInfos).entries()) {
        feedIdArr.push(`0xa${i + 1}`);
        symbolArr.push(ci.symbol);
        decimalsArr.push(5);
    }
    await priceStore.updateSettings(feedIdArr, symbolArr, decimalsArr, { from: initialGovernance });
    // init prices
    async function setInitPrice(symbol: string, price: number | string) {
        const decimals = requireNotNull(decimalsArr[symbolArr.indexOf(symbol)]);
        await priceStore.setCurrentPrice(symbol, toBNExp(price, decimals), 0);
        await priceStore.setCurrentPriceFromTrustedProviders(symbol, toBNExp(price, decimals), 0);
}
    await setInitPrice("NAT", 0.42);
    await setInitPrice("USDC", 1.01);
    await setInitPrice("USDT", 0.99);
    for (const ci of Object.values(assetChainInfos)) {
        await setInitPrice(ci.symbol, ci.startPrice);
    }
    //
    return priceStore;
}
