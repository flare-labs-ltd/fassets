import { time } from "@openzeppelin/test-helpers";
import { ClearableSubscription, EventEmitter, EventExecutionQueue, EventHandler, EventSubscription } from "../../../lib/utils/events/ScopedEvents";
import { latestBlockTimestamp, runAsync } from "../../../lib/utils/helpers";
import { ILogger } from "../../../lib/utils/logging";
import { MockChain } from "../../utils/fasset/MockChain";
import { randomShuffle } from "../../utils/fuzzing-utils";
import { ITimer } from "./Timer";

type TimelineEventType = 'FlareTime' | 'UnderlyingBlock' | 'UnderlyingTime';

interface TimelineEvent {
    type: TimelineEventType,
    at: number
}

interface TimedTrigger {
    id: number;
    type: TimelineEventType;
    at: number;
    handler: EventHandler<TimelineEvent>;
}

export class TriggerList {
    constructor(
        public eventType: TimelineEventType,
        public eventQueue: EventExecutionQueue | null,
    ) { }

    triggers: TimedTrigger[] = [];

    static lastSubscriptionId = 0;

    event(triggerAt: number) {
        return new EventEmitter<TimelineEvent>(this.eventQueue, handler => {
            const id = ++TriggerList.lastSubscriptionId;
            this.insertTrigger({ id: id, type: this.eventType, at: triggerAt, handler: handler });
            return ClearableSubscription.of(() => this.removeTrigger(id));
        });
    }

    insertTrigger(trigger: TimedTrigger) {
        let i = this.triggers.length;
        while (i > 0 && trigger.at < this.triggers[i - 1].at) i--;
        this.triggers.splice(i, 0, trigger);
    }

    removeTrigger(id: number) {
        const index = this.triggers.findIndex(trigger => trigger.id === id);
        if (index >= 0) {
            this.triggers.splice(index, 1);
        }
    }

    popUntil(maxTimeInclusive: number) {
        let i = 0;
        while (i < this.triggers.length && this.triggers[i].at <= maxTimeInclusive) i++;
        return this.triggers.splice(0, i);
    }

    firstTime() {
        if (this.triggers.length === 0) return Number.MAX_VALUE;
        return this.triggers[0].at;
    }
}

class FuzzingTimelineTimerId {
    subscription?: EventSubscription;
}

export class FuzzingTimelineTimer implements ITimer<FuzzingTimelineTimerId> {
    constructor(
        private timeline: TriggerList,
        private getCurrentTime: () => Promise<number>,
    ) { }

    currentTime(): Promise<number> {
        return this.getCurrentTime();
    }

    after(seconds: number, handler: () => void): FuzzingTimelineTimerId {
        const timerId = new FuzzingTimelineTimerId();
        runAsync(async () => {
            const timestamp = await this.getCurrentTime();
            timerId.subscription = this.timeline.event(timestamp + seconds).subscribe(handler);
        });
        return timerId;
    }

    every(seconds: number, handler: () => void): FuzzingTimelineTimerId {
        const timerId = new FuzzingTimelineTimerId();
        runAsync(async () => {
            const timestamp = await this.getCurrentTime();
            let stopTime = timestamp + seconds;
            const wrappedHandler = () => {
                stopTime += seconds;
                timerId.subscription = this.timeline.event(stopTime).subscribe(wrappedHandler);
                handler();
            };
            timerId.subscription = this.timeline.event(stopTime).subscribe(wrappedHandler);
        });
        return timerId;
    }

    cancel(timerId: FuzzingTimelineTimerId): void {
        timerId.subscription?.unsubscribe();
    }
}

export class FuzzingTimeline {
    constructor(
        public chain: MockChain,
        public eventQueue: EventExecutionQueue,
    ) { }

    flareTimeTriggers = new TriggerList('FlareTime', this.eventQueue);
    underlyingTimeTriggers = new TriggerList('UnderlyingTime', this.eventQueue);
    underlyingBlockTriggers = new TriggerList('UnderlyingBlock', this.eventQueue);
    logger?: ILogger;

    async mineNextUnderlyingBlock() {
        const skip = this.chain.nextBlockTimestamp() - this.chain.currentTimestamp();
        this.chain.mine();
        if (skip > 0) {
            await time.increase(skip);
        }
    }

    flareTimestamp(timestamp: number | BN) {
        return this.flareTimeTriggers.event(Number(timestamp));
    }

    underlyingBlockNumber(blockNumber: number | BN) {
        return this.underlyingBlockTriggers.event(Number(blockNumber));
    }

    underlyingTimestamp(timestamp: number | BN) {
        return this.underlyingTimeTriggers.event(Number(timestamp));
    }

    async flareSeconds(seconds: number | BN) {
        const triggerTime = await latestBlockTimestamp() + Number(seconds);
        return this.flareTimeTriggers.event(triggerTime);
    }

    underlyingBlocks(blocks: number | BN) {
        const triggerBlock = this.chain.blockHeight() + Number(blocks);
        return this.underlyingBlockTriggers.event(triggerBlock);
    }

    underlyingSeconds(seconds: number | BN) {
        const triggerTime = this.chain.currentTimestamp() + Number(seconds);
        return this.underlyingTimeTriggers.event(triggerTime);
    }

    flareTimer() {
        return new FuzzingTimelineTimer(this.flareTimeTriggers, latestBlockTimestamp);
    }

    // Skip `seconds` of time unless a triggger is reached before.
    // While skipping, mines underlying blocks at the rate of chain.secondsPerBlock.
    async skipTime(seconds: number) {
        const startFlareTime = await latestBlockTimestamp();
        const startUnderlyingTime = this.chain.currentTimestamp();
        // calculate first trigger times
        const firstFlareTimeTrigger = this.flareTimeTriggers.firstTime();
        const firstUnderlyingTimeTrigger = this.underlyingTimeTriggers.firstTime();
        const firstUnderlyingBlockTrigger = this.underlyingBlockTriggers.firstTime();
        // mine blocks until one of the limits or triggers is reached
        let skippedTime = 0;
        while (true) {
            const triggerReached = firstUnderlyingBlockTrigger <= this.chain.blockHeight()
                || firstUnderlyingTimeTrigger <= this.chain.lastBlockTimestamp()
                || firstFlareTimeTrigger <= Math.min(startFlareTime + skippedTime, this.chain.lastBlockTimestamp());
            if (triggerReached) {
                break;
            }
            // mine next block unless skip of `seconds` is reached
            let nextBlockSkip = skippedTime + this.chain.nextBlockTimestamp() - this.chain.currentTimestamp();
            if (nextBlockSkip <= seconds) {
                this.chain.mine();
                skippedTime = this.chain.lastBlockTimestamp() - startUnderlyingTime;
            } else {
                skippedTime = seconds;
                break;
            }
        }
        // increase timestamps
        const newFlareTime = Math.min(startFlareTime + skippedTime, this.chain.lastBlockTimestamp());
        if (newFlareTime > startFlareTime) {
            await time.increaseTo(newFlareTime).catch(e => {
                this.logger?.log(`???? ERROR Invalid time increase ${startFlareTime}->${newFlareTime}, (${e})`);
            });
        }
        if (startUnderlyingTime + skippedTime > this.chain.currentTimestamp()) {
            this.chain.skipTimeTo(startUnderlyingTime + skippedTime);
        }
        this.logger?.log(`***** SKIPPED TIME  flare=${newFlareTime - startFlareTime}  chain=${this.chain.currentTimestamp() - startUnderlyingTime}`);
    }

    async executeTriggers() {
        const flareTimestamp = await latestBlockTimestamp();
        const triggers = [
            ...this.flareTimeTriggers.popUntil(flareTimestamp),
            ...this.underlyingTimeTriggers.popUntil(this.chain.lastBlockTimestamp()),
            ...this.underlyingBlockTriggers.popUntil(this.chain.blockHeight()),
        ];
        randomShuffle(triggers);
        for (const trigger of triggers) {
            this.logger?.log(`TRIGGERED ${trigger.type}(${trigger.id} at=${trigger.at})`);
            trigger.handler({ type: trigger.type, at: trigger.at });
        }
        return triggers.length > 0; // so the caller can repeat until all triggers are exhausted
    }
}
