import { IERC20Instance } from "../../typechain-truffle";
import { AgentStatus, AssetManagerSettings, CollateralToken } from "../fasset/AssetManagerTypes";
import { AssetManagerEvents, ERC20Events, IAssetContext } from "../fasset/IAssetContext";
import { UnderlyingChainEvents } from "../underlying-chain/UnderlyingChainEvents";
import { EventFormatter } from "../utils/events/EventFormatter";
import { IEvmEvents } from "../utils/events/IEvmEvents";
import { EventExecutionQueue, TriggerableEvent } from "../utils/events/ScopedEvents";
import { EvmEvent, ExtractedEventArgs } from "../utils/events/common";
import { ContractWithEvents } from "../utils/events/truffle";
import { BN_ZERO, toBN } from "../utils/helpers";
import { stringifyJson } from "../utils/json-bn";
import { ILogger } from "../utils/logging";
import { web3DeepNormalize, web3Normalize } from "../utils/web3normalize";
import { CollateralList, isPoolCollateral } from "./CollateralIndexedList";
import { Prices } from "./Prices";
import { InitialAgentData, TrackedAgentState } from "./TrackedAgentState";

const IERC20 = artifacts.require("IERC20");
const CollateralPool = artifacts.require("CollateralPool");

export class TrackedState {
    constructor(
        public context: IAssetContext,
        public truffleEvents: IEvmEvents,
        public chainEvents: UnderlyingChainEvents,
        public eventFormatter: EventFormatter,
        public eventQueue: EventExecutionQueue,
    ) {
    }

    // state
    fAssetSupply = BN_ZERO;

    // must call initialize to init prices and settings
    prices!: Prices;
    trustedPrices!: Prices;

    // settings
    settings!: AssetManagerSettings;
    collaterals = new CollateralList();
    poolWNatColateral!: CollateralToken;

    // agent state
    agents: Map<string, TrackedAgentState> = new Map();                // map agent_address => agent state
    agentsByUnderlying: Map<string, TrackedAgentState> = new Map();    // map underlying_address => agent state
    agentsByPool: Map<string, TrackedAgentState> = new Map();          // map pool_address => agent state

    // settings
    logger?: ILogger;

    // synthetic events
    pricesUpdated = new TriggerableEvent<void>(this.eventQueue);

    // async initialization part
    async initialize() {
        this.settings = await this.context.assetManager.getSettings();
        const collateralTokens = await this.context.assetManager.getCollateralTokens();
        for (const collateralToken of collateralTokens) {
            const collateral = await this.addCollateralToken(collateralToken);
            // poolColateral will be the last active collateral of class pool
            if (isPoolCollateral(collateral)) {
                this.poolWNatColateral = collateral;
            }
        }
        [this.prices, this.trustedPrices] = await this.getPrices();
        this.fAssetSupply = await this.context.fAsset.totalSupply();
        this.registerHandlers();
    }

    async getPrices(): Promise<[Prices, Prices]> {
        return await Prices.getPrices(this.context, this.settings, this.collaterals);
    }

    registerHandlers() {
        // track total supply of fAsset
        this.assetManagerEvent('MintingExecuted').subscribe(args => {
            this.fAssetSupply = this.fAssetSupply.add(toBN(args.mintedAmountUBA));
        });
        this.assetManagerEvent('RedemptionRequested').subscribe(args => {
            this.fAssetSupply = this.fAssetSupply.sub(toBN(args.valueUBA));
        });
        this.assetManagerEvent('SelfClose').subscribe(args => {
            this.fAssetSupply = this.fAssetSupply.sub(toBN(args.valueUBA));
        });
        this.assetManagerEvent('LiquidationPerformed').subscribe(args => {
            this.fAssetSupply = this.fAssetSupply.sub(toBN(args.valueUBA));
        });
        // track setting changes
        this.assetManagerEvent('SettingChanged').subscribe(args => {
            if (!(args.name in this.settings)) assert.fail(`Invalid setting change ${args.name}`);
            this.logger?.log(`SETTING CHANGED ${args.name} FROM ${(this.settings as any)[args.name]} TO ${args.value}`);
            (this.settings as any)[args.name] = web3Normalize(args.value);
        });
        this.assetManagerEvent('SettingArrayChanged').subscribe(args => {
            if (!(args.name in this.settings)) assert.fail(`Invalid setting array change ${args.name}`);
            this.logger?.log(`SETTING ARRAY CHANGED ${args.name} FROM ${stringifyJson((this.settings as any)[args.name])} TO ${stringifyJson(args.value)}`);
            (this.settings as any)[args.name] = web3DeepNormalize(args.value);
        });
        // track collateral token changes
        this.assetManagerEvent('CollateralTokenAdded').subscribe(args => {
            void this.addCollateralToken({ ...args, validUntil: BN_ZERO });
        });
        this.assetManagerEvent('CollateralTokenRatiosChanged').subscribe(args => {
            const collateral = this.collaterals.get(args.tokenClass, args.tokenContract);
            collateral.minCollateralRatioBIPS = toBN(args.minCollateralRatioBIPS);
            collateral.ccbMinCollateralRatioBIPS = toBN(args.ccbMinCollateralRatioBIPS);
            collateral.safetyMinCollateralRatioBIPS = toBN(args.safetyMinCollateralRatioBIPS);
        });
        this.assetManagerEvent('CollateralTokenDeprecated').subscribe(args => {
            const collateral = this.collaterals.get(args.tokenClass, args.tokenContract);
            collateral.validUntil = toBN(args.validUntil);
        });
        // track price changes
        this.truffleEvents.event(this.context.ftsoManager, 'PriceEpochFinalized').subscribe(async args => {
            const [prices, trustedPrices] = await this.getPrices();
            this.logger?.log(`PRICES CHANGED  ftso=${this.prices}->${prices}  trusted=${this.trustedPrices}->${trustedPrices}`);
            [this.prices, this.trustedPrices] = [prices, trustedPrices];
            // trigger event
            this.pricesUpdated.trigger();
        });
        // agents
        this.registerAgentHandlers();
    }

    private registerAgentHandlers() {
        // agent create / destroy
        this.assetManagerEvent('AgentCreated').subscribe(args => this.createAgent({ ...args, poolWNat: this.poolWNatColateral.token }));
        this.assetManagerEvent('AgentDestroyed').subscribe(args => this.destroyAgent(args.agentVault));
        // status changes
        this.assetManagerEvent('AgentInCCB').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleStatusChange(AgentStatus.CCB, args.timestamp));
        this.assetManagerEvent('LiquidationStarted').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleStatusChange(AgentStatus.LIQUIDATION, args.timestamp));
        this.assetManagerEvent('FullLiquidationStarted').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleStatusChange(AgentStatus.FULL_LIQUIDATION, args.timestamp));
        this.assetManagerEvent('LiquidationEnded').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleStatusChange(AgentStatus.NORMAL));
        this.assetManagerEvent('AgentDestroyAnnounced').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleStatusChange(AgentStatus.DESTROYING));
        // enter/exit available agents list
        this.assetManagerEvent('AgentAvailable').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleAgentAvailable(args));
        this.assetManagerEvent('AvailableAgentExited').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleAvailableAgentExited(args));
        // agent settings
        this.assetManagerEvent('AgentSettingChanged').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleSettingChanged(args.name, args.value));
        // minting
        this.assetManagerEvent('CollateralReserved').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleCollateralReserved(args));
        this.assetManagerEvent('MintingExecuted').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleMintingExecuted(args));
        this.assetManagerEvent('MintingPaymentDefault').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleMintingPaymentDefault(args));
        this.assetManagerEvent('CollateralReservationDeleted').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleCollateralReservationDeleted(args));
        // redemption and self-close
        this.assetManagerEvent('RedemptionRequested').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleRedemptionRequested(args));
        this.assetManagerEvent('RedemptionPerformed').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleRedemptionPerformed(args));
        this.assetManagerEvent('RedemptionDefault').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleRedemptionDefault(args));
        this.assetManagerEvent('RedemptionPaymentBlocked').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleRedemptionPaymentBlocked(args));
        this.assetManagerEvent('RedemptionPaymentFailed').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleRedemptionPaymentFailed(args));
        this.assetManagerEvent('SelfClose').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleSelfClose(args));
        // underlying topup and withdrawal
        this.assetManagerEvent('UnderlyingBalanceToppedUp').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleUnderlyingBalanceToppedUp(args));
        this.assetManagerEvent('UnderlyingWithdrawalAnnounced').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleUnderlyingWithdrawalAnnounced(args));
        this.assetManagerEvent('UnderlyingWithdrawalConfirmed').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleUnderlyingWithdrawalConfirmed(args));
        this.assetManagerEvent('UnderlyingWithdrawalCancelled').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleUnderlyingWithdrawalCancelled(args));
        // track dust
        this.assetManagerEvent('DustConvertedToTicket').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleDustConvertedToTicket(args));
        this.assetManagerEvent('DustChanged').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleDustChanged(args));
        // liquidation
        this.assetManagerEvent('LiquidationPerformed').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleLiquidationPerformed(args));
    }

    private async addCollateralToken(data: CollateralToken) {
        const collateral: CollateralToken = {
            tokenClass: toBN(data.tokenClass),
            token: data.token,
            decimals: toBN(data.decimals),
            validUntil: data.validUntil,
            directPricePair: data.directPricePair,
            assetFtsoSymbol: data.assetFtsoSymbol,
            tokenFtsoSymbol: data.tokenFtsoSymbol,
            minCollateralRatioBIPS: toBN(data.minCollateralRatioBIPS),
            ccbMinCollateralRatioBIPS: toBN(data.ccbMinCollateralRatioBIPS),
            safetyMinCollateralRatioBIPS: toBN(data.safetyMinCollateralRatioBIPS),
        };
        this.collaterals.add(collateral);
        await this.registerCollateralHandlers(data.token);
        return collateral;
    }

    private async registerCollateralHandlers(tokenAddress: string) {
        const token: ContractWithEvents<IERC20Instance, ERC20Events> = await IERC20.at(tokenAddress);
        this.truffleEvents.event(token, 'Transfer').immediate().subscribe(args => {
            this.agents.get(args.from)?.withdrawCollateral(tokenAddress, toBN(args.value));
            this.agents.get(args.to)?.depositCollateral(tokenAddress, toBN(args.value));
            this.agentsByPool.get(args.from)?.withdrawPoolCollateral(tokenAddress, toBN(args.value));
            this.agentsByPool.get(args.to)?.depositPoolCollateral(tokenAddress, toBN(args.value));
        });
    }

    getAgent(address: string): TrackedAgentState | undefined {
        return this.agents.get(address);
    }

    getAgentTriggerAdd(address: string): TrackedAgentState | undefined {
        const agent = this.agents.get(address);
        if (!agent) {
            void this.createAgentWithCurrentState(address); // create in background
        }
        return agent;
    }

    async createAgentWithCurrentState(address: string) {
        const agentInfo = await this.context.assetManager.getAgentInfo(address);
        const poolWNat = await CollateralPool.at(agentInfo.collateralPool).then(pool => pool.wNat());
        const agent = this.createAgent({
            agentVault: address,
            owner: agentInfo.ownerColdWalletAddress,
            underlyingAddress: agentInfo.underlyingAddressString,
            collateralPool: agentInfo.collateralPool,
            class1CollateralToken: agentInfo.class1CollateralToken,
            poolWNat: poolWNat,
            feeBIPS: agentInfo.feeBIPS,
            poolFeeShareBIPS: agentInfo.poolFeeShareBIPS,
            mintingClass1CollateralRatioBIPS: agentInfo.mintingClass1CollateralRatioBIPS,
            mintingPoolCollateralRatioBIPS: agentInfo.mintingPoolCollateralRatioBIPS,
            buyFAssetByAgentFactorBIPS: agentInfo.buyFAssetByAgentFactorBIPS,
            poolExitCollateralRatioBIPS: agentInfo.poolExitCollateralRatioBIPS,
            poolTopupCollateralRatioBIPS: agentInfo.poolTopupCollateralRatioBIPS,
            poolTopupTokenPriceFactorBIPS: agentInfo.poolTopupTokenPriceFactorBIPS,
        });
        agent.initializeState(agentInfo);
    }

    createAgent(data: InitialAgentData) {
        const agent = this.newAgent(data);
        this.agents.set(data.agentVault, agent);
        this.agentsByUnderlying.set(data.underlyingAddress, agent);
        this.agentsByPool.set(data.collateralPool, agent);
        return agent;
    }

    protected newAgent(data: InitialAgentData) {
        return new TrackedAgentState(this, data);
    }

    destroyAgent(address: string) {
        const agent = this.getAgent(address);
        if (agent) {
            this.agents.delete(address);
            this.agentsByUnderlying.delete(agent.underlyingAddressString);
            this.agentsByPool.delete(agent.collateralPoolAddress);
        }
    }

    // helpers

    assetManagerEvent<N extends AssetManagerEvents['name']>(event: N, filter?: Partial<ExtractedEventArgs<AssetManagerEvents, N>>) {
        return this.truffleEvents.event(this.context.assetManager, event, filter).immediate();
    }

    // getters

    lotSize() {
        return toBN(this.settings.lotSizeAMG).mul(toBN(this.settings.assetMintingGranularityUBA));
    }

    // logs

    expect(condition: boolean, message: string, event: EvmEvent) {
        if (!condition && this.logger) {
            this.logger.log(`!!! AssetState expectation failed: ${message}  ${this.eventInfo(event)}`)
        }
    }

    eventInfo(event: EvmEvent) {
        return `event=${event.event} at ${event.blockNumber}.${event.logIndex}`;
    }

    logAllAgentSummaries() {
        if (!this.logger) return;
        this.logger.log("\nAGENT SUMMARIES");
        for (const agent of this.agents.values()) {
            agent.writeAgentSummary(this.logger);
        }
    }
}
