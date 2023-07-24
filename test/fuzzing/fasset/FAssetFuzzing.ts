import { time } from "@openzeppelin/test-helpers";
import { Challenger } from "../../../lib/actors/Challenger";
import { isVaultCollateral, isPoolCollateral } from "../../../lib/state/CollateralIndexedList";
import { UnderlyingChainEvents } from "../../../lib/underlying-chain/UnderlyingChainEvents";
import { EventExecutionQueue } from "../../../lib/utils/events/ScopedEvents";
import { expectErrors, formatBN, latestBlockTimestamp, mulDecimal, sleep, systemTimestamp, toBIPS, toBN, toWei } from "../../../lib/utils/helpers";
import { LogFile } from "../../../lib/utils/logging";
import { FtsoMockInstance } from "../../../typechain-truffle";
import { Agent, AgentCreateOptions } from "../../integration/utils/Agent";
import { AssetContext } from "../../integration/utils/AssetContext";
import { CommonContext } from "../../integration/utils/CommonContext";
import { TestChainInfo, testChainInfo } from "../../integration/utils/TestChainInfo";
import { Web3EventDecoder } from "../../utils/Web3EventDecoder";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { InclusionIterable, coinFlip, currentRealTime, getEnv, randomChoice, randomInt, randomNum, weightedRandomChoice } from "../../utils/fuzzing-utils";
import { getTestFile } from "../../utils/test-helpers";
import { FuzzingAgent } from "./FuzzingAgent";
import { FuzzingCustomer } from "./FuzzingCustomer";
import { FuzzingKeeper } from "./FuzzingKeeper";
import { FuzzingRunner } from "./FuzzingRunner";
import { FuzzingState } from "./FuzzingState";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { InterceptorEvmEvents } from "./InterceptorEvmEvents";
import { TruffleTransactionInterceptor } from "./TransactionInterceptor";
import { FuzzingPoolTokenHolder } from "./FuzzingPoolTokenHolder";

contract(`FAssetFuzzing.sol; ${getTestFile(__filename)}; End to end fuzzing tests`, accounts => {
    const startTimestamp = systemTimestamp();
    const governance = accounts[1];

    const CHAIN = getEnv('CHAIN', 'string', 'xrp');
    const LOOPS = getEnv('LOOPS', 'number', 100);
    const AUTOMINE = getEnv('AUTOMINE', 'boolean', true);
    const N_AGENTS = getEnv('N_AGENTS', 'number', 10);
    const N_CUSTOMERS = getEnv('N_CUSTOMERS', 'number', 10);     // minters and redeemers
    const N_KEEPERS = getEnv('N_KEEPERS', 'number', 1);
    const N_POOL_TOKEN_HOLDERS = getEnv('N_POOL_TOKEN_HOLDERS', 'number', 20);
    const CUSTOMER_BALANCE = toWei(getEnv('CUSTOMER_BALANCE', 'number', 10_000));  // initial underlying balance
    const AVOID_ERRORS = getEnv('AVOID_ERRORS', 'boolean', true);
    const CHANGE_LOT_SIZE_AT = getEnv('CHANGE_LOT_SIZE_AT', 'range', null);
    const CHANGE_LOT_SIZE_FACTOR = getEnv('CHANGE_LOT_SIZE_FACTOR', 'number[]', []);
    const CHANGE_PRICE_AT = getEnv('CHANGE_PRICE_AT', 'range', null);
    const CHANGE_PRICE_FACTOR = getEnv('CHANGE_PRICE_FACTOR', 'json', null) as { [key: string]: [number, number] };
    const ILLEGAL_PROB = getEnv('ILLEGAL_PROB', 'number', 1);     // likelihood of illegal operations (not normalized)

    let commonContext: CommonContext;
    let context: AssetContext;
    let timeline: FuzzingTimeline;
    let agents: FuzzingAgent[] = [];
    let customers: FuzzingCustomer[] = [];
    let keepers: FuzzingKeeper[] = [];
    let poolTokenHolders: FuzzingPoolTokenHolder[] = [];
    let challenger: Challenger;
    let chainInfo: TestChainInfo;
    let chain: MockChain;
    let eventDecoder: Web3EventDecoder;
    let interceptor: TruffleTransactionInterceptor;
    let truffleEvents: InterceptorEvmEvents;
    let eventQueue: EventExecutionQueue;
    let chainEvents: UnderlyingChainEvents;
    let fuzzingState: FuzzingState;
    let logger: LogFile;
    let runner: FuzzingRunner;
    let checkedInvariants = false;

    before(async () => {
        // create context
        commonContext = await CommonContext.createTest(governance);
        chainInfo = testChainInfo[CHAIN as keyof typeof testChainInfo] ?? assert.fail(`Invalid chain ${CHAIN}`);
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
        for (const [key, token] of Object.entries(context.stablecoins)) {
            interceptor.captureEventsFrom(key, token, "ERC20");
        }
        // uniform event handlers
        eventQueue = new EventExecutionQueue();
        context.chainEvents.executionQueue = eventQueue;
        truffleEvents = new InterceptorEvmEvents(interceptor, eventQueue);
        chainEvents = context.chainEvents;
        timeline = new FuzzingTimeline(chain, eventQueue);
        // state checker
        fuzzingState = new FuzzingState(context, truffleEvents, chainEvents, eventDecoder, eventQueue);
        fuzzingState.deleteDestroyedAgents = false;
        await fuzzingState.initialize();
        // runner
        runner = new FuzzingRunner(context, eventDecoder, interceptor, timeline, truffleEvents, chainEvents, fuzzingState, AVOID_ERRORS);
        // logging
        logger = new LogFile("test_logs/fasset-fuzzing.log");
        interceptor.logger = logger;
        chain.logger = logger;
        timeline.logger = logger;
        (context.stateConnectorClient as MockStateConnectorClient).logger = logger;
        fuzzingState.logger = logger;
    });

    after(async () => {
        // fuzzingState.logAllAgentActions();
        if (!checkedInvariants) {
            await fuzzingState.checkInvariants(false).catch(e => {});
        }
        fuzzingState.logAllAgentSummaries();
        fuzzingState.logAllPoolSummaries();
        fuzzingState.logExpectationFailures();
        interceptor.logGasUsage();
        logger.close();
        fuzzingState.withLogFile("test_logs/fasset-fuzzing-actions.log", () => fuzzingState.logAllAgentActions());
        fuzzingState.writeBalanceTrackingList("test_logs/agents-csv");
    });

    it("f-asset fuzzing test", async () => {
        // create agents
        const firstAgentAddress = 10;
        for (let i = 0; i < N_AGENTS; i++) {
            const underlyingAddress = "underlying_agent_" + i;
            const ownerUnderlyingAddress = "underlying_owner_agent_" + i;
            const ownerManagementAddress = accounts[firstAgentAddress + i];
            const ownerWorkAddress = accounts[firstAgentAddress + N_AGENTS + i];
            eventDecoder.addAddress(`OWNER_WORK_${i}`, ownerWorkAddress);
            eventDecoder.addAddress(`OWNER_MANAGEMENT_${i}`, ownerManagementAddress);
            await Agent.changeWorkAddress(context, ownerManagementAddress, ownerWorkAddress);
            const options = createAgentVaultOptions();
            const ownerAddress = coinFlip() ? ownerWorkAddress : ownerManagementAddress;
            const fuzzingAgent = await FuzzingAgent.createTest(runner, ownerAddress, underlyingAddress, ownerUnderlyingAddress, options);
            fuzzingAgent.capturePerAgentContractEvents(`AGENT_${i}`);
            await fuzzingAgent.agent.depositCollateralsAndMakeAvailable(toWei(10_000_000), toWei(10_000_000));
            agents.push(fuzzingAgent);
        }
        // create customers
        const firstCustomerAddress = firstAgentAddress + 3 * N_AGENTS;
        for (let i = 0; i < N_CUSTOMERS; i++) {
            const underlyingAddress = "underlying_customer_" + i;
            const customer = await FuzzingCustomer.createTest(runner, accounts[firstCustomerAddress + i], underlyingAddress, CUSTOMER_BALANCE);
            chain.mint(underlyingAddress, 1_000_000);
            customers.push(customer);
            eventDecoder.addAddress(`CUSTOMER_${i}`, customer.address);
            // customers can "sell" minted fassets on the mock marketplace
            runner.fAssetMarketplace.addSeller(customer);
        }
        // create liquidators
        const firstKeeperAddress = firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS;
        for (let i = 0; i < N_KEEPERS; i++) {
            const keeper = new FuzzingKeeper(runner, accounts[firstKeeperAddress + i]);
            keepers.push(keeper);
            eventDecoder.addAddress(`KEEPER_${i}`, keeper.address);
        }
        // create challenger
        const challengerAddress = accounts[firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS + N_KEEPERS];
        challenger = new Challenger(runner, fuzzingState, challengerAddress);
        eventDecoder.addAddress(`CHALLENGER`, challenger.address);
        // create pool token holders
        const firstPoolTokenHolderAddress = firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS + N_KEEPERS + 1;
        for (let i = 0; i < N_POOL_TOKEN_HOLDERS; i++) {
            const underlyingAddress = "underlying_pool_token_holder_" + i;
            const tokenHolder = new FuzzingPoolTokenHolder(runner, accounts[firstPoolTokenHolderAddress + i], underlyingAddress);
            poolTokenHolders.push(tokenHolder);
            eventDecoder.addAddress(`POOL_TOKEN_HOLDER_${i}`, tokenHolder.address);
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
            [testLiquidate, 10],
            [testConvertDustToTicket, 10],
            [testUnderlyingWithdrawal, 5],
            [refreshAvailableAgents, 1],
            [updateUnderlyingBlock, 10],
            [testEnterPool, 10],
            [testExitPool, 10],
            [testIllegalTransaction, ILLEGAL_PROB],
            [testDoublePayment, ILLEGAL_PROB],
        ];
        const timedActions: Array<[(index: number) => Promise<void>, InclusionIterable<number> | null]> = [
            [testChangeLotSize, CHANGE_LOT_SIZE_AT],
            [testChangePrices, CHANGE_PRICE_AT],
        ];
        // switch underlying chain to timed mining
        chain.automine = false;
        chain.finalizationBlocks = chainInfo.finalizationBlocks;
        // make sure here are enough blocks in chain for block height proof to succeed
        while (chain.blockHeight() <= chain.finalizationBlocks) chain.mine();
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
                if (!runAt?.includes(loop)) continue;
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
            if (runner.uncaughtErrors.length > 0) {
                throw runner.uncaughtErrors[0];
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
        runner.waitingToFinish = true;
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
        // fail immediately on unexpected errors from threads
        if (runner.uncaughtErrors.length > 0) {
            throw runner.uncaughtErrors[0];
        }
        interceptor.comment(`Remaining threads: ${runner.runningThreads}`);
        checkedInvariants = true;
        await fuzzingState.checkInvariants(true);  // all events are flushed, state must match
        assert.isTrue(fuzzingState.failedExpectations.length === 0, "fuzzing state has expectation failures");
    });

    function createAgentVaultOptions(): AgentCreateOptions {
        const vaultCollateral = randomChoice(context.collaterals.filter(isVaultCollateral));
        const poolCollateral = context.collaterals.filter(isPoolCollateral)[0];
        const mintingVaultCollateralRatioBIPS = mulDecimal(toBN(vaultCollateral.minCollateralRatioBIPS), randomNum(1, 1.5));
        const mintingPoolCollateralRatioBIPS = mulDecimal(toBN(poolCollateral.minCollateralRatioBIPS), randomNum(1, 1.5));
        return {
            vaultCollateralToken: vaultCollateral.token,
            feeBIPS: toBIPS("5%"),
            poolFeeShareBIPS: toBIPS("40%"),
            mintingVaultCollateralRatioBIPS: mintingVaultCollateralRatioBIPS,
            mintingPoolCollateralRatioBIPS: mintingPoolCollateralRatioBIPS,
            poolExitCollateralRatioBIPS: mulDecimal(mintingPoolCollateralRatioBIPS, randomNum(1, 1.25)),
            buyFAssetByAgentFactorBIPS: toBIPS(0.9),
            poolTopupCollateralRatioBIPS: randomInt(Number(poolCollateral.minCollateralRatioBIPS), Number(mintingPoolCollateralRatioBIPS)),
            poolTopupTokenPriceFactorBIPS: toBIPS(0.8),
        };
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

    async function testUnderlyingWithdrawal() {
        const agent = randomChoice(agents);
        runner.startThread((scope) => agent.announcedUnderlyingWithdrawal(scope));
    }

    async function testConvertDustToTicket() {
        const agent = randomChoice(agents);
        runner.startThread((scope) => agent.convertDustToTicket(scope));
    }

    async function testIllegalTransaction() {
        const agent = randomChoice(agents);
        runner.startThread((scope) => agent.makeIllegalTransaction(scope));
    }

    async function testDoublePayment() {
        const agentsWithRedemptions = agents.filter(agent => (fuzzingState.agents.get(agent.agent.vaultAddress)?.redemptionRequests?.size ?? 0) > 0);
        if (agentsWithRedemptions.length === 0) return;
        const agent = randomChoice(agentsWithRedemptions);
        runner.startThread((scope) => agent.makeDoublePayment(scope));
    }

    async function testLiquidate() {
        const customer = randomChoice(customers);
        runner.startThread((scope) => customer.liquidate(scope));
    }

    async function testEnterPool() {
        const lpholder = randomChoice(poolTokenHolders);
        runner.startThread((scope) => lpholder.enter(scope));
    }

    async function testExitPool() {
        const lpholder = randomChoice(poolTokenHolders);
        const fullExit = coinFlip();
        runner.startThread((scope) => lpholder.exit(scope, fullExit));
    }

    async function testChangeLotSize(index: number) {
        const lotSizeAMG = toBN(fuzzingState.settings.lotSizeAMG);
        const factor = CHANGE_LOT_SIZE_FACTOR.length > 0 ? CHANGE_LOT_SIZE_FACTOR[index % CHANGE_LOT_SIZE_FACTOR.length] : randomNum(0.5, 2);
        const newLotSizeAMG = mulDecimal(lotSizeAMG, factor);
        interceptor.comment(`Changing lot size by factor ${factor}, old=${formatBN(lotSizeAMG)}, new=${formatBN(newLotSizeAMG)}`);
        await context.setLotSizeAmg(newLotSizeAMG)
            .catch(e => expectErrors(e, ['too close to previous update']));
    }

    async function testChangePrices(index: number) {
        for (const [symbol, ftso] of Object.entries(context.ftsos)) {
            const [minFactor, maxFactor] = CHANGE_PRICE_FACTOR[symbol] ?? CHANGE_PRICE_FACTOR['default'] ?? [0.9, 1.1];
            await _changePriceOnFtso(ftso, randomNum(minFactor, maxFactor));
        }
        await context.ftsoManager.mockFinalizePriceEpoch();
    }

    async function _changePriceOnFtso(ftso: FtsoMockInstance, factor: number) {
        const { 0: price } = await ftso.getCurrentPrice();
        const newPrice = mulDecimal(price, factor);
        await ftso.setCurrentPrice(newPrice, 0);
        await ftso.setCurrentPriceFromTrustedProviders(newPrice, 0);
    }
});
