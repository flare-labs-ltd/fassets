import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, renameSync, unlinkSync } from "fs";
import { dirname } from "path";

export class LogFile {
    public readonly fd;

    constructor(
        public readonly path: string
    ) {
        this.fd = LogFile.openNewFile(path);
    }

    static openNewFile(path: string) {
        const dir = dirname(path);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        if (existsSync(path)) {
            const backup = path + '.1';
            if (existsSync(backup))
                unlinkSync(backup);
            renameSync(path, backup);
        }
        return openSync(path, 'as+');
    }

    log(text: string) {
        appendFileSync(this.fd, text + '\n');
    }

    close() {
        closeSync(this.fd);
    }
}
