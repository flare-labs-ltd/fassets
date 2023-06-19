import { network } from "hardhat";
import { deepCopy } from "./deepCopy";

export class HardhatSnapshot<T = any> {
    constructor(
        public snapshotId: string,
        public variables: T,
    ) { }

    static async create<T>(variables: T): Promise<HardhatSnapshot<T>> {
        const snapshotId = await network.provider.send('evm_snapshot');
        const variablesCopy = deepCopy(variables);
        return new HardhatSnapshot(snapshotId, variablesCopy);
    }

    async revert(saveAgain: boolean = true): Promise<T> {
        const success: boolean = await network.provider.send('evm_revert', [this.snapshotId]);
        if (!success) throw new Error(`Cannot revert to ${this.snapshotId}`);
        if (saveAgain) {
            this.snapshotId = await network.provider.send('evm_snapshot');
        }
        return deepCopy(this.variables);
    }
}

const snapshots: Map<Function, HardhatSnapshot> = new Map();

// Like Hardhat's `loadFixture`, but creates copies of variables.
export async function initWithSnapshot<T>(fixture: () => Promise<T>): Promise<T> {
    let snapshot = snapshots.get(fixture);
    if (snapshot != null) {
        return snapshot.revert(true);
    } else {
        const variables = await fixture();
        const newSnapshot = await HardhatSnapshot.create(variables);
        snapshots.set(fixture, newSnapshot);
        return variables;
    }
}
