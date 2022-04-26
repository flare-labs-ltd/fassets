import { time } from "@openzeppelin/test-helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { randomShuffle } from "../../utils/fuzzing-utils";
import { latestBlockTimestamp, reportError } from "../../utils/helpers";

interface TimedTrigger {
    time: number;
    handler: () => void;
}

export class TriggerList {
    list: TimedTrigger[] = [];
    
    insert(trigger: TimedTrigger) {
        let i = this.list.length;
        while (i > 0 && trigger.time < this.list[i - 1].time) i--;
        this.list.splice(i, 0, trigger);
    }
    
    insertAndWait(triggerTime: number) {
        return new Promise<void>((resolve) => {
            this.insert({
                time: triggerTime,
                handler: () => resolve(),
            });
        })
    }
    
    popUntil(maxTimeInclusive: number) {
        let i = 0;
        while (i < this.list.length && this.list[i].time <= maxTimeInclusive) i++;
        return this.list.splice(0, i);
    }
    
    firstTime() {
        if (this.list.length === 0) return Number.MAX_VALUE;
        return this.list[0].time;
    }
}

export class FuzzingTimeline {
    flareTimeTriggers = new TriggerList();
    underlyingTimeTriggers = new TriggerList();
    underlyingBlockTriggers = new TriggerList();

    constructor(
        public chain: MockChain,
    ) { }

    async mineNextUnderlyingBlock() {
        this.chain.mine();
    }

    async waitFlareTime(seconds: number) {
        const triggerTime = await latestBlockTimestamp() + seconds;
        await this.flareTimeTriggers.insertAndWait(triggerTime);
    }

    async waitUnderlyingBlocks(blocks: number) {
        const triggerBlock = this.chain.blockHeight() + blocks;
        await this.underlyingBlockTriggers.insertAndWait(triggerBlock);
    }

    async waitUnderlyingTime(seconds: number) {
        const triggerTime = this.chain.currentTimestamp() + seconds;
        await this.underlyingTimeTriggers.insertAndWait(triggerTime);
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
            trigger.handler();
        }
        return triggers.length > 0; // so the caller can repeat until all triggers are exhausted
    }

    startThread(method: () => Promise<void>) {
        void method()
            .catch(e => reportError(e));
    }
}
