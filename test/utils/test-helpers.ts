import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
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
 * Like Hrdhat's `loadFixture`, but copies the returned variables.
 * @param fixture the the initialization function.
 *  Must not be an anonimous function, otherwise it will be called every time instead of creating a snapshot.
 * @returns The (copy of) variables returned by `fixture`.
 */
export function loadFixtureCopyVars<T>(fixture: () => Promise<T>): Promise<T> {
    return loadFixture(fixture).then(deepCopy);
}
