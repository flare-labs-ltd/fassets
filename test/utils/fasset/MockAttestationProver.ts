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
            inUtxo: toBN(inUtxo),
            utxo: toBN(utxo),
            sourceAddressHash: web3.utils.keccak256(sourceAddress),
            receivingAddressHash: web3.utils.keccak256(receivingAddress),
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
            inUtxo: toBN(inUtxo),
            sourceAddressHash: web3.utils.keccak256(sourceAddress),
            spentAmount: spent,
            paymentReference: transaction.reference ?? BYTES32_ZERO,
        };
        return web3DeepNormalize(proof);
    }

    referencedPaymentNonexistence(destinationAddress: string, paymentReference: string, amount: BN, endBlock: number, endTimestamp: number): DHReferencedPaymentNonexistence | null {
        // if payment is found, return null
        const [found, lowerBoundaryBlockNumber, overflowBlock] = this.findReferencedPayment(destinationAddress, paymentReference, amount, endBlock, endTimestamp);
        if (found || lowerBoundaryBlockNumber === -1 || overflowBlock === -1) {
            return null;    // not enough blocks mined
        }
        // fill result
        const proof: DHReferencedPaymentNonexistence = {
            stateConnectorRound: 0, // filled later
            deadlineTimestamp: toBN(endTimestamp),
            deadlineBlockNumber: toBN(endBlock),
            destinationAddressHash: destinationAddress,
            paymentReference: paymentReference,
            amount: amount,
            lowerBoundaryBlockNumber: toBN(lowerBoundaryBlockNumber),
            lowerBoundaryBlockTimestamp: toBN(this.chain.blocks[lowerBoundaryBlockNumber].timestamp),
            firstOverflowBlockNumber: toBN(overflowBlock),
            firstOverflowBlockTimestamp: toBN(this.chain.blocks[overflowBlock].timestamp),
        };
        return web3DeepNormalize(proof);
    }

    private findReferencedPayment(destinationAddress: string, paymentReference: string, amount: BN, endBlock: number, endTimestamp: number): [boolean, number, number] {
        let lowerBoundaryBlockNumber = -1;
        for (let bn = 0; bn < this.chain.blocks.length; bn++) {
            const block = this.chain.blocks[bn];
            if (block.timestamp < endTimestamp - this.CHECK_WINDOW) {
                continue;   // skip blocks before `endTimestamp - CHECK_WINDOW`
            }
            if (lowerBoundaryBlockNumber === -1) {
                lowerBoundaryBlockNumber = bn;
            }
            if (bn > endBlock && block.timestamp > endTimestamp) {
                return [false, lowerBoundaryBlockNumber, bn];  // end search when both blockNumber and blockTimestamp are over the limits
            }
            for (const transaction of block.transactions) {
                const found = transaction.reference === paymentReference
                    && totalValueFor(transaction.outputs, destinationAddress).gte(amount)
                    && transaction.status !== TX_FAILED;
                if (found) {
                    return [true, lowerBoundaryBlockNumber, bn];
                }
            }
        }
        return [false, lowerBoundaryBlockNumber, -1];  // not found, but also didn't find overflow block
    }

    confirmedBlockHeightExists(finalizationBlockHash: string): DHConfirmedBlockHeightExists | null {
        const blockNumber = this.chain.blockIndex[finalizationBlockHash];
        if (blockNumber == null || blockNumber >= this.chain.blocks.length) {
            return null;
        }
        const block = this.chain.blocks[blockNumber];
        const proof: DHConfirmedBlockHeightExists = {
            stateConnectorRound: 0, // filled later
            blockNumber: toBN(blockNumber),
            blockTimestamp: toBN(block.timestamp),
            numberOfConfirmations: toBN(this.chain.finalizationBlocks),
            averageBlockProductionTimeMs: toBN(Math.round(this.chain.secondsPerBlock * 1000)),
        };
        return web3DeepNormalize(proof);
    }
}
