import { AssetContext, CommonContext } from "../../integration/utils/AssetContext";
import { testChainInfo, testNatInfo } from "../../integration/utils/ChainInfo";
import { Web3EventCollector, Web3EventDecoder } from "../../utils/EventDecoder";
import { TruffleEvent } from "../../utils/events";
import { MockChain } from "../../utils/fasset/MockChain";
import { weightedRandomChoice } from "../../utils/fuzzing-utils";
import { getTestFile, toWei, tryCatch } from "../../utils/helpers";
import { FuzzingAgent } from "./FuzzingAgent";
import { FuzzingCustomer } from "./FuzzingCustomer";
import { FuzzingTimeline } from "./FuzzingTimeline";

function instrumentContract(contract: Truffle.ContractInstance) {
    const cc = contract as any;
    for (const [name, method] of Object.entries(cc)) {
        if (typeof method !== 'function' || name === 'constructor') continue;
        const subkeys = tryCatch(() => Object.keys(method as any)) ?? [];
        console.log(name, JSON.stringify(subkeys));
    }
}

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
    let eventCollector: Web3EventCollector;

    it("f-asset fuzzing test", async () => {
        // create context
        commonContext = await CommonContext.createTest(governance, testNatInfo);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
        chain = context.chain as MockChain;
        timeline = new FuzzingTimeline(chain);
        // create event decoder and collector
        eventDecoder = new Web3EventDecoder({});
        eventCollector = new Web3EventCollector(eventDecoder);
        eventCollector.captureEvents({
            assetManager: context.assetManager,
            assetManagerController: context.assetManagerController,
            fAsset: context.fAsset,
            wnat: context.wnat,
        });
        // create agents
        const firstAgentAddress = 10;
        for (let i = 0; i < N_AGENTS; i++) {
            const underlyingAddress = "underlying_agent_" + i;
            const fa = await FuzzingAgent.createTest(timeline, context, accounts[firstAgentAddress + i], underlyingAddress);
            eventDecoder.addAddress(`OWNER_${i}`, fa.agent.ownerAddress);
            eventCollector.captureEventsFrom(`AGENT_${i}`, fa.agent.agentVault);
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
        // 
        const actions: Array<[() => Promise<void>, number]> = [
            [testMint, 10],
        ];
        //
        const events = await eventCollector.collectEvents();
        for (const event of events) {
            console.log(eventDecoder.format(event));
        }
        for (let loop = 0; loop < LOOPS; loop++) {
            const action = weightedRandomChoice(actions);
            await action();
        }
    });

    async function dispatchEvents() {
        // const events = context.assetManager.getPastEvents();
    }

    async function testMint() {

    }
});
