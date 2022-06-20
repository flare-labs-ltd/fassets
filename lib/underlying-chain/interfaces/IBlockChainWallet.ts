import { IBlockChain } from "./IBlockChain";

type NumberLike = BN | number | string;

export interface TransactionOptions {
}

export interface TransactionOptionsWithFee extends TransactionOptions {
    // depending on chain, set either maxFee or (gasPrice, gasLimit), but not both
    // if not used, fee/gas limits will be calculated and added automatically by the wallet
    maxFee?: NumberLike;
    gasPrice?: NumberLike;
    gasLimit?: NumberLike;
}

export interface IBlockChainWallet {
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
    addMultiTransaction(spend: { [address: string]: NumberLike; }, receive: { [address: string]: NumberLike; }, reference: string | null, options?: TransactionOptions): Promise<string>;
}
