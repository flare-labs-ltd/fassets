import { BN_ZERO, BYTES32_ZERO, toBN } from "../helpers";
import { DHBalanceDecreasingTransaction, DHConfirmedBlockHeightExists, DHPayment, DHReferencedPaymentNonexistence } from "../verification/generated/attestation-hash-types";
import { web3DeepNormalize } from "../web3assertions";
import { TxInputOutput, TX_FAILED } from "./ChainInterfaces";
import { MockChain } from "./MockChain";

function totalValueFor(ios: TxInputOutput[], address: string) {
    let total = BN_ZERO;
    for (const [a, v] of ios) {
        if (a === address) total = total.add(v);
    }
    return total;
}

export class MockAttestationProver {
    constructor(
        public chain: MockChain,
    ) { }

    CHECK_WINDOW = 86400;

    payment(transactionHash: string, inUtxo: number, utxo: number): DHPayment | null {
        if (!(transactionHash in this.chain.transactionIndex)) {
            return null;
        }
        const [blockNumber, txInd] = this.chain.transactionIndex[transactionHash];
        const block = this.chain.blocks[blockNumber];
        const transaction = block.transactions[txInd];
        const sourceAddress = transaction.inputs[inUtxo][0];
        const receivingAddress = transaction.outputs[utxo][0];
        const spent = totalValueFor(transaction.inputs, sourceAddress).sub(totalValueFor(transaction.outputs, sourceAddress));
        const proof: DHPayment = {
            stateConnectorRound: 0, // filled later
            blockNumber: toBN(blockNumber),
            blockTimestamp: toBN(block.timestamp),
            transactionHash: transaction.hash,
            utxo: toBN(utxo),
            sourceAddress: web3.utils.keccak256(sourceAddress),
            receivingAddress: web3.utils.keccak256(receivingAddress),
            paymentReference: transaction.reference ?? BYTES32_ZERO,
            spentAmount: spent,
            receivedAmount: totalValueFor(transaction.outputs, receivingAddress),
            oneToOne: false,    // not needed
            status: toBN(transaction.status)
        };
        return web3DeepNormalize<DHPayment>(proof);
    }

    balanceDecreasingTransaction(transactionHash: string, inUtxo: number): DHBalanceDecreasingTransaction | null {
        if (!(transactionHash in this.chain.transactionIndex)) {
            return null;
        }
        const [blockNumber, txInd] = this.chain.transactionIndex[transactionHash];
        const block = this.chain.blocks[blockNumber];
        const transaction = block.transactions[txInd];
        const sourceAddress = transaction.inputs[inUtxo][0];
        const spent = totalValueFor(transaction.inputs, sourceAddress).sub(totalValueFor(transaction.outputs, sourceAddress));
        if (spent.eqn(0)) {
            return null;    // no balance decrease for sourceAddress
        }
        const proof: DHBalanceDecreasingTransaction = {
            stateConnectorRound: 0, // filled later
            blockNumber: toBN(blockNumber),
            blockTimestamp: toBN(block.timestamp),
            transactionHash: transaction.hash,
            sourceAddress: web3.utils.keccak256(sourceAddress),
            spentAmount: spent,
            paymentReference: transaction.reference ?? BYTES32_ZERO,
        };
        return web3DeepNormalize(proof);
    }

    referencedPaymentNonexistence(destinationAddress: string, paymentReference: string, amount: BN, endBlock: number, endTimestamp: number): DHReferencedPaymentNonexistence | null {
        // if payment is found, return null
        const [found, firstCheckedBlock, overflowBlock] = this.findReferencedPayment(destinationAddress, paymentReference, amount, endBlock, endTimestamp);
        if (found || firstCheckedBlock === -1 || overflowBlock === -1) {
            return null;    // not enough blocks mined
        }
        // fill result
        const proof: DHReferencedPaymentNonexistence = {
            stateConnectorRound: 0, // filled later
            endTimestamp: toBN(endTimestamp),
            endBlock: toBN(endBlock),
            destinationAddress: destinationAddress,
            paymentReference: paymentReference,
            amount: amount,
            firstCheckedBlock: toBN(firstCheckedBlock),
            firstCheckedBlockTimestamp: toBN(this.chain.blocks[firstCheckedBlock].timestamp),
            firstOverflowBlock: toBN(overflowBlock),
            firstOverflowBlockTimestamp: toBN(this.chain.blocks[overflowBlock].timestamp),
        };
        return web3DeepNormalize(proof);
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
                    && totalValueFor(transaction.outputs, destinationAddress).eq(amount)
                    && transaction.status !== TX_FAILED;
                if (found) {
                    return [true, firstCheckedBlock, bn];
                }
            }
        }
        return [false, firstCheckedBlock, -1];  // not found, but also didn't find overflow block
    }

    confirmedBlockHeightExists(blockNumber: number): DHConfirmedBlockHeightExists | null {
        if (blockNumber >= this.chain.blocks.length) {
            return null;
        }
        const block = this.chain.blocks[blockNumber];
        const proof: DHConfirmedBlockHeightExists = {
            stateConnectorRound: 0, // filled later
            blockNumber: toBN(blockNumber),
            blockTimestamp: toBN(block.timestamp),
        };
        return web3DeepNormalize(proof);
    }
}
