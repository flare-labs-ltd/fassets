import BN from "bn.js";
import { constants } from "@openzeppelin/test-helpers";
import { AssetContext, AssetManagerEvents } from "../../integration/utils/AssetContext";
import { ExtractedEventArgs } from "../../utils/events";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { BNish, BN_ZERO, formatBN, toBN } from "../../utils/helpers";
import { LogFile } from "../../utils/LogFile";
import { SparseArray } from "../../utils/SparseMatrix";
import { web3DeepNormalize, web3Normalize } from "../../utils/web3assertions";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { TruffleEvents, UnderlyingChainEvents } from "./WrappedEvents";

interface AgentState {
    // status: number;     // TODO
    address: string;
    underlyingAddressString: string;
    publiclyAvailable: boolean;
    feeBIPS: BN;
    agentMinCollateralRatioBIPS: BN;
    totalCollateralNATWei: BN;
    collateralRatioBIPS: BN;
    mintedUBA: BN;
    reservedUBA: BN;
    redeemingUBA: BN;
    dustUBA: BN;
    ccbStartTimestamp: BN;
    liquidationStartTimestamp: BN;
    underlyingBalanceUBA: BN;   // info from underlying chain
    announcedUnderlyingWithdrawalId: BN;
}

export class FuzzingState {
    // state
    fAssetSupply = BN_ZERO;
    fAssetBalance = new SparseArray();
    
    // settings
    settings: AssetManagerSettings;
    
    // agent state
    agents: Set<string> = new Set();
    fullCollateral = new SparseArray();
    mintedUBA = new SparseArray();

    // settings
    logOnlyDifferences = false;      // otherwise log all checked values
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
            (this.settings as any)[args.name] = web3Normalize(args.value);
        });
        this.truffleEvents.event(this.context.assetManagerController, 'SettingArrayChanged').immediate().subscribe(args => {
            if (!(args.name in this.settings)) assert.fail(`Invalid setting array change ${args.name}`);
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
        if (this.logFile) {
            this.logFile.log(`CHECKING STATE DIFFERENCES`);
            for (const line of log) {
                this.logFile.log(line);
            }
            this.logFile.log(`    ${differences} DIFFERENCES`);
        }
        // optionally fail on differences
        if (failOnDifferences && differences > 0) {
            assert.fail("Tracked and actual state different");
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
            const actualValueS = JSON.stringify(web3DeepNormalize(actualValue));
            const trackedValueS = JSON.stringify(web3DeepNormalize(trackedValue));
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
