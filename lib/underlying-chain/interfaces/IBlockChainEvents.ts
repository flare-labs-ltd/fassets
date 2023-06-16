import { IBlockId, ITransaction } from "./IBlockChain";


export type BlockHandler = (blockId: IBlockId) => void;

export type TransactionHandler = (transaction: ITransaction) => void;
// Support for subscribing to chain events.
// Event subscriptions can be implementated by the chain rpc interface or by the attestation provider web interface (to make best use of indexer).

export interface IBlockChainEvents {
    // Add handler that is triggered when new block is mined. 
    // Returns subscriptionId (string), used for unsubscribing.
    addBlockHandler(handler: BlockHandler): string;

    // Add handler that is triggered when a transaction is mined.
    // Passing non-null filter reduces the number of triggering transactions to only those that match all filter fields.
    // Filter fields are implementation dependent, but at least `hash` (transaction hash), `from`, `to` (string, matching any of inputs/outputs in transaction) and `reference` (string '0x...', matching payment reference) should be supported.
    // Returns subscriptionId (string), used for unsubscribing.
    addTransactionHandler(filter: { [name: string]: string; } | null, handler: TransactionHandler): string;

    // Remove handler with given subscriptionId.
    removeHandler(subscriptionId: string): void;
}
