import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { Minter } from "../../integration/utils/Minter";
import { Redeemer } from "../../integration/utils/Redeemer";
import { EventArgs } from "../../utils/events";
import { IChainWallet } from "../../utils/fasset/ChainInterfaces";
import { MockChain, MockChainWallet } from "../../utils/fasset/MockChain";
import { foreachAsyncParallel, randomChoice, randomInt } from "../../utils/fuzzing-utils";
import { formatBN, toBN } from "../../utils/helpers";
import { FuzzingActor } from "./FuzzingActor";
import { FuzzingRunner } from "./FuzzingRunner";
import { AgentStatus } from "./FuzzingStateAgent";
import { EventScope, QualifiedEvent, qualifiedEvent } from "./ScopedEvents";

// debug state
let mintedLots = 0;

export class FuzzingCustomer extends FuzzingActor {
    minter: Minter;
    redeemer: Redeemer;
    
    constructor(
        runner: FuzzingRunner,
        public address: string,
        public underlyingAddress: string,
        public wallet: IChainWallet,
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
            .catch(e => scope.exitOnExpectedError(e, ['cannot mint 0 lots', 'not enough free collateral', 'inappropriate fee amount', 'rc: invalid agent status']));
        // pay
        const txHash = await this.minter.performMintingPayment(crt);
        // wait for finalization
        await this.waitForUnderlyingTransactionFinalization(scope, txHash);
        // execute
        await this.minter.executeMinting(crt, txHash)
            .catch(e => scope.exitOnExpectedError(e, []));
        mintedLots += lots;
    }
    
    async redemption(scope: EventScope) {
        const lotSize = await this.context.lotsSize();
        // request redemption
        const holdingUBA = await this.fAssetBalance();
        const holdingLots = Number(holdingUBA.div(lotSize));
        const lots = randomInt(this.avoidErrors ? holdingLots : 100);
        this.comment(`${this.name} lots ${lots}   total minted ${mintedLots}   holding ${holdingLots}`);
        if (this.avoidErrors && lots === 0) return;
        const [tickets, remaining] = await this.redeemer.requestRedemption(lots)
            .catch(e => scope.exitOnExpectedError(e, ['Burn too big for owner', 'redeem 0 lots']));
        mintedLots -= lots - Number(remaining);
        this.comment(`${this.name}: Redeeming ${tickets.length} tickets, remaining ${remaining} lots`);
        // wait for all redemption payments or non-payments
        await foreachAsyncParallel(tickets, async ticket => {
            const event = await Promise.race([
                this.chainEvents.transactionEvent({ reference: ticket.paymentReference }).qualified('paid').wait(scope),
                this.waitForPaymentTimeout(scope, ticket),
            ]);
            if (event.name === 'paid') {
                const [targetAddress, amountPaid] = event.args.outputs[0];
                const expectedAmount = ticket.valueUBA.sub(ticket.feeUBA);
                if (amountPaid.gte(expectedAmount) && targetAddress === this.underlyingAddress) {
                    this.comment(`${this.name}, req=${ticket.requestId}: Received redemption ${Number(amountPaid) / Number(lotSize)}`);
                } else {
                    this.comment(`${this.name}, req=${ticket.requestId}: Invalid redemption, paid=${formatBN(amountPaid)} expected=${expectedAmount} target=${targetAddress}`);
                    await this.waitForPaymentTimeout(scope, ticket);    // still have to wait for timeout to be able to get non payment proof from SC
                    await this.redemptionDefault(scope, ticket);
                }
            } else {
                this.comment(`${this.name}, req=${ticket.requestId}: Missing redemption, reference=${ticket.paymentReference}`);
                await this.redemptionDefault(scope, ticket);
            }
        });
    }

    private async waitForPaymentTimeout(scope: EventScope, ticket: EventArgs<RedemptionRequested>): Promise<QualifiedEvent<"timeout", null>> {
        // both block number and timestamp must be large enough
        await Promise.all([
            this.timeline.underlyingBlockNumber(Number(ticket.lastUnderlyingBlock) + 1).wait(scope),
            this.timeline.underlyingTimestamp(Number(ticket.lastUnderlyingTimestamp) + 1).wait(scope),
        ]);
        // after that, we have to wait for finalization
        await this.timeline.underlyingBlocks(this.context.chain.finalizationBlocks).wait(scope);
        return qualifiedEvent('timeout', null);
    }

    async redemptionDefault(scope: EventScope, ticket: EventArgs<RedemptionRequested>) {
        const result = await this.redeemer.redemptionPaymentDefault(ticket)
            .catch(e => scope.exitOnExpectedError(e, []));
        this.comment(`${this.name}, req=${ticket.requestId}: default received ${formatBN(result.redeemedCollateralWei)}`);
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
}
