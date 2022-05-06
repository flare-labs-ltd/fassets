import { writeFileSync } from "fs";
import { AssetContext, CommonContext } from "../../integration/utils/AssetContext";
import { testChainInfo, testNatInfo } from "../../integration/utils/ChainInfo";
import { Web3EventDecoder } from "../../utils/EventDecoder";
import { MockChain } from "../../utils/fasset/MockChain";
import { saveJson, weightedRandomChoice } from "../../utils/fuzzing-utils";
import { getTestFile, toWei } from "../../utils/helpers";
import { FuzzingAgent } from "./FuzzingAgent";
import { FuzzingCustomer } from "./FuzzingCustomer";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { TruffleTransactionInterceptor } from "./TransactionInterceptor";

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

    before(async () => {
        // create context
        commonContext = await CommonContext.createTest(governance, testNatInfo);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
        chain = context.chain as MockChain;
        timeline = new FuzzingTimeline(chain);
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
    });
    
    after(() => {
        interceptor.logGasUsage();
        interceptor.closeLog();
    });

    it("f-asset fuzzing test", async () => {
        // collect events
        const eventCollector = interceptor.collectEvents();
        // create agents
        const firstAgentAddress = 10;
        for (let i = 0; i < N_AGENTS; i++) {
            const underlyingAddress = "underlying_agent_" + i;
            const fa = await FuzzingAgent.createTest(timeline, context, accounts[firstAgentAddress + i], underlyingAddress);
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

        // 
        const actions: Array<[() => Promise<void>, number]> = [
            [testMint, 10],
        ];
        //
        await interceptor.allHandled();
        const events = eventCollector.popCollectedEvents();
        for (const event of events) {
            console.log(eventDecoder.format(event));
        }
        //
        for (let loop = 0; loop < LOOPS; loop++) {
            const action = weightedRandomChoice(actions);
            await action();
        }
        // const contract = agents[0].agent.agentVault;
        // console.log(Object.keys(contract));
        // console.log(Object.keys(contract.abi));
        // console.log(JSON.stringify(contract.contract._jsonInterface));
    });

    async function dispatchEvents() {
        // const events = context.assetManager.getPastEvents();
    }

    async function testMint() {

    }
});
