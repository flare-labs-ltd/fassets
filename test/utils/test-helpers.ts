import { loadFixture, mine, time } from "@nomicfoundation/hardhat-network-helpers";
import { deepCopy } from "../../lib/utils/deepCopy";

/**
 * Returns truncated file path.
 * @param file module filename
 * @returns file path from `test/` on, separated by `'/'`
 */
export function getTestFile(myFile: string) {
    return myFile.slice(myFile.replace(/\\/g, '/').indexOf("test/"));
}

/**
 * Like Hardhat's `loadFixture`, but copies the returned variables.
 * @param fixture the the initialization function.
 *  Must not be an anonimous function, otherwise it will be called every time instead of creating a snapshot.
 * @returns The (copy of) variables returned by `fixture`.
 */
export function loadFixtureCopyVars<T>(fixture: () => Promise<T>): Promise<T> {
    return loadFixture(fixture).then(deepCopy);
}

/**
 * Conditionally execute tests.
 * @param condition if true, the test will run
 */
export function itSkipIf(condition: boolean) {
    return condition ? it.skip : it;
}

export async  function deterministicTimeIncrease(increase: string | number | BN) {
    const latest = await time.latest();
    const skip = Math.max(Number(increase), 1);
    await time.setNextBlockTimestamp(latest + skip);
    await mine(1);  // at least 1 block is expected to be mined
    await time.setNextBlockTimestamp(latest + skip + 1);
}
