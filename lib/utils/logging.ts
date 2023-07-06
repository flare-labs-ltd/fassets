import { appendFileSync, closeSync } from "fs";
import { openNewFile } from "./file-utils";

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
        this.fd = openNewFile(path, 'as+', true);
    }

    log(text: string) {
        appendFileSync(this.fd, text + '\n');
    }

    close() {
        closeSync(this.fd);
    }
}
