import BN from "bn.js";
import { BN_ZERO, BNish, formatBN, toBN } from "../../../lib/utils/helpers";
import { ILogger, MemoryLog } from "../../../lib/utils/logging";
import { web3DeepNormalize } from "../../../lib/utils/web3normalize";

export class FuzzingStateComparator {
    logger = new MemoryLog();
    problems: number = 0;

    isNumeric(value: unknown): value is BNish {
        return typeof value === 'number' || BN.isBN(value) || (typeof value === 'string' && /^\d+$/.test(value));
    }

    checkEquality(description: string, actualValue: unknown, trackedValue: unknown, alwaysLog: boolean = false) {
        if (this.isNumeric(actualValue) && this.isNumeric(trackedValue)) {
            return this.checkNumericDifference(description, actualValue, 'eq', trackedValue, alwaysLog);
        } else {
            return this.checkStringEquality(description, actualValue, trackedValue, alwaysLog);
        }
    }

    checkApproxEquality(description: string, actualValue: BNish, trackedValue: BNish, maxDiff: BNish, alwaysLog: boolean = false) {
        const difference = toBN(trackedValue).sub(toBN(actualValue)).abs();
        const problem = difference.gt(toBN(maxDiff));
        if (problem) {
            this.logger.log(`    different  ${description}:  actual=${formatBN(actualValue)} != tracked=${formatBN(trackedValue)},  difference=${formatBN(difference)} > ${formatBN(maxDiff)}`);
        } else if (alwaysLog) {
            this.logger.log(`    equal  ${description}:  actual=${formatBN(actualValue)} == tracked=${formatBN(trackedValue)},  difference=${formatBN(difference)} <= ${formatBN(maxDiff)}`);
        }
        this.problems += problem ? 1 : 0;
        return problem ? 1 : 0;
    }

    checkStringEquality(description: string, actualValue: unknown, trackedValue: unknown, alwaysLog: boolean = false) {
        const actualValueS = JSON.stringify(web3DeepNormalize(actualValue));
        const trackedValueS = JSON.stringify(web3DeepNormalize(trackedValue));
        const different = actualValueS !== trackedValueS;
        if (different || alwaysLog) {
            const actualCmp = different ? '!=' : '==';
            this.logger.log(`    ${different ? 'different' : 'equal'}  ${description}:  actual=${actualValueS} ${actualCmp} tracked=${trackedValueS}`);
        }
        this.problems += different ? 1 : 0;
        return different ? 1 : 0;
    }

    checkNumericDifference(description: string, actualValue: BNish, comparison: 'eq' | 'lte' | 'gte', trackedValue: BNish, alwaysLog: boolean = false) {
        const diff = toBN(actualValue).sub(toBN(trackedValue));
        const problem = !diff[comparison](BN_ZERO);
        if (problem || alwaysLog) {
            const actualCmp = diff.eq(BN_ZERO) ? "==" : (diff.lt(BN_ZERO) ? "<" : ">");
            const okMsg = comparison === 'eq' ? 'equal' : (comparison === 'lte' ? 'ok (<=)' : 'ok (>=)');
            const problemMsg = comparison === 'eq' ? 'different' : (comparison === 'lte' ? 'problem (too large)' : 'problem (too small)');
            this.logger.log(`    ${problem ? problemMsg : okMsg}  ${description}:  actual=${formatBN(actualValue)} ${actualCmp} tracked=${formatBN(trackedValue)},  difference=${formatBN(diff)}`);
        }
        this.problems += problem ? 1 : 0;
        return problem ? 1 : 0;
    }

    writeLog(logger: ILogger | undefined) {
        if (!logger) return;
        logger.log(`CHECKING STATE DIFFERENCES`);
        this.logger.writeTo(logger);
        logger.log(`    ${this.problems} PROBLEMS`);
    }
}
