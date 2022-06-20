import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, renameSync, unlinkSync } from "fs";
import { dirname } from "path";

export interface ILogger {
    log(text: string): void;
}

export class NullLog implements ILogger {
    log(text: string): void {
    }
}

export class ConsoleLog implements ILogger {
    log(text: string): void {
        console.log(text);
    }
}

export class MemoryLog implements ILogger {
    public readonly logs: string[] = [];
    
    log(text: string): void {
        this.logs.push(text);
    }
    
    writeTo(logger: ILogger | undefined) {
        if (!logger) return;
        for (const line of this.logs) {
            logger.log(line);
        }
    }
}

export class LogFile implements ILogger {
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
