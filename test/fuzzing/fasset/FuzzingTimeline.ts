import { time } from "@openzeppelin/test-helpers";
import { BaseEvent } from "../../utils/events";
import { MockChain } from "../../utils/fasset/MockChain";
import { randomShuffle } from "../../utils/fuzzing-utils";
import { latestBlockTimestamp, reportError } from "../../utils/helpers";

type TimelineEventType = 'FlareTime' | 'UnderlyingBlock' | 'UnderlyingTime';

interface TimelineEvent extends BaseEvent {
    address: 'TIMELINE',
    event: TimelineEventType,
    args: { 
        at: number
    }
}

interface TimedTrigger {
    subscriptionId: string;
    at: number;
    event: TimelineEvent;
    handler: (event: TimelineEvent) => void;
}

export class TriggerList {
    list: TimedTrigger[] = [];
    
    insertTrigger(trigger: TimedTrigger) {
        let i = this.list.length;
        while (i > 0 && trigger.at < this.list[i - 1].at) i--;
        this.list.splice(i, 0, trigger);
    }
    
    static lastSubscriptionId = 0;
    
    insertHandler(eventName: TimelineEventType, triggerTime: number, handler: (event: TimelineEvent) => void) {
        const subscriptionId = String(++TriggerList.lastSubscriptionId);
        this.insertTrigger({
            subscriptionId: subscriptionId,
            at: triggerTime,
            event: {
                address: 'TIMELINE',    // synthetic event
                event: eventName,
                args: { at: triggerTime }
            },
            handler: handler,
        });
        return subscriptionId;
    }
    
    removeHandler(subscriptionId: string) {
        const index = this.list.findIndex(trigger => trigger.subscriptionId === subscriptionId);
        if (index >= 0) {
            this.list.splice(index, 1);
        }
    }
    
    insertAndWait(eventName: TimelineEventType, triggerTime: number) {
        return new Promise<TimelineEvent>((resolve) => {
            this.insertHandler(eventName, triggerTime, resolve);
        });
    }
    
    popUntil(maxTimeInclusive: number) {
        let i = 0;
        while (i < this.list.length && this.list[i].at <= maxTimeInclusive) i++;
        return this.list.splice(0, i);
    }
    
    firstTime() {
        if (this.list.length === 0) return Number.MAX_VALUE;
        return this.list[0].at;
    }
}

export class FuzzingTimeline {
    flareTimeTriggers = new TriggerList();
    underlyingTimeTriggers = new TriggerList();
    underlyingBlockTriggers = new TriggerList();

    constructor(
        public chain: MockChain,
    ) { }

    // async mineNextUnderlyingBlock() {
    //     this.chain.mine();
    // }

    async addFlareTimeHandler(seconds: number, handler: (event: TimelineEvent) => void) {
        const triggerTime = await latestBlockTimestamp() + seconds;
        this.flareTimeTriggers.insertHandler('FlareTime', triggerTime, handler);
    }

    async addUnderlyingBlocksHandler(blocks: number, handler: (event: TimelineEvent) => void) {
        const triggerBlock = this.chain.blockHeight() + blocks;
        this.underlyingBlockTriggers.insertHandler('UnderlyingBlock', triggerBlock, handler);
    }

    async addUnderlyingTimeHandler(seconds: number, handler: (event: TimelineEvent) => void) {
        const triggerTime = this.chain.currentTimestamp() + seconds;
        this.underlyingTimeTriggers.insertHandler('UnderlyingTime', triggerTime, handler);
    }
    
    // Skip `seconds` of time unless a triggger is reached before.
    // While skipping, mines underlying blocks at the rate of chain.secondsPerBlock.
    async skipTime(seconds: number) {
        const currentFlareTime = await latestBlockTimestamp();
        const currentUnderlyingTime = this.chain.currentTimestamp();
        // calculate limits based on `seconds` and on first trigger
        const targetFlareTime = Math.min(currentFlareTime + seconds, this.flareTimeTriggers.firstTime());
        const targetUnderlyingTime = Math.min(currentUnderlyingTime + seconds, this.underlyingTimeTriggers.firstTime());
        const targetBlockHeight = this.underlyingBlockTriggers.firstTime();
        // mine blocks until one of the limits or triggers is reached
        let skippedTime = 0;
        while (true) {
            let nextSkippedTime = skippedTime + this.chain.nextBlockTimestamp() - this.chain.currentTimestamp();
            if (targetBlockHeight <= this.chain.blockHeight()) {
                break; // block height reached
            }
            if (targetFlareTime <= currentFlareTime + nextSkippedTime || targetUnderlyingTime <= currentUnderlyingTime + nextSkippedTime) {
                skippedTime = Math.min(targetUnderlyingTime - currentUnderlyingTime, targetFlareTime - currentFlareTime);
                break;  // flare or underlying time trigger reached
            }
            this.chain.mine();
            skippedTime = nextSkippedTime;
        }
        // increase timestamps
        if (skippedTime > 0) {
            await time.increase(skippedTime);
        }
        if (currentUnderlyingTime + skippedTime > this.chain.currentTimestamp()) {
            this.chain.skipTimeTo(currentUnderlyingTime + skippedTime);
        }
    }
    
    async executeTriggers() {
        const flareTimestamp = await latestBlockTimestamp();
        const triggers = [
            ...this.flareTimeTriggers.popUntil(flareTimestamp),
            ...this.underlyingTimeTriggers.popUntil(this.chain.currentTimestamp()),
            ...this.underlyingBlockTriggers.popUntil(this.chain.blockHeight()),
        ];
        randomShuffle(triggers);
        for (const trigger of triggers) {
            trigger.handler(trigger.event);
        }
        return triggers.length > 0; // so the caller can repeat until all triggers are exhausted
    }

    startThread(method: () => Promise<void>) {
        void method()
            .catch(e => reportError(e));
    }
}
