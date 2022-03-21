import { BNish, BN_ZERO, objectMap, systemTimestamp, toBN } from "../helpers";

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
    
    static transaction(spent_: { [address: string]: BNish }, received_: { [address: string]: BNish }, reference: string | null, status: number = 0): MockChainTransaction {
        const spent = objectMap(spent_, toBN);
        const received = objectMap(received_, toBN);
        const totalSpent = Object.values(spent).reduce((x, y) => x.add(y));
        const totalReceived = Object.values(received).reduce((x, y) => x.add(y));
        assert.isTrue(totalSpent.gte(totalReceived), "mockTransaction: received more than spent");
        // hash is set set when transaction is added to a block
        return { hash: '', spent, received, reference, status };
    }
    
    addTransaction(spent_: { [address: string]: BNish }, received_: { [address: string]: BNish }, reference: string | null, status: number = 0): MockChainTransaction {
        const transaction = MockChain.transaction(spent_, received_, reference, status);
        this.addBlock([transaction]);
        return transaction;
    }
    
    static simpleTransaction(from: string, to: string, value: BNish, gas: BNish, reference: string | null, status: number = 0): MockChainTransaction {
        value = toBN(value);
        gas = toBN(gas);
        const spent = status === 0 ? value.add(gas) : gas;
        const received = status === 0 ? value : BN_ZERO;
        return MockChain.transaction({ [from]: spent }, { [to]: received }, reference, status);
    }

    addSimpleTransaction(from: string, to: string, value: BNish, gas: BNish, reference: string | null, status: number = 0): MockChainTransaction {
        const transaction = MockChain.simpleTransaction(from, to, value, gas, reference, status);
        this.addBlock([transaction]);
        return transaction;
    }
    
    mint(address: string, value: BNish) {
        this.balances[address] = (this.balances[address] ?? BN_ZERO).add(toBN(value));
    }
}
