import { BNish, BN_ZERO, systemTimestamp, toBN } from "../helpers";
import { IBlock, IBlockChain, IBlockId, IChainWallet, ITransaction, TransactionOptions, TransactionOptionsWithFee, TxInputOutput, TX_FAILED, TX_SUCCESS } from "./ChainInterfaces";

export type MockTransactionOptions = TransactionOptions & { status?: number };
export type MockTransactionOptionsWithFee = TransactionOptionsWithFee & { status?: number };

export interface MockChainTransaction {
    hash: string;
    inputs: TxInputOutput[];
    outputs: TxInputOutput[];
    reference: string | null;
    status: number; // 0 = success, 1 = failure (sender's fault), 2 = failure (receiver's fault)
}

export interface MockChainBlock {
    hash: string;
    number: number;
    timestamp: number;
    transactions: MockChainTransaction[];
}

/**
 * A simple blockchain mock, to simulate operations needed in fasset system.
 * Supports multi source/dest transactions, payment references and failed transaction records.
 * Everything is linear here - no support for complex concepts like finalization or forking
 * (these are handled in attestation system and are not really visible in fasset system).
 */
export class MockChain implements IBlockChain {
    blocks: MockChainBlock[] = [];
    blockIndex: { [hash: string]: number } = {};
    transactionIndex: { [hash: string]: [block: number, txIndex: number] } = {};
    nonces: { [address: string]: number } = {};
    balances: { [address: string]: BN } = {};
    timestampSkew: number = 0;   // how much the timestamp is ahead of system time
    nextBlockTransactions: MockChainTransaction[] = [];
    
    // some settings that can be tuned for tests
    finalizationBlocks: number = 0;
    secondsPerBlock: number = 1;
    requiredFee: BN = BN_ZERO;   // this much gas/fee will be used at each transaction
    estimatedGasPrice: BN = BN_ZERO;
    automine: boolean = true;
    
    async getTransaction(txHash: string): Promise<ITransaction | null> {
        const [block, ind] = this.transactionIndex[txHash] ?? [null, null];
        if (block == null || ind == null) return null;
        return this.blocks[block].transactions[ind];
    }
    
    async getTransactionBlock(txHash: string): Promise<IBlockId | null> {
        const [block, _] = this.transactionIndex[txHash] ?? [null, null];
        if (block == null) return null;
        return { number: block, hash: this.blocks[block].hash };
    }
    
    async getBalance(address: string): Promise<BN> {
        return this.balances[address] ?? BN_ZERO;
    }
    
    async getBlock(blockHash: string): Promise<IBlock | null> {
        const index = this.blockIndex[blockHash];
        return index != null ? this.toIBlock(this.blocks[index]) : null;
    }
    
    async getBlockAt(blockNumber: number): Promise<IBlock | null> {
        return blockNumber < this.blocks.length ? this.toIBlock(this.blocks[blockNumber]) : null;
    }
    
    async getBlockHeight(): Promise<number> {
        return this.blocks.length - 1;
    }
    
    addTransaction(transaction: MockChainTransaction) {
        this.nextBlockTransactions.push(transaction);
        if (this.automine) {
            this.mine();
        }
    }
    
    mine() {
        this.addBlock(this.nextBlockTransactions);
        this.nextBlockTransactions = [];
    }
    
    createTransactionHash(inputs: TxInputOutput[], outputs: TxInputOutput[], reference: string | null): string {
        // build data structure to hash
        const data = {
            spent: inputs.map(([address, value]) => [address, this.nonces[address] ?? 0, value.toString(10)]),
            received: outputs.map(([address, value]) => [address, value.toString(10)]),
            reference: reference
        };
        // update source address nonces
        for (const [src, _] of inputs) {
            this.nonces[src] = (this.nonces[src] ?? 0) + 1;
        }
        // calculate hash
        return web3.utils.keccak256(JSON.stringify(data));
    }
    
    skipTime(timeDelta: number) {
        this.timestampSkew += timeDelta;
    }

    mint(address: string, value: BNish) {
        this.balances[address] = (this.balances[address] ?? BN_ZERO).add(toBN(value));
    }

    private addBlock(transactions: MockChainTransaction[]) {
        // check that balances stay positive
        const changedBalances: { [address: string]: BN } = {};
        for (let i = 0; i < transactions.length; i++) {
            const transaction = transactions[i];
            for (const [src, value] of transaction.inputs) {
                changedBalances[src] = (changedBalances[src] ?? this.balances[src] ?? BN_ZERO).sub(value);
            }
            for (const [dest, value] of transaction.outputs) {
                changedBalances[dest] = (changedBalances[dest] ?? this.balances[dest] ?? BN_ZERO).add(value);
            }
            for (const [address, value] of Object.entries(changedBalances)) {
                assert.isFalse(value.isNeg(), `MockChain: transaction ${transaction.hash} makes balance of ${address} negative`);
            }
        }
        // update transaction index
        for (let i = 0; i < transactions.length; i++) {
            this.transactionIndex[transactions[i].hash] = [this.blocks.length, i];
        }
        // update balances
        Object.assign(this.balances, changedBalances);
        // create new block
        const number = this.blocks.length;
        const timestamp = this.newBlockTimestamp();
        const hash = web3.utils.keccak256(JSON.stringify({ number, timestamp, transactions: transactions.map(tx => tx.hash) }));
        this.blocks.push({ hash, number, timestamp, transactions });
        this.blockIndex[hash] = this.blocks.length - 1;
    }

    private newBlockTimestamp() {
        const lastBlockTimestamp = this.blocks.length > 0 ? this.blocks[this.blocks.length - 1].timestamp : -this.secondsPerBlock;
        const timestamp = Math.max(systemTimestamp() + this.timestampSkew, lastBlockTimestamp + this.secondsPerBlock);
        this.timestampSkew = timestamp - systemTimestamp();  // update skew
        return timestamp;
    }
    
    private toIBlock(block: MockChainBlock): IBlock {
        const txHashes = block.transactions.map(tx => tx.hash);
        return { hash: block.hash, number: block.number, timestamp: block.timestamp, transactions: txHashes };
    }
}

export class MockChainWallet implements IChainWallet {
    constructor(
        public chain: MockChain,
    ) {}
    
    async addTransaction(from: string, to: string, value: BNish, reference: string | null, options?: MockTransactionOptionsWithFee): Promise<string> {
        const transaction = this.createTransaction(from, to, value, reference, options);
        this.chain.addTransaction(transaction);
        return transaction.hash;
    }

    async addMultiTransaction(spent: { [address: string]: BNish }, received: { [address: string]: BNish }, reference: string | null, options?: MockTransactionOptions): Promise<string> {
        const transaction = this.createMultiTransaction(spent, received, reference, options);
        this.chain.addTransaction(transaction);
        return transaction.hash;
    }

    createTransaction(from: string, to: string, value: BNish, reference: string | null, options?: MockTransactionOptionsWithFee): MockChainTransaction {
        options ??= {};
        value = toBN(value);
        const maxFee = this.calculateMaxFee(options);
        if (maxFee.lt(this.chain.requiredFee)) {
            // mark transaction failed if too little gas/fee is added (like EVM blockchains)
            options = { ...options, status: TX_FAILED };
        }
        const success = options.status == null || options.status === TX_SUCCESS;
        const spent = success ? value.add(maxFee) : maxFee;
        const received = success ? value : BN_ZERO;
        return this.createMultiTransaction({ [from]: spent }, { [to]: received }, reference, options);
    }

    createMultiTransaction(spent_: { [address: string]: BNish }, received_: { [address: string]: BNish }, reference: string | null, options?: MockTransactionOptions): MockChainTransaction {
        const inputs: TxInputOutput[] = Object.entries(spent_).map(([address, amount]) => [address, toBN(amount)]);
        const outputs: TxInputOutput[] = Object.entries(received_).map(([address, amount]) => [address, toBN(amount)]);
        const totalSpent = inputs.reduce((a, [_, x]) => a.add(x), BN_ZERO);
        const totalReceived = outputs.reduce((a, [_, x]) => a.add(x), BN_ZERO);
        const status = options?.status ?? TX_SUCCESS;
        assert.isTrue(totalSpent.gte(totalReceived), "mockTransaction: received more than spent");
        assert.isTrue(totalSpent.gte(totalReceived.add(this.chain.requiredFee)), "mockTransaction: not enough fee");
        const hash = this.chain.createTransactionHash(inputs, outputs, reference);
        // hash is set set when transaction is added to a block
        return { hash, inputs, outputs, reference, status };
    }

    private calculateMaxFee(options: TransactionOptionsWithFee) {
        if (options.maxFee != null) {
            return toBN(options.maxFee);
        } else if (options.gasLimit != null) {
            return toBN(options.gasLimit).mul(toBN(options.gasPrice ?? this.chain.estimatedGasPrice));
        } else {
            return this.chain.requiredFee;
        }
    }
}
