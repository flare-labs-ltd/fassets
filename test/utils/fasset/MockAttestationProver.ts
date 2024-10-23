import Web3 from "web3";
import { constants } from "@openzeppelin/test-helpers";
import { AddressValidity, BalanceDecreasingTransaction, ConfirmedBlockHeightExists, Payment, ReferencedPaymentNonexistence } from "@flarenetwork/state-connector-protocol";
import { TX_FAILED, TxInputOutput } from "../../../lib/underlying-chain/interfaces/IBlockChain";
import { BN_ZERO } from "../../../lib/utils/helpers";
import { MockChain, MockChainTransaction } from "./MockChain";

export class MockAttestationProverError extends Error {
    constructor(message: string) {
        super(message);
    }
}

function totalValueFor(ios: TxInputOutput[], address: string) {
    let total = BN_ZERO;
    for (const [a, v] of ios) {
        if (Web3.utils.soliditySha3Raw(a) === address) total = total.add(v);
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

    payment(transactionHash: string, inUtxo: number, utxo: number): Payment.ResponseBody {
        const { transaction, block } = this.findTransaction('payment', transactionHash);
        const sourceAddressHash = Web3.utils.soliditySha3Raw(transaction.inputs[Number(inUtxo)][0]);
        const receivingAddressHash = Web3.utils.soliditySha3Raw(transaction.outputs[Number(utxo)][0]);
        const spent = totalSpentValue(transaction, sourceAddressHash);
        const received = totalReceivedValue(transaction, receivingAddressHash);
        return {
            blockNumber: String(block.number),
            blockTimestamp: String(block.timestamp),
            sourceAddressHash: sourceAddressHash,
            sourceAddressesRoot: Web3.utils.soliditySha3Raw(sourceAddressHash),
            receivingAddressHash: receivingAddressHash,
            intendedReceivingAddressHash: receivingAddressHash,
            standardPaymentReference: transaction.reference ?? constants.ZERO_BYTES32,
            spentAmount: String(spent),
            intendedSpentAmount: String(spent),
            receivedAmount: String(received),
            intendedReceivedAmount: String(received),
            oneToOne: false,    // not needed
            status: String(transaction.status)
        };
    }

    balanceDecreasingTransaction(transactionHash: string, sourceAddressIndicator: string): BalanceDecreasingTransaction.ResponseBody {
        const { transaction, block } = this.findTransaction('balanceDecreasingTransaction', transactionHash);
        const sourceAddressHash = sourceAddressIndicator.length >= 10
            ? sourceAddressIndicator                                                        // sourceAddressIndicator can be hash of the address ...
            : Web3.utils.soliditySha3Raw(transaction.inputs[Number(sourceAddressIndicator)][0]);  // ... or hex encoded utxo number
        const spent = totalSpentValue(transaction, sourceAddressHash);
        return {
            blockNumber: String(block.number),
            blockTimestamp: String(block.timestamp),
            sourceAddressHash: sourceAddressHash,
            spentAmount: String(spent),
            standardPaymentReference: transaction.reference ?? constants.ZERO_BYTES32,
        };
    }

    private findTransaction(method: string, transactionHash: string) {
        // find transaction
        const transactionIndex = this.chain.transactionIndex[transactionHash];
        if (transactionIndex == null) {
            throw new MockAttestationProverError(`AttestationProver.${method}: transaction hash not found ${transactionHash}`);
        }
        const [blockNumber, txInd] = transactionIndex;
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

    referencedPaymentNonexistence(destinationAddressHash: string, paymentReference: string, amount: BN, startBlock: number, endBlock: number, endTimestamp: number): ReferencedPaymentNonexistence.ResponseBody {
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
        return {
            minimalBlockTimestamp: String(this.chain.blocks[lowerBoundaryBlockNumber].timestamp),
            firstOverflowBlockNumber: String(overflowBlock),
            firstOverflowBlockTimestamp: String(this.chain.blocks[overflowBlock].timestamp),
        };
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

    confirmedBlockHeightExists(blockNumber: number, queryWindow: number): ConfirmedBlockHeightExists.ResponseBody {
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
        return {
            blockTimestamp: String(block.timestamp),
            numberOfConfirmations: String(this.chain.finalizationBlocks),
            lowestQueryWindowBlockNumber: String(lowestQueryWindowBlock?.number ?? 0),
            lowestQueryWindowBlockTimestamp: String(lowestQueryWindowBlock?.timestamp ?? 0),
        };
    }

    addressValidity(addressStr: string): AddressValidity.ResponseBody {
        const standardAddress = addressStr.trim();
        return {
            isValid: standardAddress != "" && !standardAddress.includes("INVALID"), // very fake check
            standardAddress: standardAddress,
            standardAddressHash: Web3.utils.soliditySha3Raw(standardAddress),
        }
    }
}
