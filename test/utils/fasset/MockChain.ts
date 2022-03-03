import { BN_ZERO } from "flare-smart-contracts/test/utils/fuzzing-utils";
import { toBN } from "flare-smart-contracts/test/utils/test-helpers";
import { AttestationClientMockInstance } from "../../../typechain-truffle";
import { objectMap, systemTimestamp } from "../helpers";
import { web3DeepNormalize } from "../web3assertions";
import { BalanceDecreasingTransaction, BlockHeightExists, Payment, ReferencedPaymentNonexistence } from "./AssetManagerTypes";

export type BNish = BN | number | string;

export interface MockChainTransaction {
    hash: string;
    spent: { [address: string]: BN };
    received: { [address: string]: BN };
    reference: string | null;
    status: number; // 0 = success, 1 = failure (sender's fault), 2 = failure (receiver's fault)
}

export interface MockChainBlock {
    timestamp: number;
    transactions: MockChainTransaction[];
}

export function mockTransaction(spent_: { [address: string]: BNish }, received_: { [address: string]: BNish }, reference: string | null, status: number = 0): MockChainTransaction {
    const spent = objectMap(spent_, toBN);
    const received = objectMap(received_, toBN);
    const totalSpent = Object.values(spent).reduce((x, y) => x.add(y));
    const totalReceived = Object.values(received).reduce((x, y) => x.add(y));
    assert.isTrue(totalSpent.gte(totalReceived), "mockTransaction: received more than spent");
    // hash is set set when transaction is added to a block
    return { hash: '', spent, received, reference, status };
}

export function simpleMockTransaction(from: string, to: string, value: BNish, gas: BNish, reference: string | null, status: number = 0): MockChainTransaction {
    value = toBN(value);
    gas = toBN(gas);
    const spent = status === 0 ? value.add(gas) : gas;
    const received = status === 0 ? value : BN_ZERO;
    return mockTransaction({ [from]: spent }, { [to]: received }, reference, status);
}

/**
 * A simple blockchain mock, to simulate operations needed in fasset system.
 * Supports multi source/dest transactions, payment references and failed transaction records.
 * Everything is linear here - no support for complex concepts like finalization or forking
 * (these are handled in attestation system and are not really visible in fasset system).
 */
export class MockChain {
    blocks: MockChainBlock[] = [];
    transactionIndex: { [hash: string]: [block: number, txIndex: number] } = {};
    nonces: { [address: string]: number } = {};
    balances: { [address: string]: BN } = {};
    timstampSkew: number = 0;   // how much the timestamp is ahead of system time
    
    addBlock(transactions: MockChainTransaction[]) {
        // check that balances stay positive
        const changedBalances: { [address: string]: BN } = {};
        for (let i = 0; i < transactions.length; i++) {
            const transaction = transactions[i];
            for (const [src, value] of Object.entries(transaction.spent)) {
                changedBalances[src] = (changedBalances[src] ?? this.balances[src] ?? BN_ZERO).sub(value);
            }
            for (const [dest, value] of Object.entries(transaction.received)) {
                changedBalances[dest] = (changedBalances[dest] ?? this.balances[dest] ?? BN_ZERO).add(value);
            }
            for (const [address, value] of Object.entries(changedBalances)) {
                assert.isFalse(value.isNeg(), `MockChain: transaction ${i} makes balance of ${address} negative`);
            }
        }
        // update transaction data
        for (let i = 0; i < transactions.length; i++) {
            const transaction = transactions[i];
            // calculate transaction hash
            transaction.hash = this.transactionHash(transaction);
            // update source address nonces
            for (const src of Object.keys(transaction.spent)) {
                this.nonces[src] = (this.nonces[src] ?? 0) + 1;
            }
            // update index
            this.transactionIndex[transaction.hash] = [this.blocks.length, i];
        }
        // update balances
        Object.assign(this.balances, changedBalances);
        // create new block
        const timestamp = this.newBlockTimestamp();
        this.blocks.push({ timestamp, transactions });
    }
    
    transactionHash(transaction: MockChainTransaction): string {
        const data = {
            spent: Object.entries(transaction.spent).map(([address, value]) => [address, this.nonces[address] ?? 0, value.toString(10)]),
            received: Object.entries(transaction.received).map(([address, value]) => [address, value.toString(10)]),
            reference: transaction.reference
        };
        return web3.utils.keccak256(JSON.stringify(data));
    }

    private newBlockTimestamp() {
        let timestamp = systemTimestamp() + this.timstampSkew;
        const lastBlockTimestamp = this.blocks.length > 0 ? this.blocks[this.blocks.length - 1].timestamp : -1;
        return Math.max(timestamp, lastBlockTimestamp + 1);
    }
    
    skipTime(timeDelta: number) {
        this.timstampSkew += timeDelta;
    }
    
    addTransaction(spent_: { [address: string]: BNish }, received_: { [address: string]: BNish }, reference: string | null, status: number = 0): MockChainTransaction {
        const transaction = mockTransaction(spent_, received_, reference, status);
        this.addBlock([transaction]);
        return transaction;
    }
    
    addSimpleTransaction(from: string, to: string, value: BNish, gas: BNish, reference: string | null, status: number = 0): MockChainTransaction {
        const transaction = simpleMockTransaction(from, to, value, gas, reference, status);
        this.addBlock([transaction]);
        return transaction;
    }
}

export class MockAttestationClient {
    constructor(
        public chain: MockChain,
        public attestationClient: AttestationClientMockInstance,
        public chainId: number,
    ) {}
    
    CHECK_WINDOW = 86400;
    
    payment(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Payment | null {
        if (!(transactionHash in this.chain.transactionIndex)) {
            return null;
        }
        const [blockNumber, txInd] = this.chain.transactionIndex[transactionHash];
        const block = this.chain.blocks[blockNumber];
        const transaction = block.transactions[txInd];
        const sources = Object.keys(transaction.spent);
        if (sourceAddress == null) sourceAddress = sources[0];
        const recipients = Object.keys(transaction.received);
        if (receivingAddress == null) receivingAddress = recipients[0];
        const utxo = recipients.indexOf(receivingAddress);
        if (utxo < 0) {
            return null;
        }
        const spent = (transaction.spent[sourceAddress] ?? BN_ZERO).sub(transaction.received[sourceAddress] ?? BN_ZERO);
        return {
            stateConnectorRound: 0, // not needed in mock
            merkleProof: [],        // not needed in mock
            blockNumber: blockNumber,
            blockTimestamp: block.timestamp,
            transactionHash: transaction.hash,
            utxo: utxo,
            sourceAddress: web3.utils.keccak256(sourceAddress),
            receivingAddress: web3.utils.keccak256(receivingAddress),
            paymentReference: transaction.reference ?? BN_ZERO,
            spentAmount: spent,
            receivedAmount: transaction.received[receivingAddress],
            oneToOne: false,    // not needed
            status: transaction.status
        };
    }
    
    balanceDecreasingTransaction(transactionHash: string, sourceAddress: string): BalanceDecreasingTransaction | null {
        if (!(transactionHash in this.chain.transactionIndex)) {
            return null;
        }
        const [blockNumber, txInd] = this.chain.transactionIndex[transactionHash];
        const block = this.chain.blocks[blockNumber];
        const transaction = block.transactions[txInd];
        const spent = (transaction.spent[sourceAddress] ?? BN_ZERO).sub(transaction.received[sourceAddress] ?? BN_ZERO);
        if (spent.eqn(0)) {
            return null;    // no balance decrease for sourceAddress
        }
        return {
            stateConnectorRound: 0, // not needed in mock
            merkleProof: [],        // not needed in mock
            blockNumber: blockNumber,
            blockTimestamp: block.timestamp,
            transactionHash: transaction.hash,
            sourceAddress: web3.utils.keccak256(sourceAddress),
            spentAmount: spent,
            paymentReference: transaction.reference ?? BN_ZERO,
        };
    }
    
    referencedPaymentNonexistence(destinationAddress: string, paymentReference: string, amount: BN, endBlock: number, endTimestamp: number): ReferencedPaymentNonexistence | null {
        // if payment is found, return null
        const [found, firstCheckedBlock, overflowBlock] = this.findReferencedPayment(destinationAddress, paymentReference, amount, endBlock, endTimestamp);
        if (found || firstCheckedBlock === -1 || overflowBlock === -1) {
            return null;    // not enough blocks mined
        }
        // fill result
        return {
            stateConnectorRound: 0, // not needed in mock
            merkleProof: [],        // not needed in mock
            endTimestamp: endTimestamp,
            endBlock: endBlock,
            destinationAddress: web3.utils.keccak256(destinationAddress),
            paymentReference: paymentReference,
            amount: amount,
            firstCheckedBlock: firstCheckedBlock,
            firstCheckedBlockTimestamp: this.chain.blocks[firstCheckedBlock].timestamp,
            firstOverflowBlock: overflowBlock,
            firstOverflowBlockTimestamp: this.chain.blocks[overflowBlock].timestamp,
        };
    }
    
    private findReferencedPayment(destinationAddress: string, paymentReference: string, amount: BN, endBlock: number, endTimestamp: number): [boolean, number, number] {
        let firstCheckedBlock = -1;
        for (let bn = 0; bn < this.chain.blocks.length; bn++) {
            const block = this.chain.blocks[bn];
            if (block.timestamp < endTimestamp - this.CHECK_WINDOW) {
                continue;   // skip blocks before `endTimestamp - CHECK_WINDOW`
            }
            if (firstCheckedBlock === -1) {
                firstCheckedBlock = bn;
            }
            if (bn > endBlock && block.timestamp > endTimestamp) {
                return [false, firstCheckedBlock, bn];  // end search when both blockNumber and blockTimestamp are over the limits
            }
            for (const transaction of block.transactions) {
                const found = transaction.reference === paymentReference
                    && destinationAddress in transaction.received
                    && transaction.received[destinationAddress].eq(amount)
                    && transaction.status !== 1;    // status != FAILED
                if (found) {
                    return [true, firstCheckedBlock, bn];
                }
            }
        }
        return [false, firstCheckedBlock, -1];  // not found, but also didn't find overflow block
    }
    
    blockHeightExists(blockNumber: number): BlockHeightExists | null {
        if (blockNumber >= this.chain.blocks.length) {
            return null;
        }
        const block = this.chain.blocks[blockNumber];
        return {
            stateConnectorRound: 0, // not needed in mock
            merkleProof: [],        // not needed in mock
            blockNumber: blockNumber,
            blockTimestamp: block.timestamp,
        };
    }
    
    async provePayment(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<Payment | null> {
        const proof = this.payment(transactionHash, sourceAddress, receivingAddress);
        if (proof != null) {
            await this.attestationClient.provePayment(this.chainId, web3DeepNormalize(proof));
        }
        return proof;
    }

    async proveBalanceDecreasingTransaction(transactionHash: string, sourceAddress: string) {
        const proof = this.balanceDecreasingTransaction(transactionHash, sourceAddress);
        if (proof != null) {
            await this.attestationClient.proveBalanceDecreasingTransaction(this.chainId, web3DeepNormalize(proof));
        }
        return proof;
    }

    async proveReferencedPaymentNonexistence(destinationAddress: string, paymentReference: string, amount: BN, endBlock: number, endTimestamp: number) {
        const proof = this.referencedPaymentNonexistence(destinationAddress, paymentReference, amount, endBlock, endTimestamp);
        if (proof != null) {
            await this.attestationClient.proveReferencedPaymentNonexistence(this.chainId, web3DeepNormalize(proof));
        }
        return proof;
    }

    async proveBlockHeightExists(blockNumber: number) {
        const proof = this.blockHeightExists(blockNumber);
        if (proof != null) {
            await this.attestationClient.proveBlockHeightExists(this.chainId, web3DeepNormalize(proof));
        }
        return proof;
    }
}
