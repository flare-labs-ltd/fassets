import BN from "bn.js";
import { BN_ZERO, BNish, formatBN, toBN } from "../../../lib/utils/helpers";
import { ILogger, MemoryLog } from "../../../lib/utils/logging";
import { web3DeepNormalize } from "../../../lib/utils/web3normalize";

type CheckNumericOptions = {
    alwaysLog?: boolean;    // default false
    maxDiff?: BNish;        // default exact match
    severe?: boolean;       // default true
};
const NO_OPTIONS: CheckNumericOptions = {};

export class FuzzingStateComparator {
    logger = new MemoryLog();
    problems: number = 0;

    isNumeric(value: unknown): value is BNish {
        return typeof value === 'number' || BN.isBN(value) || (typeof value === 'string' && /^\d+$/.test(value));
    }

    checkEquality(description: string, actualValue: unknown, trackedValue: unknown, options: CheckNumericOptions = NO_OPTIONS) {
        if (this.isNumeric(actualValue) && this.isNumeric(trackedValue)) {
            return this.checkNumericDifference(description, actualValue, 'eq', trackedValue, options);
        } else {
            return this.checkStringEquality(description, actualValue, trackedValue, options);
        }
    }

    checkStringEquality(description: string, actualValue: unknown, trackedValue: unknown, options: CheckNumericOptions = NO_OPTIONS) {
        const actualValueS = JSON.stringify(web3DeepNormalize(actualValue));
        const trackedValueS = JSON.stringify(web3DeepNormalize(trackedValue));
        const different = actualValueS !== trackedValueS;
        if (different || options.alwaysLog) {
            const actualCmp = different ? '!=' : '==';
            this.logger.log(`    ${different ? 'different' : 'equal'}  ${description}:  actual=${actualValueS} ${actualCmp} tracked=${trackedValueS}`);
        }
        this.problems += different && (options.severe ?? true) ? 1 : 0;
        return different ? 1 : 0;
    }

    checkNumericDifference(description: string, actualValue: BNish, comparison: 'eq' | 'lte' | 'gte', trackedValue: BNish, options: CheckNumericOptions = NO_OPTIONS) {
        const diff = toBN(actualValue).sub(toBN(trackedValue));
        const diffOk = diff[comparison](BN_ZERO);
        const approxEqual = options.maxDiff != null && diff.abs().lte(toBN(options.maxDiff));
        const problem = !(diffOk || approxEqual);
        if (problem || options.alwaysLog) {
            const actualCmp = diff.eq(BN_ZERO) ? "==" : (diff.lt(BN_ZERO) ? "<" : ">");
            const okMsg = comparison === 'eq' ? 'equal' : (comparison === 'lte' ? 'ok (<=)' : 'ok (>=)');
            const approxOkMsg = (comparison === 'eq' ? 'approx equal' : (comparison === 'lte' ? 'approx ok (~<=)' : 'approx ok (~>=)'));
            const approxSuffix = options.maxDiff != null ? `  [maxDiff=${formatBN(options.maxDiff)}]` : '';
            const problemMsg = comparison === 'eq' ? 'different' : (comparison === 'lte' ? 'problem (too large)' : 'problem (too small)');
            const msg = problem ? problemMsg : (diffOk ? okMsg : approxOkMsg);
            this.logger.log(`    ${msg}  ${description}:  actual=${formatBN(actualValue)} ${actualCmp} tracked=${formatBN(trackedValue)},  difference=${formatBN(diff)}${approxSuffix}`);
        }
        this.problems += problem && (options.severe ?? true) ? 1 : 0;
        return problem ? 1 : 0;
    }

    writeLog(logger: ILogger | undefined) {
        if (!logger) return;
        logger.log(`CHECKING STATE DIFFERENCES`);
        this.logger.writeTo(logger);
        logger.log(`    ${this.problems} PROBLEMS`);
    }
}
