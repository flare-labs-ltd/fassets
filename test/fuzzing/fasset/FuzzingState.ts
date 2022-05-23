import { constants } from "@openzeppelin/test-helpers";
import { AssetContext, AssetManagerEvents } from "../../integration/utils/AssetContext";
import { ExtractedEventArgs } from "../../utils/events";
import { BNish, BN_ZERO, formatBN, toBN } from "../../utils/helpers";
import { LogFile } from "../../utils/LogFile";
import { SparseArray } from "../../utils/SparseMatrix";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { TruffleEvents, UnderlyingChainEvents } from "./WrappedEvents";

export class FuzzingState {
    // state
    fAssetSupply = BN_ZERO;
    fAssetBalance = new SparseArray();

    // settings
    logOnlyDifferences = false;      // otherwise log all checked values
    logFile?: LogFile;
    
    constructor(
        public context: AssetContext,
        public timeline: FuzzingTimeline,
        public truffleEvents: TruffleEvents,
        public chainEvents: UnderlyingChainEvents,
    ) {
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
        // track fAsset balances (Transfer for mint/burn is seen as transfer from/to address(0))
        this.truffleEvents.event(this.context.fAsset, 'Transfer').subscribe(args => {
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
        differences += this.checkDifference(log, 'fAsset supply', fAssetSupply, 'tracked supply', this.fAssetSupply);
        // final
        if (this.logFile) {
            this.logFile.log(`CHECKING STATE DIFFERENCES`);
            for (const line of log) {
                this.logFile.log(line);
            }
            this.logFile.log(`    ${differences} DIFFERENCES`);
        }
        if (failOnDifferences && differences > 0) {
            assert.fail("Tracked and actual state different");
        }
    }
    
    checkDifference(log: string[], key1: string, value1: BNish, key2: string, value2: BNish) {
        const diff = toBN(value1).sub(toBN(value2));
        const different = !diff.eq(BN_ZERO);
        if (different || !this.logOnlyDifferences) {
            log.push(`    ${different ? 'different' : 'equal'}  ${key1}=${formatBN(value1)}  ${key2}=${formatBN(value2)}  difference=${formatBN(diff)}`);
        }
        return different ? 1 : 0;
    }

    assetManagerEvent<N extends AssetManagerEvents['name']>(event: N, filter?: Partial<ExtractedEventArgs<AssetManagerEvents, N>>) {
        return this.truffleEvents.event(this.context.assetManager, event, filter);
    }
}
