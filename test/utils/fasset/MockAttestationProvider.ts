import { BN_ZERO } from "flare-smart-contracts/test/utils/fuzzing-utils";
import { AttestationClientMockInstance } from "../../../typechain-truffle";
import { web3DeepNormalize } from "../web3assertions";
import { BalanceDecreasingTransaction, BlockHeightExists, Payment, ReferencedPaymentNonexistence } from "./AssetManagerTypes";
import { MockChain } from "./MockChain";

export class MockAttestationProvider {
    constructor(
        public chain: MockChain,
        public attestationClient: AttestationClientMockInstance,
        public chainId: number,
    ) { }

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
        const proof: Payment = {
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
        return web3DeepNormalize(proof);
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
        const proof: BalanceDecreasingTransaction = {
            stateConnectorRound: 0, // not needed in mock
            merkleProof: [],        // not needed in mock
            blockNumber: blockNumber,
            blockTimestamp: block.timestamp,
            transactionHash: transaction.hash,
            sourceAddress: web3.utils.keccak256(sourceAddress),
            spentAmount: spent,
            paymentReference: transaction.reference ?? BN_ZERO,
        };
        return web3DeepNormalize(proof);
    }

    referencedPaymentNonexistence(destinationAddress: string, paymentReference: BN, amount: BN, endBlock: number, endTimestamp: number): ReferencedPaymentNonexistence | null {
        // if payment is found, return null
        const [found, firstCheckedBlock, overflowBlock] = this.findReferencedPayment(destinationAddress, paymentReference, amount, endBlock, endTimestamp);
        if (found || firstCheckedBlock === -1 || overflowBlock === -1) {
            return null;    // not enough blocks mined
        }
        // fill result
        const proof: ReferencedPaymentNonexistence = {
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
        return web3DeepNormalize(proof);
    }

    private findReferencedPayment(destinationAddress: string, paymentReference: BN, amount: BN, endBlock: number, endTimestamp: number): [boolean, number, number] {
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
        const proof: BlockHeightExists = {
            stateConnectorRound: 0, // not needed in mock
            merkleProof: [],        // not needed in mock
            blockNumber: blockNumber,
            blockTimestamp: block.timestamp,
        };
        return web3DeepNormalize(proof);
    }

    async provePayment(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<Payment> {
        const proof = this.payment(transactionHash, sourceAddress, receivingAddress);
        assert.isNotNull(proof, "provePayment: transaction not found");
        await this.attestationClient.provePayment(this.chainId, proof!);
        return proof!;
    }

    async proveBalanceDecreasingTransaction(transactionHash: string, sourceAddress: string): Promise<BalanceDecreasingTransaction> {
        const proof = this.balanceDecreasingTransaction(transactionHash, sourceAddress);
        assert.isNotNull(proof, "proveBalanceDecreasingTransaction: transaction not found");
        await this.attestationClient.proveBalanceDecreasingTransaction(this.chainId, proof!);
        return proof!;
    }

    async proveReferencedPaymentNonexistence(destinationAddress: string, paymentReference: BN, amount: BN, endBlock: number, endTimestamp: number): Promise<ReferencedPaymentNonexistence> {
        const proof = this.referencedPaymentNonexistence(destinationAddress, paymentReference, amount, endBlock, endTimestamp);
        assert.isNotNull(proof, "proveReferencedPaymentNonexistence: cannot prove");
        await this.attestationClient.proveReferencedPaymentNonexistence(this.chainId, proof!);
        return proof!;
    }

    async proveBlockHeightExists(blockNumber: number): Promise<BlockHeightExists> {
        const proof = this.blockHeightExists(blockNumber);
        assert.isNotNull(proof, "proveBlockHeightExists: block not found");
        await this.attestationClient.proveBlockHeightExists(this.chainId, proof!);
        return proof!;
    }
}
