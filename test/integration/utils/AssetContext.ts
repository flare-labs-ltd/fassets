import { time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralToken } from "../../../lib/fasset/AssetManagerTypes";
import { amgToNATWeiPrice, AMG_TOKENWEI_PRICE_SCALE } from "../../../lib/fasset/Conversions";
import { AssetManagerEvents, FAssetEvents, IAssetContext, WhitelistEvents } from "../../../lib/fasset/IAssetContext";
import { encodeLiquidationStrategyImplSettings, LiquidationStrategyImplSettings } from "../../../lib/fasset/LiquidationStrategyImpl";
import { AttestationHelper } from "../../../lib/underlying-chain/AttestationHelper";
import { IBlockChain } from "../../../lib/underlying-chain/interfaces/IBlockChain";
import { IStateConnectorClient } from "../../../lib/underlying-chain/interfaces/IStateConnectorClient";
import { UnderlyingChainEvents } from "../../../lib/underlying-chain/UnderlyingChainEvents";
import { EventScope } from "../../../lib/utils/events/ScopedEvents";
import { ContractWithEvents } from "../../../lib/utils/events/truffle";
import { BNish, toBN, toBNExp, toNumber } from "../../../lib/utils/helpers";
import { AssetManagerInstance, FAssetInstance, IAddressValidatorInstance, WhitelistInstance } from "../../../typechain-truffle";
import { createTestCollaterals, createTestLiquidationSettings, createTestSettings } from "../../unit/fasset/test-settings";
import { newAssetManager } from "../../utils/fasset/DeployAssetManager";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { CommonContext } from "./CommonContext";
import { TestChainInfo } from "./TestChainInfo";

const TrivialAddressValidatorMock = artifacts.require('TrivialAddressValidatorMock');

export interface SettingsOptions {
    // optional settings
    burnWithSelfDestruct?: boolean;
    collaterals?: CollateralToken[];
    liquidationSettings?: LiquidationStrategyImplSettings;
    // optional contracts
    whitelist?: ContractWithEvents<WhitelistInstance, WhitelistEvents>;
    agentWhitelist?: ContractWithEvents<WhitelistInstance, WhitelistEvents>;
}

// context, specific for each asset manager (includes common context vars)
export class AssetContext implements IAssetContext {
    constructor(
        public common: CommonContext,
        public chainInfo: TestChainInfo,
        public chain: IBlockChain,
        public chainEvents: UnderlyingChainEvents,
        public stateConnectorClient: IStateConnectorClient,
        public attestationProvider: AttestationHelper,
        public addressValidator: IAddressValidatorInstance,
        public whitelist: ContractWithEvents<WhitelistInstance, WhitelistEvents> | undefined,
        public agentWhitelist: ContractWithEvents<WhitelistInstance, WhitelistEvents> | undefined,
        public assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>,
        public fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>,
        // following three settings are initial and may not be fresh
        public settings: AssetManagerSettings,
        public collaterals: CollateralToken[],
        public liquidationSettings: LiquidationStrategyImplSettings,
    ) {
    }

    governance = this.common.governance;
    addressUpdater = this.common.addressUpdater;
    assetManagerController = this.common.assetManagerController;
    stateConnector = this.common.stateConnector;
    agentVaultFactory = this.common.agentVaultFactory;
    collateralPoolFactory = this.common.collateralPoolFactory;
    attestationClient = this.common.attestationClient;
    ftsoRegistry = this.common.ftsoRegistry;
    ftsoManager = this.common.ftsoManager;
    wnat = this.common.wNat;
    stablecoins = this.common.stablecoins;
    ftsos = this.common.ftsos;

    natFtso = this.ftsos.nat;
    assetFtso = this.ftsos.bySymbol[this.settings.assetFtsoSymbol];

    usdc = this.stablecoins.USDC;
    usdt = this.stablecoins.USDT;

    chainId = this.chainInfo.chainId;

    /**
     * Convert underlying amount to base units (e.g. eth to wei)
     */
    underlyingAmount(value: number) {
        return toBNExp(value, this.chainInfo.decimals);
    }

    async lotSize() {
        const settings = await this.assetManager.getSettings();
        return toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA));
    }

    async updateUnderlyingBlock() {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists();
        await this.assetManager.updateCurrentBlock(proof);
        return toNumber(proof.blockNumber) + toNumber(proof.numberOfConfirmations);
    }

    async currentAmgToNATWeiPrice() {
        // Force cast here to circument architecure in original contracts
        const { 0: natPrice, } = await this.natFtso.getCurrentPrice();
        const { 0: assetPrice, } = await this.assetFtso.getCurrentPrice();
        return this.amgToNATWeiPrice(natPrice, assetPrice);
    }

    async currentAmgToNATWeiPriceWithTrusted(): Promise<[ftsoPrice: BN, trustedPrice: BN]> {
        const { 0: natPrice, 1: natTimestamp } = await this.natFtso.getCurrentPrice();
        const { 0: assetPrice, 1: assetTimestamp } = await this.assetFtso.getCurrentPrice();
        const { 0: natPriceTrusted, 1: natTimestampTrusted } = await this.natFtso.getCurrentPriceFromTrustedProviders();
        const { 0: assetPriceTrusted, 1: assetTimestampTrusted } = await this.assetFtso.getCurrentPriceFromTrustedProviders();
        const ftsoPrice = this.amgToNATWeiPrice(natPrice, assetPrice);
        const trustedPrice = natTimestampTrusted.add(toBN(this.settings.maxTrustedPriceAgeSeconds)).gte(natTimestamp) &&
            assetTimestampTrusted.add(toBN(this.settings.maxTrustedPriceAgeSeconds)).gte(assetTimestamp) ?
            this.amgToNATWeiPrice(natPriceTrusted, assetPriceTrusted) : ftsoPrice;
        return [ftsoPrice, trustedPrice];
    }

    amgToNATWeiPrice(natPriceUSDDec5: BNish, assetPriceUSDDec5: BNish) {
        return amgToNATWeiPrice(this.settings, natPriceUSDDec5, assetPriceUSDDec5);
    }

    convertAmgToUBA(valueAMG: BNish) {
        return toBN(valueAMG).mul(toBN(this.settings.assetMintingGranularityUBA));
    }

    convertUBAToAmg(valueUBA: BNish) {
        return toBN(valueUBA).div(toBN(this.settings.assetMintingGranularityUBA));
    }

    async convertUBAToLots(valueUBA: BNish) {
        return toBN(valueUBA).div(await this.lotSize());
    }

    async convertLotsToUBA(lots: BNish) {
        return toBN(lots).mul(await this.lotSize());
    }

    async convertLotsToAMG(lots: BNish) {
        const settings = await this.assetManager.getSettings();
        return toBN(lots).mul(toBN(settings.lotSizeAMG));
    }

    convertAmgToNATWei(valueAMG: BNish, amgToNATWeiPrice: BNish) {
        return toBN(valueAMG).mul(toBN(amgToNATWeiPrice)).div(AMG_TOKENWEI_PRICE_SCALE);
    }

    convertNATWeiToAMG(valueNATWei: BNish, amgToNATWeiPrice: BNish) {
        return toBN(valueNATWei).mul(AMG_TOKENWEI_PRICE_SCALE).div(toBN(amgToNATWeiPrice));
    }

    convertUBAToNATWei(valueUBA: BNish, amgToNATWeiPrice: BNish) {
        return this.convertAmgToNATWei(this.convertUBAToAmg(valueUBA), amgToNATWeiPrice);
    }

    async waitForUnderlyingTransaction(scope: EventScope | undefined, txHash: string, maxBlocksToWaitForTx?: number) {
        return this.chainEvents.waitForUnderlyingTransaction(scope, txHash, maxBlocksToWaitForTx);
    }

    async waitForUnderlyingTransactionFinalization(scope: EventScope | undefined, txHash: string, maxBlocksToWaitForTx?: number) {
        return this.chainEvents.waitForUnderlyingTransactionFinalization(scope, txHash, maxBlocksToWaitForTx);
    }

    static async createTest(common: CommonContext, chainInfo: TestChainInfo, options: SettingsOptions = {}): Promise<AssetContext> {
        // create mock chain
        const chain = new MockChain(await time.latest());
        chain.secondsPerBlock = chainInfo.blockTime;
        // chain event listener
        const chainEvents = new UnderlyingChainEvents(chain, chain /* as IBlockChainEvents */, null);
        // create mock attestation provider
        const stateConnectorClient = new MockStateConnectorClient(common.stateConnector, { [chainInfo.chainId]: chain }, 'on_wait');
        const attestationProvider = new AttestationHelper(stateConnectorClient, chain, chainInfo.chainId);
        // create address validator
        const addressValidator = await TrivialAddressValidatorMock.new();
        // create liquidation strategy (dynamic library)
        const liquidationStrategyLib = await artifacts.require("LiquidationStrategyImpl").new();
        const liquidationStrategy = liquidationStrategyLib.address;
        // create collaterals
        const testSettingsContracts = { ...common, addressValidator, liquidationStrategy };
        // create settings
        const settings = createTestSettings(testSettingsContracts, chainInfo, { burnWithSelfDestruct: options.burnWithSelfDestruct });
        const collaterals = options.collaterals ?? createTestCollaterals(testSettingsContracts);
        const liquidationSettings = options.liquidationSettings ?? createTestLiquidationSettings();
        // web3DeepNormalize is required when passing structs, otherwise BN is incorrectly serialized
        const [assetManager, fAsset] = await newAssetManager(common.governance, common.assetManagerController,
            chainInfo.name, chainInfo.symbol, chainInfo.decimals, settings, collaterals, encodeLiquidationStrategyImplSettings(liquidationSettings));
        return new AssetContext(common, chainInfo, chain, chainEvents, stateConnectorClient, attestationProvider, addressValidator,
            options.whitelist, options.agentWhitelist, assetManager, fAsset, settings, collaterals, liquidationSettings);
    }
}

export class AssetContextClient {
    constructor(
        public context: AssetContext,
    ) { }

    protected assetManager = this.context.assetManager;
    protected chain = this.context.chain;
    protected attestationProvider = this.context.attestationProvider;
    protected wnat = this.context.wnat;
    protected usdc = this.context.usdc;
    protected fAsset = this.context.fAsset;
}
