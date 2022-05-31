import { time } from "@openzeppelin/test-helpers";
import { AssetContext, CommonContext } from "../../integration/utils/AssetContext";
import { ChainInfo, testChainInfo, testNatInfo } from "../../integration/utils/ChainInfo";
import { Web3EventDecoder } from "../../utils/EventDecoder";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { currentRealTime, getEnv, randomChoice, randomNum, weightedRandomChoice } from "../../utils/fuzzing-utils";
import { expectErrors, formatBN, getTestFile, latestBlockTimestamp, sleep, systemTimestamp, toBN, toWei } from "../../utils/helpers";
import { FuzzingAgent } from "./FuzzingAgent";
import { FuzzingCustomer } from "./FuzzingCustomer";
import { FuzzingRunner } from "./FuzzingRunner";
import { FuzzingState } from "./FuzzingState";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { EventExecutionQueue } from "./ScopedEvents";
import { TruffleTransactionInterceptor } from "./TransactionInterceptor";
import { EvmEvents, UnderlyingChainEvents } from "./WrappedEvents";

contract(`FAssetFuzzing.sol; ${getTestFile(__filename)}; End to end fuzzing tests`, accounts => {
    const startTimestamp = systemTimestamp();
    const governance = accounts[1];

    const LOOPS = getEnv('LOOPS', 'number', 100);
    const AUTOMINE = getEnv('AUTOMINE', 'boolean', true);
    const N_AGENTS = getEnv('N_AGENTS', 'number', 10);
    const N_CUSTOMERS = getEnv('N_CUSTOMERS', 'number', 10);     // minters and redeemers
    const CUSTOMER_BALANCE = toWei(getEnv('CUSTOMER_BALANCE', 'number', 10_000));  // initial underlying balance
    const AVOID_ERRORS = getEnv('AVOID_ERRORS', 'boolean', true);
    const CHANGE_LOT_SIZE_AT = getEnv('CHANGE_LOT_SIZE_AT', 'number[]', []);
    const CHANGE_LOT_SIZE_FACTOR = getEnv('CHANGE_LOT_SIZE_FACTOR', 'number[]', []);

    let commonContext: CommonContext;
    let context: AssetContext;
    let timeline: FuzzingTimeline;
    let agents: FuzzingAgent[] = [];
    let customers: FuzzingCustomer[] = [];
    let chainInfo: ChainInfo;
    let chain: MockChain;
    let eventDecoder: Web3EventDecoder;
    let interceptor: TruffleTransactionInterceptor;
    let truffleEvents: EvmEvents;
    let eventQueue: EventExecutionQueue;
    let chainEvents: UnderlyingChainEvents;
    let fuzzingState: FuzzingState;
    let runner: FuzzingRunner;

    before(async () => {
        // by default, hardhat test network starts with timestamp 2021-01-01, but for fuzzing we prefer to sync with real time
        await time.increaseTo(systemTimestamp());
        await time.advanceBlock();
        // create context
        commonContext = await CommonContext.createTest(governance, testNatInfo);
        chainInfo = testChainInfo.eth;
        context = await AssetContext.createTest(commonContext, chainInfo);
        chain = context.chain as MockChain;
        // create interceptor
        eventDecoder = new Web3EventDecoder({});
        interceptor = new TruffleTransactionInterceptor(eventDecoder, accounts[0]);
        interceptor.captureEvents({
            assetManager: context.assetManager,
            assetManagerController: context.assetManagerController,
            fAsset: context.fAsset,
            wnat: context.wnat,
        });
        // uniform event handlers
        eventQueue = new EventExecutionQueue();
        truffleEvents = new EvmEvents(interceptor, eventQueue);
        chainEvents = new UnderlyingChainEvents(context.chainEvents, eventQueue);
        timeline = new FuzzingTimeline(chain, eventQueue);
        // state checker
        fuzzingState = new FuzzingState(context, timeline, truffleEvents, chainEvents, eventDecoder);
        // runner
        runner = new FuzzingRunner(context, eventDecoder, interceptor, timeline, truffleEvents, chainEvents, fuzzingState, AVOID_ERRORS);
        // logging
        interceptor.openLog("test_logs/fasset-fuzzing.log");
        chain.logFile = interceptor.logFile;
        timeline.logFile = interceptor.logFile;
        (context.stateConnectorClient as MockStateConnectorClient).logFile = interceptor.logFile;
        fuzzingState.logFile = interceptor.logFile;
    });
    
    after(() => {
        interceptor.logGasUsage();
        interceptor.closeLog();
    });

    it("f-asset fuzzing test", async () => {
        // create agents
        const firstAgentAddress = 10;
        for (let i = 0; i < N_AGENTS; i++) {
            const underlyingAddress = "underlying_agent_" + i;
            const fa = await FuzzingAgent.createTest(runner, accounts[firstAgentAddress + i], underlyingAddress);
            eventDecoder.addAddress(`OWNER_${i}`, fa.agent.ownerAddress);
            interceptor.captureEventsFrom(`AGENT_${i}`, fa.agent.agentVault, 'AgentVault');
            await fa.agent.agentVault.deposit({ from: fa.agent.ownerAddress, value: toWei(10_000_000) });
            await fa.agent.makeAvailable(500, 2_5000);
            agents.push(fa);
        }
        // create customers
        const firstCustomerAddress = firstAgentAddress + N_CUSTOMERS;
        for (let i = 0; i < N_CUSTOMERS; i++) {
            const underlyingAddress = "underlying_customer_" + i;
            const customer = await FuzzingCustomer.createTest(runner, accounts[firstCustomerAddress + i], underlyingAddress, CUSTOMER_BALANCE);
            chain.mint(underlyingAddress, 1_000_000);
            customers.push(customer);
            eventDecoder.addAddress(`CUSTOMER_${i}`, customer.address);
        }
        // await context.wnat.send("1000", { from: governance });
        await interceptor.allHandled();
        // init some state
        await refreshAvailableAgents();
        // actions
        const actions: Array<[() => Promise<void>, number]> = [
            [testMint, 10],
            [testRedeem, 10],
            [testSelfMint, 10],
            [testSelfClose, 10],
            [testSelfClose, 10],
            [testConvertDustToTickets, 10],
            [refreshAvailableAgents, 1],
            [updateUnderlyingBlock, 10],
        ];
        const timedActions: Array<[(index: number) => Promise<void>, number[]]> = [
            [testChangeLotSize, CHANGE_LOT_SIZE_AT],
        ];
        // switch underlying chain to timed mining
        chain.automine = false;
        chain.finalizationBlocks = chainInfo.finalizationBlocks;
        if (!AUTOMINE) {
            await interceptor.setMiningMode('manual', 1000);
        }
        // perform actions
        for (let loop = 1; loop <= LOOPS; loop++) {
            // run random action
            const action = weightedRandomChoice(actions);
            try {
                await action();
            } catch (e) {
                interceptor.logUnexpectedError(e, '!!! JS ERROR');
                expectErrors(e, []);
            }
            // run actions, triggered at certain loop numbers
            for (const [timedAction, runAt] of timedActions) {
                await interceptor.allHandled();
                if (runAt.length === 0 || !runAt.includes(loop)) continue;
                try {
                    const index = runAt.indexOf(loop);
                    await timedAction(index);
                } catch (e) {
                    interceptor.logUnexpectedError(e, '!!! JS ERROR');
                    expectErrors(e, []);
                }
                await interceptor.allHandled();
            }
            // fail immediately on unexpected errors from threads
            if (runner.uncaughtError != null) {
                throw runner.uncaughtError;
            }
            // occassionally skip some time
            if (loop % 10 === 0) {
                // run all queued event handlers
                eventQueue.runAll();
                await fuzzingState.checkInvariants(false);     // state change may happen during check, so we don't wany failure here
                interceptor.comment(`-----  LOOP ${loop}  ${await timeInfo()}  -----`);
                await timeline.skipTime(100);
                await timeline.executeTriggers();
                await interceptor.allHandled();
            }
        }
        // wait for all threads to finish
        interceptor.comment(`Remaining threads: ${runner.runningThreads}`);
        while (runner.runningThreads > 0) {
            await sleep(200);
            await timeline.skipTime(100);
            interceptor.comment(`-----  WAITING  ${await timeInfo()}  -----`);
            await timeline.executeTriggers();
            await interceptor.allHandled();
            while (eventQueue.length > 0) {
                eventQueue.runAll();
                await interceptor.allHandled();
            }
        }
        interceptor.comment(`Remaining threads: ${runner.runningThreads}`);
        await fuzzingState.checkInvariants(true);  // all events are flushed, state must match
        // logStateAgentActions();
    });
    
    function logStateAgentActions() {
        if (!interceptor.logFile) return;
        interceptor.logFile.log("AGENT ACTIONS");
        for (const agent of fuzzingState.agents.values()) {
            agent.writeActionLog(interceptor.logFile);
        }
    }
    
    async function timeInfo() {
        return `block=${await time.latestBlock()} timestamp=${await latestBlockTimestamp() - startTimestamp}  ` +
               `underlyingBlock=${chain.blockHeight()} underlyingTimestamp=${chain.lastBlockTimestamp() - startTimestamp}  ` +
               `skew=${await latestBlockTimestamp() - chain.lastBlockTimestamp()}  ` +
               `realTime=${(currentRealTime() - startTimestamp).toFixed(3)}`;
    }

    async function refreshAvailableAgents() {
        await runner.refreshAvailableAgents();
    }
    
    async function updateUnderlyingBlock() {
        await context.updateUnderlyingBlock();
    }

    async function testMint() {
        const customer = randomChoice(customers);
        runner.startThread((scope) => customer.minting(scope));
    }

    async function testSelfMint() {
        const agent = randomChoice(agents);
        runner.startThread((scope) => agent.selfMint(scope));
    }

    async function testRedeem() {
        const customer = randomChoice(customers);
        runner.startThread((scope) => customer.redemption(scope));
    }

    async function testSelfClose() {
        const agent = randomChoice(agents);
        runner.startThread((scope) => agent.selfClose(scope));
    }

    async function testConvertDustToTickets() {
        const agent = randomChoice(agents);
        runner.startThread((scope) => agent.convertDustToTickets(scope));
    }
    
    async function testChangeLotSize(index: number) {
        const lotSizeAMG = toBN(fuzzingState.settings.lotSizeAMG);
        const factor = CHANGE_LOT_SIZE_FACTOR.length > index ? CHANGE_LOT_SIZE_FACTOR[index] : randomNum(0.5, 2);
        const newLotSizeAMG = lotSizeAMG.muln(factor);
        interceptor.comment(`Changing lot size by factor ${factor}, old=${formatBN(lotSizeAMG)}, new=${formatBN(newLotSizeAMG)}`);
        await context.assetManagerController.setLotSizeAmg([context.assetManager.address], newLotSizeAMG, { from: context.governance })
            .catch(e => expectErrors(e, ['too close to previous update']));
    }
});
