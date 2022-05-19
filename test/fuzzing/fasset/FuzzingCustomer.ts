import { Minter } from "../../integration/utils/Minter";
import { Redeemer } from "../../integration/utils/Redeemer";
import { IChainWallet } from "../../utils/fasset/ChainInterfaces";
import { MockChain, MockChainWallet } from "../../utils/fasset/MockChain";
import { foreachAsyncParallel, randomChoice, randomInt } from "../../utils/fuzzing-utils";
import { expectErrors, toBN } from "../../utils/helpers";
import { FuzzingActor } from "./FuzzingActor";
import { FuzzingRunner } from "./FuzzingRunner";
import { EventScope, qualifiedEvent } from "./ScopedEvents";
import { silentFailOnError } from "./ScopedRunner";

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
    
    async minting(scope: EventScope) {
        await this.context.updateUnderlyingBlock();
        // create CR
        const agent = randomChoice(this.runner.availableAgents);
        const lots = randomInt(Number(agent.freeCollateralLots));
        if (this.avoidErrors && lots === 0) return;
        const crt = await this.minter.reserveCollateral(agent.agentVault, lots)
            .catch(e => silentFailOnError(e, ['cannot mint 0 lots', 'not enough free collateral']));
        // pay
        const txHash = await this.minter.performMintingPayment(crt);
        // execute
        await this.minter.executeMinting(crt, txHash)
            .catch(e => expectErrors(e, []));
        mintedLots += lots;
    }
    
    async redemption(scope: EventScope) {
        const lotSize = await this.context.lotsSize();
        // request redemption
        const holdingUBA = toBN(await this.context.fAsset.balanceOf(this.address));
        const holdingLots = Number(holdingUBA.div(lotSize));
        const lots = randomInt(this.avoidErrors ? holdingLots : 100);
        const customerName = this.formatAddress(this.address);
        this.comment(`${customerName} lots ${lots}   total minted ${mintedLots}   holding ${holdingLots}`);
        if (this.avoidErrors && lots === 0) return;
        const [tickets, remaining] = await this.redeemer.requestRedemption(lots)
            .catch(e => silentFailOnError(e, ['Burn too big for owner', 'redeem 0 lots']));
        mintedLots -= lots - Number(remaining);
        this.comment(`${customerName}: Redeeming ${tickets.length} tickets, remaining ${remaining} lots`);
        // wait for all redemption payments or non-payments
        await foreachAsyncParallel(tickets, async ticket => {
            const event = await Promise.race([
                this.assetManagerEvent('RedemptionPerformed', { requestId: ticket.requestId }).qualified('performed').wait(scope),
                Promise.all([
                    this.timeline.underlyingBlocks(Number(this.context.settings.underlyingBlocksForPayment)).wait(scope),
                    this.timeline.underlyingTime(Number(this.context.settings.underlyingSecondsForPayment)).wait(scope),
                ]).then(() => qualifiedEvent('failed', null))
            ]);
            if (event.name === 'performed') {
                this.comment(`${customerName}, req=${ticket.requestId}: Received redemption ${Number(event.args.valueUBA) / Number(lotSize)}`);
            } else {
                this.comment(`${customerName}, req=${ticket.requestId}: Failed redemption`);
            }
        });
    }
}
