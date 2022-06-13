import { latestBlockTimestamp, runAsync, systemTimestamp } from "../../utils/helpers";

export interface ITimer<TIMER_ID> {
    currentTime(): Promise<number>;
    after(seconds: number, handler: () => void): TIMER_ID;
    every(seconds: number, handler: () => void): TIMER_ID;
    cancel(timerId: TIMER_ID): void;
}

type NodeTimerId = [type: 'timeout' | 'interval', timeout: NodeJS.Timeout];

export class NodeTimer implements ITimer<NodeTimerId> {
    async currentTime() {
        return systemTimestamp();
    }
    
    after(seconds: number, handler: () => void): NodeTimerId {
        return ['timeout', setTimeout(handler, seconds * 1000)];
    }

    every(seconds: number, handler: () => void): NodeTimerId {
        return ['interval', setInterval(handler, seconds * 1000)];
    }

    cancel([type, timer]: NodeTimerId): void {
        switch (type) {
            case 'timeout': return clearTimeout(timer);
            case 'interval': return clearInterval(timer);
        }
    }
}

class TruffleTimerId {
    cancelled = false;
    timeout?: NodeJS.Timeout;
}

export class TruffleTimer implements ITimer<TruffleTimerId> {
    currentTime() {
        return latestBlockTimestamp();
    }
    
    after(seconds: number, handler: () => void): TruffleTimerId {
        const timerId = new TruffleTimerId();
        runAsync(async () => {
            const timestamp = await this.currentTime();
            await this.waitNextTick(timestamp + seconds, timerId);
            if (!timerId.cancelled) handler();
        });
        return timerId;
    }

    every(seconds: number, handler: () => void): TruffleTimerId {
        const timerId = new TruffleTimerId();
        runAsync(async () => {
            const timestamp = await this.currentTime();
            let stopTime = timestamp + seconds;
            while (!timerId.cancelled) {
                await this.waitNextTick(stopTime, timerId);
                if (!timerId.cancelled) handler();
                stopTime += seconds;
            }
        });
        return timerId;
    }

    cancel(timer: TruffleTimerId): void {
        timer.cancelled = true;
        if (timer.timeout != undefined) {
            clearInterval(timer.timeout);
            timer.timeout = undefined;
        }
    }
    
    private async waitNextTick(stopTime: number, timerId: TruffleTimerId) {
        while (!timerId.cancelled) {
            const timestamp = await this.currentTime();
            if (timestamp >= stopTime) break;
            const waitMs = Math.max((stopTime - timestamp) * 1000, 500);
            await this.delay(waitMs, timerId);
        }
    }
    
    private delay(ms: number, timerId: TruffleTimerId): Promise<void> {
        if (timerId.cancelled) return Promise.resolve();
        return new Promise((resolve) => { 
            timerId.timeout = setTimeout(resolve, ms); 
        });
    }
}
