import BN from "bn.js";
import { constants } from "@openzeppelin/test-helpers";
import { AssetContext, AssetManagerEvents } from "../../integration/utils/AssetContext";
import { EventArgs, ExtractedEventArgs } from "../../utils/events";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { BNish, BN_ZERO, formatBN, toBN } from "../../utils/helpers";
import { LogFile } from "../../utils/LogFile";
import { SparseArray } from "../../utils/SparseMatrix";
import { web3DeepNormalize, web3Normalize } from "../../utils/web3assertions";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { TruffleEvents, UnderlyingChainEvents } from "./WrappedEvents";
import { stringifyJson } from "../../utils/fuzzing-utils";
import { CollateralReserved } from "../../../typechain-truffle/AssetManager";

// status as returned from getAgentInfo
enum AgentStatus {
    NORMAL = 0,             // agent is operating normally
    CCB = 1,                // agent in collateral call band
    LIQUIDATION = 2,        // liquidation due to collateral ratio - ends when agent is healthy
    FULL_LIQUIDATION = 3,   // illegal payment liquidation - always liquidates all and then agent must close vault
    DESTROYING = 4,         // agent announced destroy, cannot mint again; all existing mintings have been redeemed before
}

interface CollateralReservation {
    id: number;
    agentVault: string;
    minter: string;
    valueUBA: BN;
    feeUBA: BN;
    lastUnderlyingBlock: BN;
    lastUnderlyingTimestamp: BN;
    paymentAddress: string;
    paymentReference: string;
}

interface RedemptionTicket {
    id: number;
    agent: AgentState;
    amountUBA: BN;    
}

interface AgentState {
    status: AgentStatus,
    owner: string;
    address: string;
    underlyingAddressString: string;
    publiclyAvailable: boolean;
    feeBIPS: BN;
    agentMinCollateralRatioBIPS: BN;
    totalCollateralNATWei: BN;
    collateralRatioBIPS: BN;
    // mintedUBA: BN;
    // reservedUBA: BN;
    // redeemingUBA: BN;
    dustUBA: BN;
    ccbStartTimestamp: BN;           // 0 - not in ccb/liquidation
    liquidationStartTimestamp: BN;   // 0 - not in liquidation
    freeUnderlyingBalanceUBA: BN;    // based on events
    announcedUnderlyingWithdrawalId: BN;
    // collections
    collateralReservations: Map<number, CollateralReservation>;
    redemptionTickets: Map<number, RedemptionTicket>;
}

export class FuzzingState {
    // state
    fAssetSupply = BN_ZERO;
    fAssetBalance = new SparseArray();
    
    // settings
    settings: AssetManagerSettings;
    
    // agent state
    agents: Map<string, AgentState> = new Map();                // map agent_address => agent state
    agentsByUnderlying: Map<string, AgentState> = new Map();    // map underlying_address => agent state
    
    redemptionQueue: RedemptionTicket[] = [];

    // settings
    logFile?: LogFile;
    
    constructor(
        public context: AssetContext,
        public timeline: FuzzingTimeline,
        public truffleEvents: TruffleEvents,
        public chainEvents: UnderlyingChainEvents,
    ) {
        this.settings = { ...context.settings };
        this.registerHandlers();
    }
    
    registerHandlers() {
        // track total supply of fAsset
        this.assetManagerEvent('MintingExecuted').subscribe(args => {
            this.fAssetSupply = this.fAssetSupply.add(toBN(args.mintedAmountUBA));
        });
        this.assetManagerEvent('RedemptionRequested').subscribe(args => {
            this.fAssetSupply = this.fAssetSupply.sub(toBN(args.valueUBA));
        });
        this.assetManagerEvent('LiquidationPerformed').subscribe(args => {
            this.fAssetSupply = this.fAssetSupply.sub(toBN(args.valueUBA));
        });
        // track setting changes
        this.truffleEvents.event(this.context.assetManagerController, 'SettingChanged').immediate().subscribe(args => {
            if (!(args.name in this.settings)) assert.fail(`Invalid setting change ${args.name}`);
            this.logFile?.log(`SETTING CHANGED ${args.name} FROM ${(this.settings as any)[args.name]} TO ${args.value}`);
            (this.settings as any)[args.name] = web3Normalize(args.value);
        });
        this.truffleEvents.event(this.context.assetManagerController, 'SettingArrayChanged').immediate().subscribe(args => {
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
        // agents
        this.registerAgentHandlers();
    }
    
    private registerAgentHandlers() {
        // agent create / destroy
        this.assetManagerEvent('AgentCreated').subscribe(args => {
            const agent = this.newAgent(args.agentVault, args.owner, args.underlyingAddress);
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
            const agentFrom = this.agents.get(args.from);
            if (agentFrom) {
                agentFrom.totalCollateralNATWei = agentFrom.totalCollateralNATWei.sub(toBN(args.value));
            }
            const agentTo = this.agents.get(args.from);
            if (agentTo) {
                agentTo.totalCollateralNATWei = agentTo.totalCollateralNATWei.add(toBN(args.value));
            }
        });
        // enter/exit available agents list
        this.assetManagerEvent('AgentAvailable').subscribe(args => {
            const agent = this.getAgent(args.agentVault);
            agent.publiclyAvailable = true;
            agent.agentMinCollateralRatioBIPS = toBN(args.agentMinCollateralRatioBIPS);
            agent.feeBIPS = toBN(args.feeBIPS);
        });
        this.assetManagerEvent('AvailableAgentExited').subscribe(args => {
            const agent = this.getAgent(args.agentVault);
            agent.publiclyAvailable = false;
        });
        // minting
        this.assetManagerEvent('CollateralReserved').subscribe(args => {
            const agent = this.getAgent(args.agentVault);
            const cr = this.newCollateralReservation(args);
            agent.collateralReservations.set(cr.id, cr);
        });
        this.assetManagerEvent('MintingExecuted').subscribe(args => {
            const agent = this.getAgent(args.agentVault);
            this.deleteCollateralReservation(agent, Number(args.collateralReservationId));
            agent.freeUnderlyingBalanceUBA = agent.freeUnderlyingBalanceUBA.add(toBN(args.receivedFeeUBA));
            const ticket = this.newRedemptionTicket(agent, args.redemptionTicketId, toBN(args.mintedAmountUBA));
            this.redemptionQueue.push(ticket);
            agent.redemptionTickets.set(ticket.id, ticket);
        });
        this.assetManagerEvent('MintingPaymentDefault').subscribe(args => {
            const agent = this.getAgent(args.agentVault);
            this.deleteCollateralReservation(agent, Number(args.collateralReservationId));
        });
        this.assetManagerEvent('CollateralReservationDeleted').subscribe(args => {
            const agent = this.getAgent(args.agentVault);
            this.deleteCollateralReservation(agent, Number(args.collateralReservationId));
        });
        // redemption
    }

    getAgent(address: string) {
        return this.agents.get(address) ?? assert.fail(`Invalid agent address ${address}`);
    }
    
    newAgent(agentVault: string, owner: string, underlyingAddress: string): AgentState {
        return {
            status: AgentStatus.NORMAL,
            owner: owner,
            address: agentVault,
            underlyingAddressString: underlyingAddress,
            publiclyAvailable: false,
            feeBIPS: BN_ZERO,
            agentMinCollateralRatioBIPS: BN_ZERO,
            totalCollateralNATWei: BN_ZERO,
            collateralRatioBIPS: BN_ZERO,
            dustUBA: BN_ZERO,
            ccbStartTimestamp: BN_ZERO,
            liquidationStartTimestamp: BN_ZERO,
            freeUnderlyingBalanceUBA: BN_ZERO,
            announcedUnderlyingWithdrawalId: BN_ZERO,
            collateralReservations: new Map(),
            redemptionTickets: new Map(),
        };
    }

    newCollateralReservation(args: EventArgs<CollateralReserved>): CollateralReservation {
        return {
            id: Number(args.collateralReservationId),
            agentVault: args.agentVault,
            minter: args.minter,
            valueUBA: toBN(args.valueUBA),
            feeUBA: toBN(args.feeUBA),
            lastUnderlyingBlock: toBN(args.lastUnderlyingBlock),
            lastUnderlyingTimestamp: toBN(args.lastUnderlyingTimestamp),
            paymentAddress: args.paymentAddress,
            paymentReference: args.paymentReference,
        };
    }

    deleteCollateralReservation(agent: AgentState, crId: number) {
        const deleted = agent.collateralReservations.delete(crId);
        assert.isTrue(deleted, `Invalid collateral reservation id ${crId}`);
    }

    newRedemptionTicket(agent: AgentState, ticketId: BN, mintedAmountUBA: BN): RedemptionTicket {
        return {
            id: Number(ticketId),
            agent: agent,
            amountUBA: mintedAmountUBA
        };
    }

    async checkAll(failOnDifferences: boolean) {
        const log: string[] = [];
        let differences = 0;
        // total supply
        const fAssetSupply = await this.context.fAsset.totalSupply();
        differences += this.checkEquality(log, 'fAsset supply', fAssetSupply, this.fAssetSupply, true);
        // settings
        const actualSettings = await this.context.assetManager.getSettings();
        for (const [key, value] of Object.entries(actualSettings)) {
            if (/^\d+$/.test(key)) continue;   // all properties are both named and with index
            if (['assetManagerController', 'natFtsoIndex', 'assetFtsoIndex'].includes(key)) continue;   // special properties, not changed in normal way
            this.checkEquality(log, `settings.${key}`, value, (this.settings as any)[key]);
        }
        // write logs (after all async calls, to keep them in one piece)
        this.writeLog(log, differences);
        // optionally fail on differences
        if (failOnDifferences && differences > 0) {
            assert.fail("Tracked and actual state different");
        }
    }

    private writeLog(log: string[], differences: number) {
        if (this.logFile) {
            this.logFile.log(`CHECKING STATE DIFFERENCES`);
            for (const line of log) {
                this.logFile.log(line);
            }
            this.logFile.log(`    ${differences} DIFFERENCES`);
        }
    }

    isNumeric(value: unknown): value is BNish {
        return typeof value === 'number' || BN.isBN(value) || (typeof value === 'string' && /^\d+$/.test(value));
    }
    
    checkEquality(log: string[], description: string, actualValue: unknown, trackedValue: unknown, alwaysLog: boolean = false) {
        let different: boolean;
        if (this.isNumeric(actualValue) && this.isNumeric(trackedValue)) {
            const diff = toBN(actualValue).sub(toBN(trackedValue));
            different = !diff.eq(BN_ZERO);
            if (different || alwaysLog) {
                log.push(`    ${different ? 'different' : 'equal'}  ${description}  actual=${formatBN(actualValue)}  tracked=${formatBN(trackedValue)}  difference=${formatBN(diff)}`);
            }
        } else {
            const actualValueS = stringifyJson(actualValue);
            const trackedValueS = stringifyJson(trackedValue);
            different = actualValueS !== trackedValueS;
            if (different || alwaysLog) {
                log.push(`    ${different ? 'different' : 'equal'}  ${description}  actual=${actualValueS}  tracked=${trackedValueS}`);
            }
        }
        return different ? 1 : 0;
    }

    assetManagerEvent<N extends AssetManagerEvents['name']>(event: N, filter?: Partial<ExtractedEventArgs<AssetManagerEvents, N>>) {
        return this.truffleEvents.event(this.context.assetManager, event, filter).immediate();
    }
}
