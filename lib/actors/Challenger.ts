import { PaymentReference } from "../fasset/PaymentReference";
import { TrackedAgentState } from "../state/TrackedAgentState";
import { TrackedState } from "../state/TrackedState";
import { ITransaction } from "../underlying-chain/interfaces/IBlockChain";
import { EventScope } from "../utils/events/ScopedEvents";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { findRequiredEvent } from "../utils/events/truffle";
import { ActorBase } from "./ActorBase";

export class Challenger extends ActorBase {
    constructor(
        runner: ScopedRunner,
        state: TrackedState,
        public address: string,
    ) {
        super(runner, state);
        this.registerForEvents();
    }
    
    registerForEvents() {
        this.chainEvents.transactionEvent().subscribe(transaction => this.handleUnderlyingTransaction(transaction));
    }

    transactionForPaymentReference = new Map<string, string>();

    handleUnderlyingTransaction(transaction: ITransaction): void {
        for (const [address, amount] of transaction.inputs) {
            const agent = this.state.agentsByUnderlying.get(address);
            if (agent == null) continue;
            // illegal transaction challenge
            this.runner.startThread((scope) => this.illegalTransactionChallenge(scope, transaction, agent));
            // double payment challenge
            if (PaymentReference.isValid(transaction.reference)) {
                const existingHash = this.transactionForPaymentReference.get(transaction.reference!);
                if (existingHash && existingHash != transaction.hash) {
                    this.runner.startThread((scope) => this.doublePaymentChallenge(scope, transaction.hash, existingHash, agent));
                } else {
                    this.transactionForPaymentReference.set(transaction.reference!, transaction.hash);
                }
            }
        }
    }

    async illegalTransactionChallenge(scope: EventScope, transaction: ITransaction, agent: TrackedAgentState) {
        await this.chainEvents.waitForUnderlyingTransactionFinalization(scope, transaction.hash);
        const proof = await this.context.attestationProvider.proveBalanceDecreasingTransaction(transaction.hash, agent.underlyingAddressString);
        // challenge everything - we want to see if the system properly rejects challenges of legal transactions
        const res = await this.context.assetManager.illegalPaymentChallenge(proof, agent.address, { from: this.address })
            .catch(e => scope.exitOnExpectedError(e, ['chlg: already liquidating', 'chlg: transaction confirmed', 'matching redemption active', 'matching ongoing announced pmt']));
        // if there is no error, illegal payment must be confirmed
        findRequiredEvent(res, 'IllegalPaymentConfirmed');
    }

    async doublePaymentChallenge(scope: EventScope, tx1hash: string, tx2hash: string, agent: TrackedAgentState) {
        await Promise.all([
            this.chainEvents.waitForUnderlyingTransactionFinalization(scope, tx1hash),
            this.chainEvents.waitForUnderlyingTransactionFinalization(scope, tx2hash),
        ]);
        const proof1 = await this.context.attestationProvider.proveBalanceDecreasingTransaction(tx1hash, agent.underlyingAddressString);
        const proof2 = await this.context.attestationProvider.proveBalanceDecreasingTransaction(tx2hash, agent.underlyingAddressString);
        const res = await this.context.assetManager.doublePaymentChallenge(proof1, proof2, agent.address, { from: this.address })
            .catch(e => scope.exitOnExpectedError(e, ['chlg dbl: already liquidating']));
        findRequiredEvent(res, 'DuplicatePaymentConfirmed');
    }
}
