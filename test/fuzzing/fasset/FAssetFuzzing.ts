import { AssetContext, CommonContext } from "../../integration/utils/AssetContext";
import { ChainInfo, testChainInfo, testNatInfo } from "../../integration/utils/ChainInfo";
import { Web3EventDecoder } from "../../utils/EventDecoder";
import { MockChain } from "../../utils/fasset/MockChain";
import { randomChoice, weightedRandomChoice } from "../../utils/fuzzing-utils";
import { expectErrors, getTestFile, sleep, toWei } from "../../utils/helpers";
import { FuzzingAgent } from "./FuzzingAgent";
import { FuzzingCustomer } from "./FuzzingCustomer";
import { FuzzingRunner } from "./FuzzingRunner";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { TruffleTransactionInterceptor } from "./TransactionInterceptor";
import { TruffleEvents, UnderlyingChainEvents } from "./WrappedEvents";

contract(`FAssetFuzzing.sol; ${getTestFile(__filename)}; End to end fuzzing tests`, accounts => {
    const governance = accounts[1];

    const LOOPS = 100;
    const N_AGENTS = 10;
    const N_CUSTOMERS = 10;     // minters and redeemers
    const CUSTOMER_BALANCE = toWei(10_000);
    const AVOID_ERRORS = true;

    let commonContext: CommonContext;
    let context: AssetContext;
    let timeline: FuzzingTimeline;
    let agents: FuzzingAgent[] = [];
    let customers: FuzzingCustomer[] = [];
    let chainInfo: ChainInfo;
    let chain: MockChain;
    let eventDecoder: Web3EventDecoder;
    let interceptor: TruffleTransactionInterceptor;
    let truffleEvents: TruffleEvents;
    let chainEvents: UnderlyingChainEvents;
    let runner: FuzzingRunner;

    before(async () => {
        // create context
        commonContext = await CommonContext.createTest(governance, testNatInfo);
        chainInfo = testChainInfo.eth;
        context = await AssetContext.createTest(commonContext, chainInfo);
        chain = context.chain as MockChain;
        // create interceptor
        eventDecoder = new Web3EventDecoder({});
        interceptor = new TruffleTransactionInterceptor(eventDecoder);
        interceptor.captureEvents({
            assetManager: context.assetManager,
            assetManagerController: context.assetManagerController,
            fAsset: context.fAsset,
            wnat: context.wnat,
        });
        interceptor.openLog("test_logs/fasset-fuzzing.log");
        interceptor.logViewMethods = false;
        // uniform event handlers
        truffleEvents = new TruffleEvents(interceptor);
        chainEvents = new UnderlyingChainEvents(context.chainEvents);
        timeline = new FuzzingTimeline(chain);
        // runner
        runner = new FuzzingRunner(context, eventDecoder, interceptor, timeline, truffleEvents, chainEvents, AVOID_ERRORS);
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
            [refreshAvailableAgents, 1],
            [updateUnderlyingBlock, 10],
        ];
        // perform actions
        for (let loop = 1; loop <= LOOPS; loop++) {
            const action = weightedRandomChoice(actions);
            try {
                await action();
            } catch (e) {
                interceptor.logUnexpectedError(e, '!!! JS ERROR');
                expectErrors(e, []);
            }
            // fail immediately on unexpected errors from threads
            if (runner.uncaughtError != null) {
                throw runner.uncaughtError;
            }
            // occassionally skip some time
            if (loop % 10 === 0) {
                await timeline.skipTime(100);
            }
            await timeline.executeTriggers();
            await interceptor.allHandled();
        }
        // wait for all threads to finish
        interceptor.comment(`Remaining threads: ${runner.runningThreads}`);
        while (runner.runningThreads > 0) {
            await sleep(200);
            await timeline.skipTime(100);
            await timeline.executeTriggers();
            await interceptor.allHandled();
        }
        interceptor.comment(`Remaining threads: ${runner.runningThreads}`);
    });

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
    
    async function testRedeem() {
        const customer = randomChoice(customers);
        runner.startThread((scope) => customer.redemption(scope));
    }
});
