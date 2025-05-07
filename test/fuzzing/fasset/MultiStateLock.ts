import { Future } from "../../../lib/utils/helpers";

interface QueueItem {
    state: string;
    future: Future<void>;
}

export class MultiStateLock {
    currentState: string | null = null;
    currentStateCount: number = 0;
    queue: QueueItem[] = [];

    acquire(state: string): Promise<void> {
        const future = new Future<void>();
        this.queue.push({ state, future });
        setTimeout(() => this.processQueue(), 0);
        return future.promise;
    }

    release(state: string) {
        assert(this.currentState === state && this.currentStateCount > 0, "invalid lock state");
        this.currentStateCount -= 1;
        if (this.currentStateCount === 0) {
            this.currentState = null;
        }
        // console.log(`Released lock, state='${this.currentState}' running=${this.currentStateCount} waiting=${this.queue.length}`);
        setTimeout(() => this.processQueue(), 0);
    }

    async runLocked<T>(state: string, func: () => Promise<T>): Promise<T> {
        await this.acquire(state);
        try {
            return await func();
        } finally {
            this.release(state);
        }
    }

    private processQueue() {
        while (this.queue.length > 0) {
            const first = this.queue[0];
            if (this.currentState != null && this.currentState !== first.state) {
                break;  // locked on some other state
            }
            // switch or increase lock
            this.currentState = first.state;
            this.currentStateCount += 1;
            this.queue.shift();
            // console.log(`Acquired lock, state='${this.currentState}' running=${this.currentStateCount} waiting=${this.queue.length}`);
            first.future.resolve();
        }
    }
}
