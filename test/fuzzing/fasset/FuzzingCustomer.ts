import { AgentStatus } from "../../../lib/fasset/AssetManagerTypes";
import { IBlockChainWallet } from "../../../lib/underlying-chain/interfaces/IBlockChainWallet";
import { EventScope, QualifiedEvent, qualifiedEvent } from "../../../lib/utils/events/ScopedEvents";
import { EventArgs } from "../../../lib/utils/events/common";
import { BN_ZERO, errorIncluded, expectErrors, formatBN, minBN, promiseValue } from "../../../lib/utils/helpers";
import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { Minter } from "../../integration/utils/Minter";
import { Redeemer } from "../../integration/utils/Redeemer";
import { MockChain, MockChainWallet } from "../../utils/fasset/MockChain";
import { foreachAsyncParallel, randomChoice, randomInt } from "../../utils/fuzzing-utils";
import { FAssetSeller } from "./FAssetMarketplace";
import { FuzzingActor } from "./FuzzingActor";
import { FuzzingRunner } from "./FuzzingRunner";

// debug state
let mintedLots = 0;

export class RedemptionPaymentReceiver extends FuzzingActor {
    constructor(
        runner: FuzzingRunner,
        public redeemer: Redeemer,
    ) {
        super(runner);
    }

    static create(runner: FuzzingRunner, address: string, undeerlyingAddress: string) {
        const redeemer = new Redeemer(runner.context, address, undeerlyingAddress);
        return new RedemptionPaymentReceiver(runner, redeemer);
    }

    get name() {
        return this.formatAddress(this.redeemer.address);
    }

    get underlyingAddress() {
        return this.redeemer.underlyingAddress;
    }

    async handleRedemption(scope: EventScope, request: EventArgs<RedemptionRequested>) {
        // detect if default happened during wait
        const redemptionDefaultPromise = this.assetManagerEvent('RedemptionDefault', { requestId: request.requestId }).immediate().wait(scope);
        const redemptionDefault = promiseValue(redemptionDefaultPromise);
        // wait for payment or timeout
        const event = await Promise.race([
            this.chainEvents.transactionEvent({ reference: request.paymentReference, to: this.underlyingAddress }).qualified('paid').wait(scope),
            this.waitForPaymentTimeout(scope, request),
        ]);
        if (event.name === 'paid') {
            const [targetAddress, amountPaid] = event.args.outputs[0];
            const expectedAmount = request.valueUBA.sub(request.feeUBA);
            if (amountPaid.gte(expectedAmount) && targetAddress === this.underlyingAddress) {
                this.comment(`${this.name}, req=${request.requestId}: Received redemption ${Number(amountPaid)} (= ${Number(amountPaid) / Number(this.context.lotSize())} lots)`);
            } else {
                this.comment(`${this.name}, req=${request.requestId}: Invalid redemption, paid=${formatBN(amountPaid)} expected=${expectedAmount} target=${targetAddress}`);
                await this.waitForPaymentTimeout(scope, request); // still have to wait for timeout to be able to get non payment proof from SC
                if (!redemptionDefault.resolved) { // do this only if the agent has not already submitted failed payment and defaulted
                    await this.redemptionDefault(scope, request);
                }
                const result = await redemptionDefaultPromise; // now it must be fulfiled, by agent or by customer's default call
                this.comment(`${this.name}, req=${request.requestId}: default received vault=${formatBN(result.redeemedVaultCollateralWei)} pool=${formatBN(result.redeemedPoolCollateralWei)}`);
            }
        } else {
            this.comment(`${this.name}, req=${request.requestId}: Missing redemption, reference=${request.paymentReference}`);
            await this.redemptionDefault(scope, request);
        }
    }

    private async waitForPaymentTimeout(scope: EventScope, request: EventArgs<RedemptionRequested>): Promise<QualifiedEvent<"timeout", null>> {
        // both block number and timestamp must be large enough
        await Promise.all([
            this.timeline.underlyingBlockNumber(Number(request.lastUnderlyingBlock) + 1).wait(scope),
            this.timeline.underlyingTimestamp(Number(request.lastUnderlyingTimestamp) + 1).wait(scope),
        ]);
        // after that, we have to wait for finalization
        await this.timeline.underlyingBlocks(this.context.chain.finalizationBlocks).wait(scope);
        return qualifiedEvent('timeout', null);
    }

    private async redemptionDefault(scope: EventScope, request: EventArgs<RedemptionRequested>) {
        this.comment(`${this.name}, req=${request.requestId}: starting default, block=${(this.context.chain as MockChain).blockHeight()}`);
        const result = await this.redeemer.redemptionPaymentDefault(request)
            .catch(e => expectErrors(e, ['invalid request id']))    // can happen if agent confirms failed payment
            .catch(e => scope.exitOnExpectedError(e, []));
        return result;
    }
}

export class FuzzingCustomer extends FuzzingActor implements FAssetSeller {
    minter: Minter;
    redeemer: Redeemer;

    constructor(
        runner: FuzzingRunner,
        public address: string,
        public underlyingAddress: string,
        public wallet: IBlockChainWallet,
    ) {
        super(runner);
        this.minter = new Minter(runner.context, address, underlyingAddress, wallet);
        this.redeemer = new Redeemer(runner.context, address, underlyingAddress);
    }

    static async createTest(runner: FuzzingRunner, address: string, underlyingAddress: string, underlyingBalance: BN) {
        const chain = runner.context.chain;
        if (!(chain instanceof MockChain)) assert.fail("only for mock chains");
        chain.mint(underlyingAddress, underlyingBalance);
        const wallet = new MockChainWallet(chain);
        return new FuzzingCustomer(runner, address, underlyingAddress, wallet);
    }

    get name() {
        return this.formatAddress(this.address);
    }

    async fAssetBalance() {
        return await this.context.fAsset.balanceOf(this.address);
    }

    async minting(scope: EventScope) {
        await this.context.updateUnderlyingBlock();
        // create CR
        const agent = randomChoice(this.runner.availableAgents);
        const lots = randomInt(Number(agent.freeCollateralLots));
        if (this.avoidErrors && lots === 0) return;
        const crt = await this.minter.reserveCollateral(agent.agentVault, lots)
            .catch(e => scope.exitOnExpectedError(e, ['cannot mint 0 lots', 'not enough free collateral', 'inappropriate fee amount', 'rc: invalid agent status', 'agent not in mint queue']));
        // pay
        const txHash = await this.minter.performMintingPayment(crt);
        // wait for finalization
        await this.context.waitForUnderlyingTransactionFinalization(scope, txHash);
        // execute
        await this.minter.executeMinting(crt, txHash)
            .catch(e => scope.exitOnExpectedError(e, ['payment failed']));  // 'payment failed' can happen if there are several simultaneous payments and this one makes balance negative
        mintedLots += lots;
    }

    async redemption(scope: EventScope) {
        const lotSize = this.context.lotSize();
        // request redemption
        const holdingUBA = await this.fAssetBalance();
        const holdingLots = Number(holdingUBA.div(lotSize));
        const lots = randomInt(this.avoidErrors ? holdingLots : 100);
        this.comment(`${this.name} lots ${lots}   total minted ${mintedLots}   holding ${holdingLots}`);
        if (this.avoidErrors && lots === 0) return;
        const [tickets, remaining] = await this.redeemer.requestRedemption(lots)
            .catch(e => scope.exitOnExpectedError(e, ['f-asset balance too low', 'redeem 0 lots']));
        mintedLots -= lots - Number(remaining);
        this.comment(`${this.name}: Redeeming ${tickets.length} tickets, remaining ${remaining} lots`);
        // wait for all redemption payments or non-payments
        const redemptionPaymentReceiver = new RedemptionPaymentReceiver(this.runner, this.redeemer);
        await foreachAsyncParallel(tickets, async request => {
            await redemptionPaymentReceiver.handleRedemption(scope, request);
        });
    }

    async liquidate(scope: EventScope) {
        const agentsInLiquidation = Array.from(this.state.agents.values())
            .filter(agent => agent.status === AgentStatus.LIQUIDATION || agent.status === AgentStatus.FULL_LIQUIDATION)
            .map(agent => agent.address);
        if (agentsInLiquidation.length === 0) return;
        const agentAddress = randomChoice(agentsInLiquidation);
        const holdingUBA = await this.fAssetBalance();
        if (this.avoidErrors && holdingUBA.isZero()) return;
        this.context.assetManager.liquidate(agentAddress, holdingUBA, { from: this.address })
            .catch(e => scope.exitOnExpectedError(e, []));
    }

    async buyFAssetsFrom(scope: EventScope, receiverAddress: string, amount: BN) {
        const transferAmount = minBN(amount, await this.fAssetBalance());
        try {
            await this.context.fAsset.transfer(receiverAddress, transferAmount, { from: this.address });
            return transferAmount;
        } catch (e) {
            if (errorIncluded(e, ['f-asset balance too low'])) return BN_ZERO;
            throw e;
        }
    }
}
