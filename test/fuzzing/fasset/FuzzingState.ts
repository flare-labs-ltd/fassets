import { constants } from "@openzeppelin/test-helpers";
import { AssetManagerSettings } from "../../../lib/fasset/AssetManagerTypes";
import { UnderlyingChainEvents } from "../../../lib/underlying-chain/UnderlyingChainEvents";
import { EventFormatter } from "../../../lib/utils/EventFormatter";
import { EvmEvent, ExtractedEventArgs } from "../../../lib/utils/events/common";
import { EventExecutionQueue, TriggerableEvent } from "../../../lib/utils/events/ScopedEvents";
import { BNish, BN_ZERO, sumBN, toBN } from "../../../lib/utils/helpers";
import { ILogger, LogFile } from "../../../lib/utils/logging";
import { web3DeepNormalize, web3Normalize } from "../../../lib/utils/web3normalize";
import { AssetContext, AssetManagerEvents } from "../../integration/utils/AssetContext";
import { stringifyJson } from "../../utils/fuzzing-utils";
import { SparseArray } from "../../utils/SparseMatrix";
import { AgentStatus, FuzzingStateAgent } from "./FuzzingStateAgent";
import { FuzzingStateComparator } from "./FuzzingStateComparator";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { IEvmEvents } from "../../../lib/utils/events/IEvmEvents";

export class Prices {
    constructor(
        private readonly context: AssetContext,
        public readonly natUSDDec5: BN,
        public readonly natTimestamp: BN,
        public readonly assetUSDDec5: BN,
        public readonly assetTimestamp: BN,
    ) { }

    get amgNatWei() {
        return this.context.amgToNATWeiPrice(this.natUSDDec5, this.assetUSDDec5);
    }

    get natUSD() {
        return Number(this.natUSDDec5) * 1e-5;
    }

    get assetUSD() {
        return Number(this.assetUSDDec5) * 1e-5;
    }

    get assetNat() {
        return this.assetUSD / this.natUSD;
    }

    fresh(relativeTo: Prices, maxAge: BNish) {
        maxAge = toBN(maxAge);
        return this.natTimestamp.add(maxAge).gte(relativeTo.natTimestamp) && this.assetTimestamp.add(maxAge).gte(relativeTo.assetTimestamp);
    }

    toString() {
        return `(nat=${this.natUSD.toFixed(3)}$, asset=${this.assetUSD.toFixed(3)}$, asset/nat=${this.assetNat.toFixed(3)})`;
    }
}

export type FuzzingStateLogRecord = {
    text: string;
    event: EvmEvent;
};

export class FuzzingState {
    // state
    fAssetSupply = BN_ZERO;
    fAssetBalance = new SparseArray();

    // must call initialize to init prices
    prices!: Prices;
    trustedPrices!: Prices;

    // settings
    settings: AssetManagerSettings;

    // agent state
    agents: Map<string, FuzzingStateAgent> = new Map();                // map agent_address => agent state
    agentsByUnderlying: Map<string, FuzzingStateAgent> = new Map();    // map underlying_address => agent state

    // settings
    logFile?: LogFile;

    // logs
    failedExpectations: FuzzingStateLogRecord[] = [];

    // synthetic events
    pricesUpdated = new TriggerableEvent<void>(this.eventQueue);

    constructor(
        public context: AssetContext,
        public timeline: FuzzingTimeline,
        public truffleEvents: IEvmEvents,
        public chainEvents: UnderlyingChainEvents,
        public eventFormatter: EventFormatter,
        public eventQueue: EventExecutionQueue,
    ) {
        this.settings = { ...context.settings };
    }

    // async initialization part
    async initialize() {
        [this.prices, this.trustedPrices] = await this.getPrices();
        this.registerHandlers();
    }

    async getPrices(): Promise<[Prices, Prices]> {
        const { 0: natPrice, 1: natTimestamp } = await this.context.natFtso.getCurrentPrice();
        const { 0: assetPrice, 1: assetTimestamp } = await this.context.assetFtso.getCurrentPrice();
        const { 0: natPriceTrusted, 1: natTimestampTrusted } = await this.context.natFtso.getCurrentPriceFromTrustedProviders();
        const { 0: assetPriceTrusted, 1: assetTimestampTrusted } = await this.context.assetFtso.getCurrentPriceFromTrustedProviders();
        const ftsoPrices = new Prices(this.context, natPrice, natTimestamp, assetPrice, assetTimestamp);
        const trustedPrices = new Prices(this.context, natPriceTrusted, natTimestampTrusted, assetPriceTrusted, assetTimestampTrusted);
        const trustedPricesFresh = trustedPrices.fresh(ftsoPrices, this.settings.maxTrustedPriceAgeSeconds);
        return [ftsoPrices, trustedPricesFresh ? trustedPrices : ftsoPrices];
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
            this.logFile?.log(`SETTING CHANGED ${args.name} FROM ${(this.settings as any)[args.name]} TO ${args.value}`);
            (this.settings as any)[args.name] = web3Normalize(args.value);
        });
        this.assetManagerEvent('SettingArrayChanged').subscribe(args => {
            if (!(args.name in this.settings)) assert.fail(`Invalid setting array change ${args.name}`);
            this.logFile?.log(`SETTING ARRAY CHANGED ${args.name} FROM ${stringifyJson((this.settings as any)[args.name])} TO ${stringifyJson(args.value)}`);
            (this.settings as any)[args.name] = web3DeepNormalize(args.value);
        });
        // track fAsset balances (Transfer for mint/burn is seen as transfer from/to address(0))
        this.truffleEvents.event(this.context.fAsset, 'Transfer').immediate().subscribe(args => {
            if (args.from !== constants.ZERO_ADDRESS) {
                this.fAssetBalance.addTo(args.from, args.value.neg());
            }
            if (args.to !== constants.ZERO_ADDRESS) {
                this.fAssetBalance.addTo(args.to, args.value);
            }
        });
        // track price changes
        this.truffleEvents.event(this.context.ftsoManager, 'PriceEpochFinalized').subscribe(async args => {
            const [prices, trustedPrices] = await this.getPrices();
            this.logFile?.log(`PRICES CHANGED  ftso=${this.prices}->${prices}  trusted=${this.trustedPrices}->${trustedPrices}`);
            [this.prices, this.trustedPrices] = [prices, trustedPrices];
            // trigger event
            this.pricesUpdated.trigger();
        });
        // agents
        this.registerAgentHandlers();
    }

    private registerAgentHandlers() {
        // agent create / destroy
        this.assetManagerEvent('AgentCreated').subscribe(args => {
            const agent = new FuzzingStateAgent(this, args.agentVault, args.owner, args.underlyingAddress);
            this.agents.set(args.agentVault, agent);
            this.agentsByUnderlying.set(args.underlyingAddress, agent);
        });
        this.assetManagerEvent('AgentDestroyed').subscribe(args => {
            const agent = this.getAgent(args.agentVault);
            this.agents.delete(args.agentVault);
            this.agentsByUnderlying.delete(agent.underlyingAddressString);
        });
        // collateral deposit / whithdrawal
        this.truffleEvents.event(this.context.wnat, 'Transfer').immediate().subscribe(args => {
            this.agents.get(args.from)?.withdrawCollateral(toBN(args.value));
            this.agents.get(args.to)?.depositCollateral(toBN(args.value));
        });
        // status changes
        this.assetManagerEvent('AgentInCCB').subscribe(args => this.getAgent(args.agentVault).handleStatusChange(AgentStatus.CCB, args.timestamp));
        this.assetManagerEvent('LiquidationStarted').subscribe(args => this.getAgent(args.agentVault).handleStatusChange(AgentStatus.LIQUIDATION, args.timestamp));
        this.assetManagerEvent('FullLiquidationStarted').subscribe(args => this.getAgent(args.agentVault).handleStatusChange(AgentStatus.FULL_LIQUIDATION, args.timestamp));
        this.assetManagerEvent('LiquidationEnded').subscribe(args => this.getAgent(args.agentVault).handleStatusChange(AgentStatus.NORMAL));
        this.assetManagerEvent('AgentDestroyAnnounced').subscribe(args => this.getAgent(args.agentVault).handleStatusChange(AgentStatus.DESTROYING, args.timestamp));
        // enter/exit available agents list
        this.assetManagerEvent('AgentAvailable').subscribe(args => this.getAgent(args.agentVault).handleAgentAvailable(args));
        this.assetManagerEvent('AvailableAgentExited').subscribe(args => this.getAgent(args.agentVault).handleAvailableAgentExited(args));
        // minting
        this.assetManagerEvent('CollateralReserved').subscribe(args => this.getAgent(args.agentVault).handleCollateralReserved(args));
        this.assetManagerEvent('MintingExecuted').subscribe(args => this.getAgent(args.agentVault).handleMintingExecuted(args));
        this.assetManagerEvent('MintingPaymentDefault').subscribe(args => this.getAgent(args.agentVault).handleMintingPaymentDefault(args));
        this.assetManagerEvent('CollateralReservationDeleted').subscribe(args => this.getAgent(args.agentVault).handleCollateralReservationDeleted(args));
        // redemption and self-close
        this.assetManagerEvent('RedemptionRequested').subscribe(args => this.getAgent(args.agentVault).handleRedemptionRequested(args));
        this.assetManagerEvent('RedemptionPerformed').subscribe(args => this.getAgent(args.agentVault).handleRedemptionPerformed(args));
        this.assetManagerEvent('RedemptionDefault').subscribe(args => this.getAgent(args.agentVault).handleRedemptionDefault(args));
        this.assetManagerEvent('RedemptionPaymentBlocked').subscribe(args => this.getAgent(args.agentVault).handleRedemptionPaymentBlocked(args));
        this.assetManagerEvent('RedemptionPaymentFailed').subscribe(args => this.getAgent(args.agentVault).handleRedemptionPaymentFailed(args));
        this.assetManagerEvent('RedemptionFinished').subscribe(args => this.getAgent(args.agentVault).handleRedemptionFinished(args));
        this.assetManagerEvent('SelfClose').subscribe(args => this.getAgent(args.agentVault).handleSelfClose(args));
        // underlying withdrawal
        this.assetManagerEvent('UnderlyingWithdrawalAnnounced').subscribe(args => this.getAgent(args.agentVault).handleUnderlyingWithdrawalAnnounced(args));
        this.assetManagerEvent('UnderlyingWithdrawalConfirmed').subscribe(args => this.getAgent(args.agentVault).handleUnderlyingWithdrawalConfirmed(args));
        this.assetManagerEvent('UnderlyingWithdrawalCancelled').subscribe(args => this.getAgent(args.agentVault).handleUnderlyingWithdrawalCancelled(args));
        // track dust
        this.assetManagerEvent('DustConvertedToTicket').subscribe(args => this.getAgent(args.agentVault).handleDustConvertedToTicket(args));
        this.assetManagerEvent('DustChanged').subscribe(args => this.getAgent(args.agentVault).handleDustChanged(args));
        // liquidation
        this.assetManagerEvent('LiquidationPerformed').subscribe(args => this.getAgent(args.agentVault).handleLiquidationPerformed(args));
    }

    getAgent(address: string) {
        return this.agents.get(address) ?? assert.fail(`Invalid agent address ${address}`);
    }

    async checkInvariants(failOnProblems: boolean) {
        const checker = new FuzzingStateComparator();
        // total supply
        const fAssetSupply = await this.context.fAsset.totalSupply();
        checker.checkEquality('fAsset supply', fAssetSupply, this.fAssetSupply, true);
        // total minted value by all agents
        const totalMintedUBA = sumBN(this.agents.values(), agent => agent.calculateMintedUBA());
        checker.checkEquality('fAsset supply / total minted by agents', fAssetSupply, totalMintedUBA, true);
        // settings
        const actualSettings = await this.context.assetManager.getSettings();
        for (const [key, value] of Object.entries(actualSettings)) {
            if (/^\d+$/.test(key)) continue;   // all properties are both named and with index
            if (['assetManagerController', 'natFtsoIndex', 'assetFtsoIndex'].includes(key)) continue;   // special properties, not changed in normal way
            checker.checkEquality(`settings.${key}`, value, (this.settings as any)[key]);
        }
        // check agents' state
        for (const agent of this.agents.values()) {
            await agent.checkInvariants(checker);
        }
        // write logs (after all async calls, to keep them in one piece)
        checker.writeLog(this.logFile);
        // optionally fail on differences
        if (failOnProblems && checker.problems > 0) {
            assert.fail("Tracked and actual state different");
        }
    }

    assetManagerEvent<N extends AssetManagerEvents['name']>(event: N, filter?: Partial<ExtractedEventArgs<AssetManagerEvents, N>>) {
        return this.truffleEvents.event(this.context.assetManager, event, filter).immediate();
    }

    // getters

    lotSize() {
        return toBN(this.settings.lotSizeAMG).mul(toBN(this.settings.assetMintingGranularityUBA));
    }

    // logs

    expect(condition: boolean, message: string, event: EvmEvent) {
        if (!condition) {
            const text = `expectation failed: ${message}`;
            this.failedExpectations.push({ text, event });
        }
    }

    eventInfo(event: EvmEvent) {
        return `event=${event.event} at ${event.blockNumber}.${event.logIndex}`;
    }

    logExpectationFailures(logger: ILogger | undefined) {
        if (!logger) return;
        logger.log(`\nEXPECTATION FAILURES: ${this.failedExpectations.length}`);
        for (const log of this.failedExpectations) {
            logger.log(`        ${log.text}  ${this.eventInfo(log.event)}`);
        }
    }

    logAllAgentSummaries(logger: ILogger | undefined) {
        if (!logger) return;
        logger.log("\nAGENT SUMMARIES");
        for (const agent of this.agents.values()) {
            agent.writeAgentSummary(logger);
        }
    }

    logAllAgentActions(logger: ILogger | undefined) {
        if (!logger) return;
        logger.log("\nAGENT ACTIONS");
        for (const agent of this.agents.values()) {
            agent.writeActionLog(logger);
        }
    }
}
