import { AssetContext, CommonContext } from "../../integration/utils/AssetContext";
import { testChainInfo, testNatInfo } from "../../integration/utils/ChainInfo";
import { Web3EventDecoder } from "../../utils/EventDecoder";
import { AvailableAgentInfo } from "../../utils/fasset/AssetManagerTypes";
import { MockChain } from "../../utils/fasset/MockChain";
import { randomChoice, randomInt, weightedRandomChoice } from "../../utils/fuzzing-utils";
import { expectErrors, getTestFile, reportError, toBN, toWei } from "../../utils/helpers";
import { FuzzingAgent } from "./FuzzingAgent";
import { FuzzingCustomer } from "./FuzzingCustomer";
import { FuzzingRunner } from "./FuzzingRunner";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { EventCollector, TruffleTransactionInterceptor } from "./TransactionInterceptor";
import { TruffleEvents, UnderlyingChainEvents } from "./WrappedEvents";

contract(`FAssetFuzzing.sol; ${getTestFile(__filename)}; End to end fuzzing tests`, accounts => {
    const governance = accounts[1];

    const LOOPS = 100;
    const N_AGENTS = 10;
    const N_CUSTOMERS = 10;     // minters and redeemers
    const CUSTOMER_BALANCE = toWei(10_000);

    let commonContext: CommonContext;
    let context: AssetContext;
    let timeline: FuzzingTimeline;
    let agents: FuzzingAgent[] = [];
    let customers: FuzzingCustomer[] = [];
    let chain: MockChain;
    let eventDecoder: Web3EventDecoder;
    let interceptor: TruffleTransactionInterceptor;
    let eventCollector: EventCollector;
    let truffleEvents: TruffleEvents;
    let chainEvents: UnderlyingChainEvents;
    let runner: FuzzingRunner;

    before(async () => {
        // create context
        commonContext = await CommonContext.createTest(governance, testNatInfo);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
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
        // collect events
        eventCollector = interceptor.collectEvents();
        // uniform event handlers
        truffleEvents = new TruffleEvents(interceptor);
        chainEvents = new UnderlyingChainEvents(context.chainEvents);
        timeline = new FuzzingTimeline(chain);
        // runner
        runner = new FuzzingRunner(context, interceptor, timeline, truffleEvents, chainEvents);
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
            const fa = await FuzzingAgent.createTest(runner, context, accounts[firstAgentAddress + i], underlyingAddress);
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
            const customer = await FuzzingCustomer.createTest(context, accounts[firstCustomerAddress + i], underlyingAddress, CUSTOMER_BALANCE);
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
        for (let loop = 0; loop < LOOPS; loop++) {
            const action = weightedRandomChoice(actions);
            try {
                await action();
            } catch (e) {
                reportError(e);
            }
            
        }
    });

    async function refreshAvailableAgents() {
        await runner.refreshAvailableAgents();
    }
    
    async function updateUnderlyingBlock() {
        await context.updateUnderlyingBlock();
    }

    let mintedLots = 0;
    
    async function testMint() {
        const customer = randomChoice(customers);
        runner.startThread(async () => {
            await context.updateUnderlyingBlock();
            // create CR
            const agent = randomChoice(runner.availableAgents);
            const lots = randomInt(Number(agent.freeCollateralLots));
            const crt = await customer.minter.reserveCollateral(agent.agentVault, lots);
            // pay
            const txHash = await customer.minter.performMintingPayment(crt);
            // execute
            await customer.minter.executeMinting(crt, txHash)
                .catch(e => expectErrors(e, []));
            mintedLots += lots;
        });
    }
    
    async function testRedeem() {
        const customer = randomChoice(customers);
        runner.startThread(async () => {
            // request redemption
            const lots = randomInt(100);
            const holdingUBA = toBN(await context.fAsset.balanceOf(customer.address));
            const holdingLots = holdingUBA.div(await context.lotsSize());
            console.log(`Lots ${lots}   total minted ${mintedLots}   holding ${holdingLots}`);
            if (holdingLots.eqn(0)) return;
            const [tickets, remaining] = await customer.redeemer.requestRedemption(lots);
            mintedLots -= lots;
            interceptor.comment(`${customer.minter.address}: Redeeming ${tickets.length} tickets, remaining ${remaining} lots`);
            // wait for possible non-payment
        });
    }
});
