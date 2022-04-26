import { Agent } from "../../integration/utils/Agent";
import { AssetContext, CommonContext } from "../../integration/utils/AssetContext";
import { testChainInfo, testNatInfo } from "../../integration/utils/ChainInfo";
import { getTestFile, toWei } from "../../utils/helpers";
import { FuzzingAgent } from "./FuzzingAgent";
import { FuzzingCustomer } from "./FuzzingCustomer";

contract(`FAssetFuzzing.sol; ${getTestFile(__filename)}; End to end fuzzing tests`, accounts => {
    const governance = accounts[1];
    
    const LOOPS = 100;
    const N_AGENTS = 10;
    const N_CUSTOMERS = 10;     // minters and redeemers
    const CUSTOMER_BALANCE = toWei(10_000);
    
    let commonContext: CommonContext;
    let context: AssetContext;
    let agents: FuzzingAgent[] = [];
    let customers: FuzzingCustomer[] = [];

    it("f-asset fuzzing test", async () => {
        // create context
        commonContext = await CommonContext.createTest(governance, testNatInfo);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
        // create agents
        const firstAgentAddress = 10;
        for (let i = 0; i < N_AGENTS; i++) {
            const underlyingAddress = "agent_" + i;
            const agent = await Agent.createTest(context, accounts[firstAgentAddress + i], underlyingAddress);
            await agent.agentVault.deposit({ from: agent.ownerAddress, value: toWei(10_000) });
            await agent.makeAvailable(500, 2_5000);
            agents.push(agent);
        }
        // create customers
        const firstCustomerAddress = firstAgentAddress + N_CUSTOMERS;
        for (let i = 0; i < N_CUSTOMERS; i++) {
            const underlyingAddress = "customer_" + i;
            const customer = await FuzzingCustomer.createTest(context, accounts[firstCustomerAddress + i], underlyingAddress, CUSTOMER_BALANCE);
            customers.push(customer);
        }
        // 
        for (let loop = 0; loop < LOOPS; loop++) {
            
        }
    });
});
