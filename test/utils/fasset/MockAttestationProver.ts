import { constants } from "@openzeppelin/test-helpers";
import { TxInputOutput, TX_FAILED } from "../../../lib/underlying-chain/interfaces/IBlockChain";
import { BN_ZERO, toBN } from "../../../lib/utils/helpers";
import { web3DeepNormalize } from "../../../lib/utils/web3normalize";
import { DHBalanceDecreasingTransaction, DHConfirmedBlockHeightExists, DHPayment, DHReferencedPaymentNonexistence } from "../../../lib/verification/generated/attestation-hash-types";
import { MockChain, MockChainTransaction } from "./MockChain";

export class MockAttestationProverError extends Error {
    constructor(message: string) {
        super(message);
    }
}

function totalValueFor(ios: TxInputOutput[], address: string) {
    let total = BN_ZERO;
    for (const [a, v] of ios) {
        if (web3.utils.keccak256(a) === address) total = total.add(v);
    }
    return total;
}

function totalSpentValue(transaction: MockChainTransaction, sourceAddressHash: string) {
    return totalValueFor(transaction.inputs, sourceAddressHash).sub(totalValueFor(transaction.outputs, sourceAddressHash));
}

function totalReceivedValue(transaction: MockChainTransaction, receivingAddressHash: string) {
    return totalValueFor(transaction.outputs, receivingAddressHash).sub(totalValueFor(transaction.inputs, receivingAddressHash));
}

export class MockAttestationProver {
    constructor(
        public chain: MockChain,
        public queryWindowSeconds: number,
    ) { }

    payment(transactionHash: string, transactionBlockNumber: number, inUtxo: number, utxo: number): DHPayment {
        const { transaction, block } = this.findTransaction('payment', transactionHash, transactionBlockNumber);
        const sourceAddressHash = web3.utils.keccak256(transaction.inputs[inUtxo][0]);
        const receivingAddressHash = web3.utils.keccak256(transaction.outputs[utxo][0]);
        const spent = totalSpentValue(transaction, sourceAddressHash);
        const received = totalReceivedValue(transaction, receivingAddressHash);
        const proof: DHPayment = {
            stateConnectorRound: 0, // filled later
            blockNumber: toBN(block.number),
            blockTimestamp: toBN(block.timestamp),
            transactionHash: transaction.hash,
            inUtxo: toBN(inUtxo),
            utxo: toBN(utxo),
            sourceAddressHash: sourceAddressHash,
            intendedSourceAddressHash: sourceAddressHash,
            receivingAddressHash: receivingAddressHash,
            intendedReceivingAddressHash: receivingAddressHash,
            paymentReference: transaction.reference ?? constants.ZERO_BYTES32,
            spentAmount: spent,
            intendedSpentAmount: spent,
            receivedAmount: received,
            intendedReceivedAmount: received,
            oneToOne: false,    // not needed
            status: toBN(transaction.status)
        };
        return web3DeepNormalize<DHPayment>(proof);
    }

    balanceDecreasingTransaction(transactionHash: string, transactionBlockNumber: number, sourceAddressIndicator: string): DHBalanceDecreasingTransaction {
        const { transaction, block } = this.findTransaction('balanceDecreasingTransaction', transactionHash, transactionBlockNumber);
        const sourceAddressHash = sourceAddressIndicator.length >= 10
            ? sourceAddressIndicator                                                        // sourceAddressIndicator can be hash of the address ...
            : web3.utils.keccak256(transaction.inputs[Number(sourceAddressIndicator)][0]);  // ... or hex encoded utxo number
        const spent = totalSpentValue(transaction, sourceAddressHash);
        const proof: DHBalanceDecreasingTransaction = {
            stateConnectorRound: 0, // filled later
            blockNumber: toBN(block.number),
            blockTimestamp: toBN(block.timestamp),
            transactionHash: transaction.hash,
            sourceAddressHash: sourceAddressHash,
            sourceAddressIndicator: sourceAddressIndicator,
            spentAmount: spent,
            paymentReference: transaction.reference ?? constants.ZERO_BYTES32,
        };
        return web3DeepNormalize(proof);
    }

    private findTransaction(method: string, transactionHash: string, transactionBlockNumber: number) {
        // find transaction
        const transactionIndex = this.chain.transactionIndex[transactionHash];
        if (transactionIndex == null) {
            throw new MockAttestationProverError(`AttestationProver.${method}: transaction hash not found ${transactionHash}`);
        }
        const [blockNumber, txInd] = transactionIndex;
        // check required block
        if (blockNumber !== transactionBlockNumber) {
            throw new MockAttestationProverError(`AttestationProver.${method}: transaction block mismatch: required ${transactionBlockNumber} != actual ${blockNumber}`);
        }
        // check finalization block
        const finalizationBlockNo = this.chain.blockHeight();
        if (blockNumber + this.chain.finalizationBlocks > finalizationBlockNo) {
            throw new MockAttestationProverError(`AttestationProver.${method}: not enough confirmations, ${finalizationBlockNo - blockNumber} < ${this.chain.finalizationBlocks}`);
        }
        // extract
        const block = this.chain.blocks[blockNumber];
        const transaction = block.transactions[txInd];
        return { transaction, block };
    }

    referencedPaymentNonexistence(destinationAddressHash: string, paymentReference: string, amount: BN, startBlock: number, endBlock: number, endTimestamp: number): DHReferencedPaymentNonexistence {
        // if payment is found, return null
        const [found, lowerBoundaryBlockNumber, overflowBlock] = this.findReferencedPayment(destinationAddressHash, paymentReference, amount, startBlock, endBlock, endTimestamp);
        if (found) {
            throw new MockAttestationProverError(`AttestationProver.referencedPaymentNonexistence: transaction found with reference ${paymentReference}`);
        }
        if (lowerBoundaryBlockNumber === -1) {
            throw new MockAttestationProverError(`AttestationProver.referencedPaymentNonexistence: all blocks too old`);    // cannot really happen
        }
        if (overflowBlock === -1) {
            throw new MockAttestationProverError(`AttestationProver.referencedPaymentNonexistence: overflow block not found`);
        }
        // fill result
        const proof: DHReferencedPaymentNonexistence = {
            stateConnectorRound: 0, // filled later
            deadlineTimestamp: toBN(endTimestamp),
            deadlineBlockNumber: toBN(endBlock),
            destinationAddressHash: destinationAddressHash,
            paymentReference: paymentReference,
            amount: amount,
            lowerBoundaryBlockNumber: toBN(lowerBoundaryBlockNumber),
            lowerBoundaryBlockTimestamp: toBN(this.chain.blocks[lowerBoundaryBlockNumber].timestamp),
            firstOverflowBlockNumber: toBN(overflowBlock),
            firstOverflowBlockTimestamp: toBN(this.chain.blocks[overflowBlock].timestamp),
        };
        return web3DeepNormalize(proof);
    }

    private findReferencedPayment(destinationAddressHash: string, paymentReference: string, amount: BN, startBlock: number, endBlock: number, endTimestamp: number): [boolean, number, number] {
        for (let bn = startBlock; bn < this.chain.blocks.length; bn++) {
            const block = this.chain.blocks[bn];
            if (bn > endBlock && block.timestamp > endTimestamp) {
                return [false, startBlock, bn];  // end search when both blockNumber and blockTimestamp are over the limits
            }
            for (const transaction of block.transactions) {
                const found = transaction.reference === paymentReference
                    && totalReceivedValue(transaction, destinationAddressHash).gte(amount)
                    && transaction.status !== TX_FAILED;
                if (found) {
                    return [true, startBlock, bn];
                }
            }
        }
        return [false, startBlock, -1];  // not found, but also didn't find overflow block
    }

    confirmedBlockHeightExists(blockNumber: number, queryWindow: number): DHConfirmedBlockHeightExists {
        const finalizationBlockNumber = blockNumber + this.chain.finalizationBlocks;
        if (finalizationBlockNumber > this.chain.blockHeight()) {
            throw new MockAttestationProverError(`AttestationProver.confirmedBlockHeightExists: not yet finalized (${blockNumber})`);
        }
        const block = this.chain.blocks[blockNumber];
        const windowStartTimestamp = block.timestamp - queryWindow;
        let startBlockInd = blockNumber;
        while (startBlockInd >= 0 && this.chain.blocks[startBlockInd].timestamp >= windowStartTimestamp) {
            --startBlockInd;
        }
        // By specification, we should fail if `startBlockInd < 0`, i.e. if lowest window block is not found,
        // but mock chain doesn't have much history, so this would fail many tests.
        // So we just return lqbNumber = lqbTimestamp = 0 in this case.
        const lowestQueryWindowBlock = startBlockInd >= 0 ? this.chain.blocks[startBlockInd] : null;
        const proof: DHConfirmedBlockHeightExists = {
            stateConnectorRound: 0, // filled later
            blockNumber: toBN(block.number),
            blockTimestamp: toBN(block.timestamp),
            numberOfConfirmations: toBN(this.chain.finalizationBlocks),
            lowestQueryWindowBlockNumber: toBN(lowestQueryWindowBlock?.number ?? 0),
            lowestQueryWindowBlockTimestamp: toBN(lowestQueryWindowBlock?.timestamp ?? 0),
        };
        return web3DeepNormalize(proof);
    }
}
