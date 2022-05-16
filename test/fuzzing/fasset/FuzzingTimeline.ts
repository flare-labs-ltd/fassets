import { time } from "@openzeppelin/test-helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { randomShuffle } from "../../utils/fuzzing-utils";
import { latestBlockTimestamp } from "../../utils/helpers";
import { ClearableSubscription, EventEmitter, EventHandler } from "./EventEmitter";

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
    triggers: TimedTrigger[] = [];
    
    static lastSubscriptionId = 0;
    
    event(eventType: TimelineEventType, triggerAt: number) {
        return new EventEmitter<TimelineEvent>(handler => {
            const id = ++TriggerList.lastSubscriptionId;
            this.insertTrigger({ id: id, type: eventType, at: triggerAt, handler: handler });
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

    async flareTimeEvent(seconds: number) {
        const triggerTime = await latestBlockTimestamp() + seconds;
        return this.flareTimeTriggers.event('FlareTime', triggerTime);
    }

    underlyingBlocksEvent(blocks: number) {
        const triggerBlock = this.chain.blockHeight() + blocks;
        return this.underlyingBlockTriggers.event('UnderlyingBlock', triggerBlock);
    }

    underlyingTimeEvent(seconds: number) {
        const triggerTime = this.chain.currentTimestamp() + seconds;
        return this.underlyingTimeTriggers.event('UnderlyingTime', triggerTime);
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
            trigger.handler({ type: trigger.type, at: trigger.at });
        }
        return triggers.length > 0; // so the caller can repeat until all triggers are exhausted
    }
}
