import { constants } from "@openzeppelin/test-helpers";
import { AssetContext, AssetManagerEvents } from "../../integration/utils/AssetContext";
import { EventFormatter } from "../../utils/EventDecoder";
import { ExtractedEventArgs } from "../../utils/events";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { stringifyJson } from "../../utils/fuzzing-utils";
import { BN_ZERO, formatBN, sumBN, toBN } from "../../utils/helpers";
import { LogFile } from "../../utils/LogFile";
import { SparseArray } from "../../utils/SparseMatrix";
import { web3DeepNormalize, web3Normalize } from "../../utils/web3assertions";
import { FuzzingStateAgent } from "./FuzzingStateAgent";
import { FuzzingStateComparator } from "./FuzzingStateComparator";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { EvmEvents, UnderlyingChainEvents } from "./WrappedEvents";

export class Prices {
    constructor(
        public natUSD: number, 
        public assetUSD: number,
    ) {}
    
    get assetNat() {
        return this.assetUSD / this.natUSD;
    } 
    
    toString() {
        return `(nat=${this.natUSD.toFixed(3)}$, asset=${this.assetUSD.toFixed(3)}$, asset/nat=${this.assetNat.toFixed(3)})`;
    }
}

export class FuzzingState {
    // state
    fAssetSupply = BN_ZERO;
    fAssetBalance = new SparseArray();
    
    prices: Prices = { natUSD: 0, assetUSD: 0, assetNat: 0 };
    trustedPrices: Prices = { natUSD: 0, assetUSD: 0, assetNat: 0 };
    
    amgPriceNatWei = BN_ZERO;
    amgPriceNatWeiFromTrusted = BN_ZERO;

    // settings
    settings: AssetManagerSettings;
    
    // agent state
    agents: Map<string, FuzzingStateAgent> = new Map();                // map agent_address => agent state
    agentsByUnderlying: Map<string, FuzzingStateAgent> = new Map();    // map underlying_address => agent state
    
    // settings
    logFile?: LogFile;
    
    constructor(
        public context: AssetContext,
        public timeline: FuzzingTimeline,
        public truffleEvents: EvmEvents,
        public chainEvents: UnderlyingChainEvents,
        public eventFormatter: EventFormatter,
    ) {
        this.settings = { ...context.settings };
        this.registerHandlers();
    }
    
    // async initialization part
    async initialize() {
        [this.amgPriceNatWei, this.amgPriceNatWeiFromTrusted] = await this.context.currentAmgToNATWeiPriceWithTrusted();
        [this.prices, this.trustedPrices] = await this.getPrices();
    }
    
    async getPrices(): Promise<[Prices, Prices]> {
        const convertPriceAndTimestamp = ({ 0: price, 1: timestamp }: { 0: BN, 1: BN }) => [Number(price) * 1e-5, Number(timestamp)] as const;
        const [natPrice, natTimestamp] = convertPriceAndTimestamp(await this.context.natFtso.getCurrentPrice());
        const [assetPrice, assetTimestamp] = convertPriceAndTimestamp(await this.context.assetFtso.getCurrentPrice());
        const [natPriceTrusted, natTimestampTrusted] = convertPriceAndTimestamp(await this.context.natFtso.getCurrentPriceFromTrustedProviders());
        const [assetPriceTrusted, assetTimestampTrusted] = convertPriceAndTimestamp(await this.context.assetFtso.getCurrentPriceFromTrustedProviders());
        const ftsoPrices = new Prices(natPrice, assetPrice);
        const trustedPrices = new Prices(natPriceTrusted, assetPriceTrusted);
        const maxAge = Number(this.settings.maxTrustedPriceAgeSeconds);
        const trustedPricesFresh = natTimestampTrusted + maxAge >= natTimestamp && assetTimestampTrusted + maxAge >= assetTimestamp;
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
            const [amgPriceNatWei, amgPriceNatWeiFromTrusted] = await this.context.currentAmgToNATWeiPriceWithTrusted();
            const [prices, trustedPrices] = await this.getPrices();
            this.logFile?.log(`PRICES CHANGED  ftso=${formatBN(this.amgPriceNatWei)}->${formatBN(amgPriceNatWei)}  trusted=${formatBN(this.amgPriceNatWeiFromTrusted)}->${formatBN(amgPriceNatWeiFromTrusted)}`);
            [this.amgPriceNatWei, this.amgPriceNatWeiFromTrusted] = [amgPriceNatWei, amgPriceNatWeiFromTrusted];
            this.logFile?.log(`PRICES CHANGED  ftso=${this.prices}->${prices}  trusted=${this.trustedPrices}->${trustedPrices}`);
            [this.prices, this.trustedPrices] = [prices, trustedPrices];
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
        // track dust
        this.assetManagerEvent('DustConvertedToTicket').subscribe(args => this.getAgent(args.agentVault).handleDustConvertedToTicket(args));
        this.assetManagerEvent('DustChanged').subscribe(args => this.getAgent(args.agentVault).handleDustChanged(args));
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
}
