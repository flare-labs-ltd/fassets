import { RedemptionFinished, RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { PaymentReference } from "../fasset/PaymentReference";
import { AgentStatus, TrackedAgentState } from "../state/TrackedAgentState";
import { TrackedState } from "../state/TrackedState";
import { AttestationClientError } from "../underlying-chain/AttestationHelper";
import { ITransaction } from "../underlying-chain/interfaces/IBlockChain";
import { EvmEventArgs } from "../utils/events/IEvmEvents";
import { EventScope } from "../utils/events/ScopedEvents";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { getOrCreate, sleep, sumBN, toBN } from "../utils/helpers";
import { ActorBase } from "./ActorBase";

const MAX_NEGATIVE_BALANCE_REPORT = 50;  // maximum number of transactions to report in freeBalanceNegativeChallenge to avoid breaking block gas limit

export class Challenger extends ActorBase {
    constructor(
        runner: ScopedRunner,
        state: TrackedState,
        public address: string,
    ) {
        super(runner, state);
        this.registerForEvents();
    }

    activeRedemptions = new Map<string, { agentAddress: string, amount: BN }>();    // paymentReference => { agent vault address, requested redemption amount }
    transactionForPaymentReference = new Map<string, string>();                     // paymentReference => transaction hash
    unconfirmedTransactions = new Map<string, Map<string, ITransaction>>();         // agentVaultAddress => (txHash => transaction)
    challengedAgents = new Set<string>();

    registerForEvents() {
        this.chainEvents.transactionEvent().subscribe(transaction => this.handleUnderlyingTransaction(transaction));
        this.assetManagerEvent('RedemptionRequested').subscribe(args => this.handleRedemptionRequested(args));
        this.assetManagerEvent('RedemptionFinished').subscribe(args => this.handleRedemptionFinished(args));
        this.assetManagerEvent('RedemptionPerformed').subscribe(args => this.handleTransactionConfirmed(args.agentVault, args.transactionHash));
        this.assetManagerEvent('RedemptionPaymentBlocked').subscribe(args => this.handleTransactionConfirmed(args.agentVault, args.transactionHash));
        this.assetManagerEvent('RedemptionPaymentFailed').subscribe(args => this.handleTransactionConfirmed(args.agentVault, args.transactionHash));
        this.assetManagerEvent('UnderlyingWithdrawalConfirmed').subscribe(args => this.handleTransactionConfirmed(args.agentVault, args.transactionHash));
    }

    handleUnderlyingTransaction(transaction: ITransaction): void {
        for (const [address, amount] of transaction.inputs) {
            const agent = this.state.agentsByUnderlying.get(address);
            if (agent == null) continue;
            // add to list of transactions
            this.addUnconfirmedTransaction(agent, transaction);
            // illegal transaction challenge
            this.checkForIllegalTransaction(transaction, agent);
            // double payment challenge
            this.checkForDoublePayment(transaction, agent);
            // negative balance challenge
            this.checkForNegativeFreeBalance(agent);
        }
    }

    handleTransactionConfirmed(agentVault: string, transactionHash: string): void {
        this.deleteUnconfirmedTransaction(agentVault, transactionHash);
        // also re-check free balance
        const agent = this.state.getAgent(agentVault);
        if (agent) this.checkForNegativeFreeBalance(agent);
    }
    
    handleRedemptionRequested(args: EvmEventArgs<RedemptionRequested>): void {
        this.activeRedemptions.set(args.paymentReference, { agentAddress: args.agentVault, amount: toBN(args.valueUBA) });
    }

    handleRedemptionFinished(args: EvmEventArgs<RedemptionFinished>): void {
        // clean up transactionForPaymentReference tracking - after redemption is finished the payment reference is immediatelly illegal anyway
        const reference = PaymentReference.redemption(args.requestId);
        this.transactionForPaymentReference.delete(reference);
        this.activeRedemptions.delete(reference);
    }
    
    // illegal transactions
    
    checkForIllegalTransaction(transaction: ITransaction, agent: TrackedAgentState) {
        const transactionValid = PaymentReference.isValid(transaction.reference) 
            && (this.isValidRedemptionReference(agent, transaction.reference) || this.isValidAnnouncedPaymentReference(agent, transaction.reference));
        // if the challenger starts tracking later, activeRedemptions might not hold all active redemeptions,
        // but that just means there will be a few unnecessary illegal transaction challenges, which is perfectly safe
        if (!transactionValid && agent.status !== AgentStatus.FULL_LIQUIDATION) {
            this.runner.startThread((scope) => this.illegalTransactionChallenge(scope, transaction, agent));
        }
    }

    async illegalTransactionChallenge(scope: EventScope, transaction: ITransaction, agent: TrackedAgentState) {
        await this.singleChallengePerAgent(agent, async () => {
            const proof = await this.waitForDecreasingBalanceProof(scope, transaction.hash, agent.underlyingAddressString);
            // due to async nature of challenging (and the fact that challenger might start tracking agent later), there may be some false challenges which will be rejected
            // this is perfectly safe for the system, but the errors must be caught
            await this.context.assetManager.illegalPaymentChallenge(proof, agent.address, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['chlg: already liquidating', 'chlg: transaction confirmed', 'matching redemption active', 'matching ongoing announced pmt']));
        });
    }
    
    // double payments

    checkForDoublePayment(transaction: ITransaction, agent: TrackedAgentState) {
        if (!PaymentReference.isValid(transaction.reference)) return;   // handled by illegal payment challenge
        const existingHash = this.transactionForPaymentReference.get(transaction.reference);
        if (existingHash && existingHash != transaction.hash) {
            this.runner.startThread((scope) => this.doublePaymentChallenge(scope, transaction.hash, existingHash, agent));
        } else {
            this.transactionForPaymentReference.set(transaction.reference, transaction.hash);
        }
    }

    async doublePaymentChallenge(scope: EventScope, tx1hash: string, tx2hash: string, agent: TrackedAgentState) {
        await this.singleChallengePerAgent(agent, async () => {
            const [proof1, proof2] = await Promise.all([
                this.waitForDecreasingBalanceProof(scope, tx1hash, agent.underlyingAddressString),
                this.waitForDecreasingBalanceProof(scope, tx2hash, agent.underlyingAddressString),
            ]);
            // due to async nature of challenging there may be some false challenges which will be rejected
            await this.context.assetManager.doublePaymentChallenge(proof1, proof2, agent.address, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['chlg dbl: already liquidating']));
        });
    }
    
    // free balance negative
    
    checkForNegativeFreeBalance(agent: TrackedAgentState) {
        const agentTransactions = this.unconfirmedTransactions.get(agent.address);
        if (agentTransactions == null) return;
        // extract the spent value for each transaction
        let transactions: Array<{ txHash: string, spent: BN }> = [];
        for (const transaction of agentTransactions.values()) {
            if (!PaymentReference.isValid(transaction.reference)) continue;     // should be caught by illegal payment challenge
            const spentAmount = transaction.inputs.find(input => input[0] === agent.underlyingAddressString)?.[1];
            if (spentAmount == null) continue;
            if (this.isValidRedemptionReference(agent, transaction.reference)) {
                const { amount } = this.activeRedemptions.get(transaction.reference)!;
                transactions.push({ txHash: transaction.hash, spent: spentAmount.sub(amount) });
            } else if (this.isValidAnnouncedPaymentReference(agent, transaction.reference)) {
                transactions.push({ txHash: transaction.hash, spent: spentAmount });
            }
            // other options should be caught by illegal payment challenge
        }
        // sort by decreasing spent amount
        transactions.sort((a, b) => a.spent.gt(b.spent) ? -1 : a.spent.lt(b.spent) ? 1 : 0);
        // extract highest MAX_REPORT transactions
        transactions = transactions.slice(0, MAX_NEGATIVE_BALANCE_REPORT);
        // initiate challenge if total spent is big enough
        const totalSpent = sumBN(transactions, tx => tx.spent);
        if (totalSpent.gt(agent.freeUnderlyingBalanceUBA)) {
            const transactionHashes = transactions.map(tx => tx.txHash);
            this.runner.startThread((scope) => this.freeBalanceNegativeChallenge(scope, transactionHashes, agent));
        }
    }

    async freeBalanceNegativeChallenge(scope: EventScope, transactionHashes: string[], agent: TrackedAgentState) {
        await this.singleChallengePerAgent(agent, async () => {
            const proofs = await Promise.all(transactionHashes.map(txHash =>
                this.waitForDecreasingBalanceProof(scope, txHash, agent.underlyingAddressString)));
            // due to async nature of challenging there may be some false challenges which will be rejected
            await this.context.assetManager.freeBalanceNegativeChallenge(proofs, agent.address, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['mult chlg: already liquidating', 'mult chlg: enough free balance', 'mult chlg: payment confirmed']));
        });
    }
    
    // utils
    
    isValidRedemptionReference(agent: TrackedAgentState, reference: string) {
        const redemption = this.activeRedemptions.get(reference);
        if (redemption == null) return false;
        return agent.address === redemption.agentAddress;
    }

    isValidAnnouncedPaymentReference(agent: TrackedAgentState, reference: string) {
        return !agent.announcedUnderlyingWithdrawalId.isZero() && reference === PaymentReference.announcedWithdrawal(agent.announcedUnderlyingWithdrawalId);
    }

    addUnconfirmedTransaction(agent: TrackedAgentState, transaction: ITransaction) {
        getOrCreate(this.unconfirmedTransactions, agent.address, () => new Map()).set(transaction.hash, transaction);
    }

    deleteUnconfirmedTransaction(agentVault: string, transactionHash: string) {
        const agentTransactions = this.unconfirmedTransactions.get(agentVault);
        if (agentTransactions) {
            agentTransactions.delete(transactionHash);
            if (agentTransactions.size === 0) this.unconfirmedTransactions.delete(agentVault);
        }
    }

    async waitForDecreasingBalanceProof(scope: EventScope, txHash: string, underlyingAddressString: string) {
        await this.chainEvents.waitForUnderlyingTransactionFinalization(scope, txHash);
        return await this.context.attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAddressString)
            .catch(e => scope.exitOnExpectedError(e, [AttestationClientError]));
    }
    
    async singleChallengePerAgent(agent: TrackedAgentState, body: () => Promise<void>) {
        while (this.challengedAgents.has(agent.address)) {
            await sleep(1);
        }
        try {
            this.challengedAgents.add(agent.address);
            if (agent.status === AgentStatus.FULL_LIQUIDATION) return;
            await body();
        } finally {
            this.challengedAgents.delete(agent.address);
        }
    }
}
