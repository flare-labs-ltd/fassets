import { time } from "@openzeppelin/test-helpers";
import { MintingExecuted } from "../../../typechain-truffle/AssetManager";
import { findRequiredEvent } from "../../utils/events";
import { ITransaction } from "../../utils/fasset/ChainInterfaces";
import { expectErrors } from "../../utils/helpers";
import { FuzzingActor } from "./FuzzingActor";
import { FuzzingRunner } from "./FuzzingRunner";
import { FuzzingStateAgent } from "./FuzzingStateAgent";
import { EventScope } from "./ScopedEvents";
import { EvmEventArgs } from "./WrappedEvents";

export class FuzzingKeeper extends FuzzingActor {
    constructor(
        public runner: FuzzingRunner,
        public address: string,
    ) {
        super(runner);
        this.registerForEvents();
    }

    get name() {
        return this.formatAddress(this.address);
    }
    
    registerForEvents() {
        // check for liquidations when prices change
        this.state.pricesUpdated.subscribe(() => this.checkAllAgentsForLiquidation());
        // also check for liquidation after every minting
        this.assetManagerEvent('MintingExecuted').subscribe(args => this.handleMintingExecuted(args));
        // challenges
        this.chainEvents.transactionEvent().subscribe(transaction => this.handleUnderlyingTransaction(transaction));
    }
    
    async checkAllAgentsForLiquidation() {
        for (const agent of this.state.agents.values()) {
            await this.checkAgentForLiquidation(agent)
                .catch(e => expectErrors(e, []));
        }
    }
    
    handleMintingExecuted(args: EvmEventArgs<MintingExecuted>) {
        const agent = this.state.getAgent(args.agentVault);
        this.runner.startThread(async (scope) => {
            await this.checkAgentForLiquidation(agent)
                .catch(e => scope.exitOnExpectedError(e, []));
        })
    }
    
    private async checkAgentForLiquidation(agent: FuzzingStateAgent) {
        const timestamp = await time.latest();
        const newStatus = agent.possibleLiquidationTransition(timestamp);
        if (newStatus > agent.status) {
            await this.context.assetManager.startLiquidation(agent.address, { from: this.address });
        } else if (newStatus < agent.status) {
            await this.context.assetManager.endLiquidation(agent.address, { from: this.address });
        }
    }

    handleUnderlyingTransaction(transaction: ITransaction): void {
        for (const [address, amount] of transaction.inputs) {
            const agent = this.state.agentsByUnderlying.get(address);
            if (agent == null) continue;
            this.runner.startThread((scope) => this.illegalTransactionChallenge(scope, transaction, agent));
        }
    }
    
    async illegalTransactionChallenge(scope: EventScope, transaction: ITransaction, agent: FuzzingStateAgent) {
        await this.waitForUnderlyingTransactionFinalization(scope, transaction.hash);
        const proof = await this.context.attestationProvider.proveBalanceDecreasingTransaction(transaction.hash, agent.underlyingAddressString);
        // challenge everything - we want to see if the system properly rejects challenges of legal transactions
        const res = await this.context.assetManager.illegalPaymentChallenge(proof, agent.address, { from: this.address })
            .catch(e => scope.exitOnExpectedError(e, ['chlg: already liquidating', 'chlg: transaction confirmed', 'matching redemption active', 'matching ongoing announced pmt']));
        // if there is no error, illegal payment must be confirmed
        findRequiredEvent(res, 'IllegalPaymentConfirmed');
    }
}
