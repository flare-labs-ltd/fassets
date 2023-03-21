import { Challenger } from "../../../lib/actors/Challenger";
import { PaymentReference } from "../../../lib/fasset/PaymentReference";
import { AgentStatus } from "../../../lib/state/TrackedAgentState";
import { TrackedState } from "../../../lib/state/TrackedState";
import { UnderlyingChainEvents } from "../../../lib/underlying-chain/UnderlyingChainEvents";
import { EventArgs } from "../../../lib/utils/events/common";
import { EventExecutionQueue } from "../../../lib/utils/events/ScopedEvents";
import { ScopedRunner } from "../../../lib/utils/events/ScopedRunner";
import { sleep, toBN, toBNExp } from "../../../lib/utils/helpers";
import { ILogger, NullLog } from "../../../lib/utils/logging";
import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { InterceptorEvmEvents } from "../../fuzzing/fasset/InterceptorEvmEvents";
import { TruffleTransactionInterceptor } from "../../fuzzing/fasset/TransactionInterceptor";
import { Agent } from "../../integration/utils/Agent";
import { AssetContext } from "../../integration/utils/AssetContext";
import { CommonContext } from "../../integration/utils/CommonContext";
import { Minter } from "../../integration/utils/Minter";
import { Redeemer } from "../../integration/utils/Redeemer";
import { testChainInfo, TestChainInfo, testNatInfo } from "../../integration/utils/TestChainInfo";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../utils/test-helpers";
import { Web3EventDecoder } from "../../utils/Web3EventDecoder";

contract(`ChallengerTests.ts; ${getTestFile(__filename)}; Challenger bot unit tests`, async accounts => {
    const governance = accounts[1];

    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";
    const underlyingOwner1 = "Owner1";
    const customerAddress1 = accounts[30];
    const underlyingCustomer1 = "Customer1";
    const challengerAddress1 = accounts[50];

    let commonContext: CommonContext;
    let context: AssetContext;
    // let timeline: FuzzingTimeline;
    let chainInfo: TestChainInfo;
    let chain: MockChain;
    let eventDecoder: Web3EventDecoder;
    let interceptor: TruffleTransactionInterceptor;
    let truffleEvents: InterceptorEvmEvents;
    let eventQueue: EventExecutionQueue;
    let chainEvents: UnderlyingChainEvents;
    let trackedState: TrackedState;
    let logger: ILogger;
    let runner: ScopedRunner;

    let agent: Agent;
    let minter: Minter;
    let redeemer: Redeemer;

    async function waitThreadsToFinish() {
        while (runner.runningThreads > 0 || eventQueue.length > 0) {
            chain.mine();
            await sleep(20);
            eventQueue.runAll();
            await interceptor.allHandled();
        }
    }

    async function performMinting(minter: Minter, agent: Agent, lots: number) {
        const crt = await minter.reserveCollateral(agent.agentVault.address, lots);
        const txHash = await minter.performMintingPayment(crt);
        await minter.executeMinting(crt, txHash);
    }

    async function getAgentStatus(agent: Agent) {
        const agentInfo = await agent.getAgentInfo();
        return Number(agentInfo.status) as AgentStatus;
    }

    beforeEach(async () => {
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
            wnat: context.wNat,
            ftsoManager: context.ftsoManager,
        });
        // uniform event handlers
        eventQueue = new EventExecutionQueue();
        context.chainEvents.executionQueue = eventQueue;
        truffleEvents = new InterceptorEvmEvents(interceptor, eventQueue);
        chainEvents = context.chainEvents;
        // timeline = new FuzzingTimeline(chain, eventQueue);
        // state checker
        trackedState = new TrackedState(context, truffleEvents, chainEvents, eventDecoder, eventQueue);
        await trackedState.initialize();
        // runner
        runner = new ScopedRunner();
        // logging
        // logger = new LogFile("test_logs/challenger.log")
        logger = new NullLog();
        interceptor.logger = logger;
        chain.logger = logger;
        // timeline.logger = logger;
        (context.stateConnectorClient as MockStateConnectorClient).logger = logger;
        trackedState.logger = logger;
        // actors
        agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        await agent.depositCollateral(toBNExp(100_000_000, 18));
        await agent.makeAvailable(500, 3_0000);
        minter = await Minter.createTest(context, customerAddress1, underlyingCustomer1, toBNExp(100_000, 18));
        redeemer = await Redeemer.create(context, customerAddress1, underlyingCustomer1);
    });

    it("challenge illegal payment", async () => {
        const challenger = new Challenger(runner, trackedState, challengerAddress1);
        await performMinting(minter, agent, 50);
        const agentInfo = await agent.getAgentInfo();
        await agent.performPayment(underlyingOwner1, toBN(agentInfo.mintedUBA).divn(2));
        await waitThreadsToFinish();
        const status1 = await getAgentStatus(agent);
        assert.equal(status1, AgentStatus.FULL_LIQUIDATION);
    });

    it("challenge illegal payment - reference for nonexisting redemption", async () => {
        const challenger = new Challenger(runner, trackedState, challengerAddress1);
        await performMinting(minter, agent, 50);
        const agentInfo = await agent.getAgentInfo();
        await agent.performPayment(underlyingOwner1, toBN(agentInfo.mintedUBA).divn(2), PaymentReference.redemption(15));
        await waitThreadsToFinish();
        const status1 = await getAgentStatus(agent);
        assert.equal(status1, AgentStatus.FULL_LIQUIDATION);
    });

    it("challenge double payment", async () => {
        const challenger = new Challenger(runner, trackedState, challengerAddress1);
        await performMinting(minter, agent, 50);
        const [reqs] = await redeemer.requestRedemption(10);
        await agent.performRedemptionPayment(reqs[0]);
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.NORMAL);
        await agent.performRedemptionPayment(reqs[0]);  // repeat the same payment
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.FULL_LIQUIDATION);
    });

    it("challenge double payment - announced withdrawal", async () => {
        const challenger = new Challenger(runner, trackedState, challengerAddress1);
        await performMinting(minter, agent, 50);
        const agentInfo = await agent.getAgentInfo();
        const announce = await agent.announceUnderlyingWithdrawal();
        await agent.performPayment(underlyingOwner1, toBN(agentInfo.freeUnderlyingBalanceUBA).divn(2), announce.paymentReference);
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.NORMAL);
        // repeat the same payment
        await agent.performPayment(underlyingOwner1, toBN(agentInfo.freeUnderlyingBalanceUBA).divn(2), announce.paymentReference);
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.FULL_LIQUIDATION);
    });

    it("challenge illegal payment - reference for already confirmed redemption", async () => {
        const challenger = new Challenger(runner, trackedState, challengerAddress1);
        await performMinting(minter, agent, 50);
        const [reqs] = await redeemer.requestRedemption(10);
        const txHash = await agent.performRedemptionPayment(reqs[0]);
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.NORMAL);
        await agent.confirmActiveRedemptionPayment(reqs[0], txHash);
        // repeat the same payment (already confirmed)
        await agent.performRedemptionPayment(reqs[0]);
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.FULL_LIQUIDATION);
    });

    it("challenge illegal payment - reference for already confirmed announced withdrawal", async () => {
        const challenger = new Challenger(runner, trackedState, challengerAddress1);
        await performMinting(minter, agent, 50);
        const agentInfo = await agent.getAgentInfo();
        const announce = await agent.announceUnderlyingWithdrawal();
        const txHash = await agent.performPayment(underlyingOwner1, toBN(agentInfo.freeUnderlyingBalanceUBA).divn(2), announce.paymentReference);
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.NORMAL);
        await agent.confirmUnderlyingWithdrawal(announce, txHash);
        // repeat the same payment
        await agent.performPayment(underlyingOwner1, toBN(agentInfo.freeUnderlyingBalanceUBA).divn(2), announce.paymentReference);
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.FULL_LIQUIDATION);
    });

    it("challenge negative free balance - single request", async () => {
        const challenger = new Challenger(runner, trackedState, challengerAddress1);
        await performMinting(minter, agent, 50);
        const [reqs] = await redeemer.requestRedemption(10);
        const request = reqs[0];
        const agentInfo = await context.assetManager.getAgentInfo(agent.agentVault.address);
        const amount = toBN(request.valueUBA).add(toBN(agentInfo.freeUnderlyingBalanceUBA)).addn(10);
        await agent.performPayment(request.paymentAddress, amount, request.paymentReference);
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.FULL_LIQUIDATION);
    });

    it("challenge negative free balance - multiple requests", async () => {
        const N = 10;
        const challenger = new Challenger(runner, trackedState, challengerAddress1);
        // mint
        await performMinting(minter, agent, 50);
        // find free balance
        const agentInfo = await context.assetManager.getAgentInfo(agent.agentVault.address);
        // make redemption requests
        const requests: EventArgs<RedemptionRequested>[] = [];
        for (let i = 0; i < N; i++) {
            const [reqs] = await redeemer.requestRedemption(1);
            requests.push(...reqs);
        }
        assert.equal(requests.length, N);
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.NORMAL);
        // pay requests with extra
        const payGas = toBN(agentInfo.freeUnderlyingBalanceUBA).divn(N).addn(10);   // in total, pay just a bit more then there is free balance
        for (const request of requests) {
            const amount = toBN(request.valueUBA).add(payGas);
            await agent.performPayment(request.paymentAddress, amount, request.paymentReference);
        }
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.FULL_LIQUIDATION);
    });

    it("challenge negative free balance - n-1 payments not enough", async () => {
        const N = 10;
        const challenger = new Challenger(runner, trackedState, challengerAddress1);
        // mint
        await performMinting(minter, agent, 50);
        // find free balance
        const agentInfo = await context.assetManager.getAgentInfo(agent.agentVault.address);
        const payGas = toBN(agentInfo.freeUnderlyingBalanceUBA).divn(N).addn(10);   // in total, pay just a bit more then there is free balance
        // make redemption requests
        const requests: EventArgs<RedemptionRequested>[] = [];
        for (let i = 0; i < N; i++) {
            const [reqs] = await redeemer.requestRedemption(1);
            requests.push(...reqs);
        }
        assert.equal(requests.length, N);
        // pay N - 1 requests
        for (const request of requests.slice(N - 1)) {
            const amount = toBN(request.valueUBA).add(payGas);
            await agent.performPayment(request.paymentAddress, amount, request.paymentReference);
        }
        // the free balance should not yet be negative
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.NORMAL);
        // pay last request
        const request = requests[N - 1];
        const amount = toBN(request.valueUBA).add(payGas);
        await agent.performPayment(request.paymentAddress, amount, request.paymentReference);
        // now the challenger should liquidate
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.FULL_LIQUIDATION);
    });

    it("challenge negative free balance - more than 50 payments overwhelm the challenger", async () => {
        const N = 52;
        const challenger = new Challenger(runner, trackedState, challengerAddress1);
        // mint
        await performMinting(minter, agent, 100);
        // find free balance
        const agentInfo = await context.assetManager.getAgentInfo(agent.agentVault.address);
        // make redemption requests
        const requests: EventArgs<RedemptionRequested>[] = [];
        for (let i = 0; i < N; i++) {
            const [reqs] = await redeemer.requestRedemption(1);
            requests.push(...reqs);
        }
        assert.equal(requests.length, N);
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.NORMAL);
        // pay requests with extra
        const payGas = toBN(agentInfo.freeUnderlyingBalanceUBA).divn(N).addn(10);   // in total, pay just a bit more then there is free balance
        const txHashes: string[] = [];
        for (const request of requests) {
            const amount = toBN(request.valueUBA).add(payGas);
            const txHash = await agent.performPayment(request.paymentAddress, amount, request.paymentReference);
            txHashes.push(txHash);
        }
        // cannot challenbge because too much gas would be used
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.NORMAL);
        // but after agent confirms 2 transactions, it shoud work
        for (let i = 0; i < 2; i++) {
            await agent.confirmActiveRedemptionPayment(requests[i], txHashes[i]);
        }
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.FULL_LIQUIDATION);
    });

    it("challenge negative free balance - always challenge the biggest spenders", async () => {
        const N = 100;
        const challenger = new Challenger(runner, trackedState, challengerAddress1);
        // mint
        await performMinting(minter, agent, 100);
        // find free balance
        const agentInfo = await context.assetManager.getAgentInfo(agent.agentVault.address);
        // make redemption requests
        const requests: EventArgs<RedemptionRequested>[] = [];
        for (let i = 0; i < N; i++) {
            const [reqs] = await redeemer.requestRedemption(1);
            requests.push(...reqs);
        }
        assert.equal(requests.length, N);
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.NORMAL);
        // pay requests with extra
        const payGas = toBN(agentInfo.freeUnderlyingBalanceUBA).divn(N/2).addn(10);   // in total, pay just a bit more then there is free balance
        const txHashes: string[] = [];
        for (let i = 0; i < requests.length; i++) {
            const request = requests[i];
            const amount = i % 2 === 0 ? toBN(request.valueUBA).add(payGas) : toBN(request.valueUBA);   // only every second request spends any extra
            const txHash = await agent.performPayment(request.paymentAddress, amount, request.paymentReference);
            txHashes.push(txHash);
        }
        // challenge should work
        await waitThreadsToFinish();
        assert.equal(await getAgentStatus(agent), AgentStatus.FULL_LIQUIDATION);
    });

});
