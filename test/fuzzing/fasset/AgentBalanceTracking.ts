import fs from "fs";
import { BN_ZERO } from "../../../lib/utils/helpers";

export class BalanceTrackingRow {
    constructor(data: Partial<BalanceTrackingRow>) {
        Object.assign(this, data);
    }

    block: number | null = null;
    operation: string = "?";
    requestId: any = null;
    underlyingDeposit: BN = BN_ZERO;
    underlyingWithdraw: BN = BN_ZERO;
    mintAmount: BN = BN_ZERO;
    mintFeeAgent: BN = BN_ZERO;
    mintFeePool: BN = BN_ZERO;
    redemptionAmount: BN = BN_ZERO;
    redemptionAmountSpent: BN = BN_ZERO;
    redemptionFee: BN = BN_ZERO;
    selfClose: BN = BN_ZERO;
    withdraw: BN = BN_ZERO;
    topup: BN = BN_ZERO;
    trackedAccountedUnderlying: BN = BN_ZERO;
    trackedRequiredUnderlying: BN = BN_ZERO;
}

export class BalanceTrackingSummary {
    constructor(data: Partial<BalanceTrackingSummary>) {
        Object.assign(this, data);
    }

    actualUnderlying: BN = BN_ZERO;
    accountedUnderlying: BN = BN_ZERO;
    requiredUnderlying: BN = BN_ZERO;
    freeUnderlying: BN = BN_ZERO;
}

export class BalanceTrackingList {
    list: BalanceTrackingRow[] = [];

    addRow(data: Partial<BalanceTrackingRow>) {
        this.list.push(new BalanceTrackingRow(data));
    }

    updateSummary(prev: BalanceTrackingSummary, row: BalanceTrackingRow) {
        const actualUnderlying = prev.actualUnderlying.add(row.underlyingDeposit);
        const accountedUnderlying = prev.accountedUnderlying.add(row.mintAmount).add(row.mintFeeAgent).add(row.mintFeePool)
            .sub(row.redemptionAmountSpent).sub(row.withdraw).add(row.topup);
        const requiredUnderlying = prev.requiredUnderlying.add(row.mintAmount).add(row.mintFeePool)
            .sub(row.redemptionAmount).sub(row.selfClose);
        const freeUnderlying = accountedUnderlying.sub(requiredUnderlying);
        return new BalanceTrackingSummary({ actualUnderlying, accountedUnderlying, requiredUnderlying, freeUnderlying });
    }

    formatCell(x: any) {
        return String(x ?? '');
    }

    writeLine(fd: number, line: any[]) {
        const str = line.map(x => this.formatCell(x)).join(';') + '\r\n';
        fs.writeSync(fd, str, null, 'utf-8');
    }

    writeCSV(fd: number) {
        let summary = new BalanceTrackingSummary({});
        this.writeLine(fd, ['Block', 'Operation', 'Request id', 'Underlying deposit', 'Underlying withdrawal', 'Mint amount', 'Mint fee agent', 'Mint fee pool',
            'Redemption amount', 'Redemption amount spent', 'Redemption fee', 'Self close', 'Withdraw', 'Topup', 'Tracked accounted underlying', 'Tracked required underlying',
            'Actual underlying', 'Accounted underlying', 'Required underlying', 'Free underlying']);
        for (const row of this.list) {
            summary = this.updateSummary(summary, row);
            this.writeLine(fd, Object.values(row).concat(Object.values(summary)));
        }
        this.writeLine(fd, []);
    }
}
