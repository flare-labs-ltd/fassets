import { OpenMode, existsSync, mkdirSync, openSync, renameSync, unlinkSync } from "fs";
import { join, parse } from "path";

/**
 * Create and open new file and all intermediate directories.
 * Optionally backup the existing file with the same path.
 * @returns the file descriptor
 */
export function openNewFile(path: string, openMode: OpenMode, backup: boolean) {
    const { dir, name, ext } = parse(path);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    if (existsSync(path)) {
        if (backup) {
            const backupPath = join(dir, name) + '.1' + ext;
            if (existsSync(backupPath)) {
                unlinkSync(backupPath);
            }
            renameSync(path, backupPath);
        } else {
            unlinkSync(path);
        }
    }
    return openSync(path, openMode);
}
