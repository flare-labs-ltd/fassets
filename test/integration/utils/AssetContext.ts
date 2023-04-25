import { time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralToken } from "../../../lib/fasset/AssetManagerTypes";
import { convertAmgToTokenWei, convertAmgToUBA, convertTokenWeiToAMG, convertUBAToAmg } from "../../../lib/fasset/Conversions";
import { AssetManagerEvents, FAssetEvents, IAssetContext, WhitelistEvents } from "../../../lib/fasset/IAssetContext";
import { LiquidationStrategyImplSettings, encodeLiquidationStrategyImplSettings } from "../../../lib/fasset/LiquidationStrategyImpl";
import { Prices } from "../../../lib/state/Prices";
import { AttestationHelper } from "../../../lib/underlying-chain/AttestationHelper";
import { UnderlyingChainEvents } from "../../../lib/underlying-chain/UnderlyingChainEvents";
import { IBlockChain } from "../../../lib/underlying-chain/interfaces/IBlockChain";
import { IStateConnectorClient } from "../../../lib/underlying-chain/interfaces/IStateConnectorClient";
import { EventScope } from "../../../lib/utils/events/ScopedEvents";
import { ContractWithEvents } from "../../../lib/utils/events/truffle";
import { BNish, requireNotNull, toBN, toBNExp, toNumber } from "../../../lib/utils/helpers";
import { AssetManagerInstance, FAssetInstance, IAddressValidatorInstance, WhitelistInstance } from "../../../typechain-truffle";
import { createTestCollaterals, createTestLiquidationSettings, createTestSettings } from "../../unit/fasset/test-settings";
import { newAssetManager } from "../../utils/fasset/DeployAssetManager";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { CommonContext } from "./CommonContext";
import { TestChainInfo } from "./TestChainInfo";
import { TokenPriceReader } from "../../../lib/state/TokenPrice";
import { CollateralPrice } from "../../../lib/state/CollateralPrice";

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
    natInfo = this.common.natInfo;
    wNat = this.common.wNat;
    stablecoins = this.common.stablecoins;
    ftsos = this.common.ftsos;

    natFtso = requireNotNull(this.ftsos[this.natInfo.symbol]);

    usdc = this.stablecoins.USDC;
    usdt = this.stablecoins.USDT;

    chainId = this.chainInfo.chainId;

    /**
     * Convert underlying amount to base units (e.g. eth to wei)
     */
    underlyingAmount(value: number) {
        return toBNExp(value, this.chainInfo.decimals);
    }

    async refreshSettings() {
        this.settings = await this.assetManager.getSettings();
    }

    lotSize() {
        return toBN(this.settings.lotSizeAMG).mul(toBN(this.settings.assetMintingGranularityUBA));
    }

    async setLotSizeAmg(newLotSizeAMG: BNish) {
        await this.assetManagerController.setLotSizeAmg([this.assetManager.address], newLotSizeAMG, { from: this.governance });
        await this.refreshSettings();
    }

    async updateUnderlyingBlock() {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists();
        await this.assetManager.updateCurrentBlock(proof);
        return toNumber(proof.blockNumber) + toNumber(proof.numberOfConfirmations);
    }

    convertAmgToUBA(valueAMG: BNish) {
        return convertAmgToUBA(this.settings, valueAMG);
    }

    convertUBAToAmg(valueUBA: BNish) {
        return convertUBAToAmg(this.settings, valueUBA);
    }

    convertUBAToLots(valueUBA: BNish) {
        return toBN(valueUBA).div(this.lotSize());
    }

    convertLotsToUBA(lots: BNish) {
        return toBN(lots).mul(this.lotSize());
    }

    convertLotsToAMG(lots: BNish) {
        return toBN(lots).mul(toBN(this.settings.lotSizeAMG));
    }

    convertAmgToNATWei(valueAMG: BNish, amgToNATWeiPrice: BNish) {
        return convertAmgToTokenWei(valueAMG, amgToNATWeiPrice);
    }

    convertNATWeiToAMG(valueNATWei: BNish, amgToNATWeiPrice: BNish) {
        return convertTokenWeiToAMG(valueNATWei, amgToNATWeiPrice);
    }

    convertUBAToNATWei(valueUBA: BNish, amgToNATWeiPrice: BNish) {
        return this.convertAmgToNATWei(this.convertUBAToAmg(valueUBA), amgToNATWeiPrice);
    }

    tokenName(address: string) {
        if (address === this.wNat.address) {
            return "NAT";
        } else if (address === this.fAsset.address) {
            return 'f' + this.chainInfo.symbol;
        } else {
            for (const [name, token] of Object.entries(this.stablecoins)) {
                if (address === token.address) return name.toUpperCase();
            }
        }
        return '?TOKEN?';
    }

    async waitForUnderlyingTransaction(scope: EventScope | undefined, txHash: string, maxBlocksToWaitForTx?: number) {
        return this.chainEvents.waitForUnderlyingTransaction(scope, txHash, maxBlocksToWaitForTx);
    }

    async waitForUnderlyingTransactionFinalization(scope: EventScope | undefined, txHash: string, maxBlocksToWaitForTx?: number) {
        return this.chainEvents.waitForUnderlyingTransactionFinalization(scope, txHash, maxBlocksToWaitForTx);
    }

    getCollateralPrice(collateral: CollateralToken, trusted: boolean = false) {
        const priceReader = new TokenPriceReader(this.ftsoRegistry);
        return CollateralPrice.forCollateral(priceReader, this.settings, collateral, trusted);
    }

    getPrices() {
        return Prices.getPrices(this, this.settings, this.collaterals);
    }

    skipToProofUnavailability(lastUnderlyingBlock: BNish, lastUnderlyingTimestamp: BNish) {
        const chain = this.chain as MockChain;
        const stateConnectorClient = this.stateConnectorClient as MockStateConnectorClient;
        chain.skipTimeTo(Number(lastUnderlyingTimestamp) + 1);
        chain.mineTo(Number(lastUnderlyingBlock) + 1);
        chain.skipTime(stateConnectorClient.queryWindowSeconds + 1);
        chain.mine(chain.finalizationBlocks);
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
        const collaterals = options.collaterals ?? createTestCollaterals(testSettingsContracts, chainInfo);
        const liquidationSettings = options.liquidationSettings ?? createTestLiquidationSettings();
        // create asset manager
        const [assetManager, fAsset] = await newAssetManager(common.governance, common.assetManagerController,
            chainInfo.name, chainInfo.symbol, chainInfo.decimals, settings, collaterals, encodeLiquidationStrategyImplSettings(liquidationSettings));
        // collect
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
    protected wnat = this.context.wNat;
    protected usdc = this.context.usdc;
    protected fAsset = this.context.fAsset;
}
