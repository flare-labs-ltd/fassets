import { AssetManagerSettings } from "../fasset/AssetManagerTypes";
import { AssetManagerEvents, IAssetContext } from "../fasset/IAssetContext";
import { UnderlyingChainEvents } from "../underlying-chain/UnderlyingChainEvents";
import { EventFormatter } from "../utils/EventFormatter";
import { EvmEvent, ExtractedEventArgs } from "../utils/events/common";
import { IEvmEvents } from "../utils/events/IEvmEvents";
import { EventExecutionQueue, TriggerableEvent } from "../utils/events/ScopedEvents";
import { BN_ZERO, toBN } from "../utils/helpers";
import { stringifyJson } from "../utils/json-bn";
import { ILogger } from "../utils/logging";
import { web3DeepNormalize, web3Normalize } from "../utils/web3normalize";
import { AgentStatus, TrackedAgentState } from "./TrackedAgentState";
import { Prices } from "./Prices";

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

    // agent state
    agents: Map<string, TrackedAgentState> = new Map();                // map agent_address => agent state
    agentsByUnderlying: Map<string, TrackedAgentState> = new Map();    // map underlying_address => agent state

    // settings
    logger?: ILogger;

    // synthetic events
    pricesUpdated = new TriggerableEvent<void>(this.eventQueue);

    // async initialization part
    async initialize() {
        this.settings = await this.context.assetManager.getSettings();
        [this.prices, this.trustedPrices] = await this.getPrices();
        this.fAssetSupply = await this.context.fAsset.totalSupply();
        this.registerHandlers();
    }

    async getPrices(): Promise<[Prices, Prices]> {
        return await Prices.getPrices(this.context, this.settings);
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
        this.assetManagerEvent('AgentCreated').subscribe(args => this.createAgent(args.agentVault, args.owner, args.underlyingAddress));
        this.assetManagerEvent('AgentDestroyed').subscribe(args => this.destroyAgent(args.agentVault));
        // collateral deposit / whithdrawal
        this.truffleEvents.event(this.context.wNat, 'Transfer').immediate().subscribe(args => {
            this.agents.get(args.from)?.withdrawCollateral(toBN(args.value));
            this.agents.get(args.to)?.depositCollateral(toBN(args.value));
        });
        // status changes
        this.assetManagerEvent('AgentInCCB').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleStatusChange(AgentStatus.CCB, args.timestamp));
        this.assetManagerEvent('LiquidationStarted').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleStatusChange(AgentStatus.LIQUIDATION, args.timestamp));
        this.assetManagerEvent('FullLiquidationStarted').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleStatusChange(AgentStatus.FULL_LIQUIDATION, args.timestamp));
        this.assetManagerEvent('LiquidationEnded').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleStatusChange(AgentStatus.NORMAL));
        this.assetManagerEvent('AgentDestroyAnnounced').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleStatusChange(AgentStatus.DESTROYING));
        // enter/exit available agents list
        this.assetManagerEvent('AgentAvailable').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleAgentAvailable(args));
        this.assetManagerEvent('AvailableAgentExited').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleAvailableAgentExited(args));
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
        this.assetManagerEvent('RedemptionFinished').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleRedemptionFinished(args));
        this.assetManagerEvent('SelfClose').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleSelfClose(args));
        // underlying withdrawal
        this.assetManagerEvent('UnderlyingWithdrawalAnnounced').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleUnderlyingWithdrawalAnnounced(args));
        this.assetManagerEvent('UnderlyingWithdrawalConfirmed').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleUnderlyingWithdrawalConfirmed(args));
        this.assetManagerEvent('UnderlyingWithdrawalCancelled').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleUnderlyingWithdrawalCancelled(args));
        // track dust
        this.assetManagerEvent('DustConvertedToTicket').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleDustConvertedToTicket(args));
        this.assetManagerEvent('DustChanged').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleDustChanged(args));
        // liquidation
        this.assetManagerEvent('LiquidationPerformed').subscribe(args => this.getAgentTriggerAdd(args.agentVault)?.handleLiquidationPerformed(args));
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
        const agent = this.createAgent(address, agentInfo.ownerAddress, agentInfo.underlyingAddressString);
        agent.initialize(agentInfo);
    }

    createAgent(address: string, owner: string, underlyingAddressString: string) {
        const agent = this.newAgent(address, owner, underlyingAddressString);
        this.agents.set(address, agent);
        this.agentsByUnderlying.set(underlyingAddressString, agent);
        return agent;
    }

    protected newAgent(address: string, owner: string, underlyingAddressString: string) {
        return new TrackedAgentState(this, address, owner, underlyingAddressString);
    }

    destroyAgent(address: string) {
        const agent = this.getAgent(address);
        if (agent) {
            this.agents.delete(address);
            this.agentsByUnderlying.delete(agent.underlyingAddressString);
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
