type NumberLike = BN | number | string;

export type TxInputOutput = [address: string, amount: BN];

// possible transaction status values
export const TX_SUCCESS = 0;
export const TX_FAILED = 1;
export const TX_BLOCKED = 2;

export interface ITransaction {
    // Transaction hash.
    hash: string;
    
    // Transaction inputs and outputs.
    // For UTXO chains, there can be several inputs and outputs and same address may appear several times.
    // Fot (all?) other chains, there is only one input and output.
    // Always: `fee := sum(input amounts) - sum(output amounts) >= 0`.
    inputs: TxInputOutput[];
    outputs: TxInputOutput[];
    
    // Payment reference (a 256 bit number with defined prefix or `null` if not included)
    reference: string | null;
    
    // Transaction status (only important on chains like Ehereum, where failed transactions are recorded and charged, otherwise always 0).
    // 0 = success, 1 = failure (sender's fault), 2 = failure (receiver's fault, e.g. blocking contract)
    status: number;
}

export interface IBlockId {
    // Block hash.
    hash: string;

    // Block number.
    number: number;
}

export interface IBlock {
    // Block hash.
    hash: string;
    
    // Block number.
    number: number;
    
    // Unix block timestamp (seconds since 1.1.1970).
    timestamp: number;
    
    // List of transaction hashes, included in this block.
    transactions: string[];
}

export interface IBlockChain {
    // Estimated number of blocks to reach finalization.
    finalizationBlocks: number;
    
    // Estimated number of seconds per block.
    secondsPerBlock: number;
    
    // Return the transaction with given hash or `null` if the transaction doesn't exist.
    getTransaction(txHash: string): Promise<ITransaction | null>;

    // Return the block hash of the transaction with given hash or `null` if the transaction hasn't been mined yet.
    getTransactionBlock(txHash: string): Promise<IBlockId | null>;
    
    // Return the balance of an address on the chain. If the address does not exist, returns 0.
    getBalance(address: string): Promise<BN>;

    // Return block with given hash.
    getBlock(blockHash: string): Promise<IBlock | null>;

    // Return block (or one of the blocks, in case of multiple tips) with given block number.
    getBlockAt(blockNumber: number): Promise<IBlock | null>;
    
    // Return the (approximate) current block height (last mined block number).
    getBlockHeight(): Promise<number>;
}

export interface TransactionOptions {
}

export interface TransactionOptionsWithFee extends TransactionOptions {
    // depending on chain, set either maxFee or (gasPrice, gasLimit), but not both
    // if not used, fee/gas limits will be calculated and added automatically by the wallet
    maxFee?: NumberLike;
    gasPrice?: NumberLike;
    gasLimit?: NumberLike;
}

export interface IChainWallet {
    chain: IBlockChain;
    
    // Create a transaction with a single source and target address.
    // Amount is the amount received by target and extra fee / gas can be added to it to obtain the value spent from sourceAddress
    // (the added amount can be limited by maxFee).
    // Returns new transaction hash.
    addTransaction(sourceAddress: string, targetAddress: string, amount: NumberLike, reference: string | null, options?: TransactionOptionsWithFee): Promise<string>;

    // Add a generic transaction from a set of source addresses to a set of target addresses.
    // Total source amount may be bigger (but not smaller!) than total target amount, the rest (or part of it) can be used as gas/fee (not all need to be used).
    // This variant is typically used on utxo chains.
    // Returns new transaction hash.
    addMultiTransaction(spend: { [address: string]: NumberLike }, receive: { [address: string]: NumberLike }, reference: string | null, options?: TransactionOptions): Promise<string>;
}
