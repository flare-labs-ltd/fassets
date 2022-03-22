import { AttestationClientMockInstance } from "../../../typechain-truffle";
import { BN_ZERO, BYTES32_ZERO, toBN } from "../helpers";
import { DHBalanceDecreasingTransaction, DHConfirmedBlockHeightExists, DHPayment, DHReferencedPaymentNonexistence, DHType } from "../verification/generated/attestation-hash-types";
import { dataHash } from "../verification/generated/attestation-hash-utils";
import { ARType } from "../verification/generated/attestation-request-types";
import { AttestationType } from "../verification/generated/attestation-types-enum";
import { MerkleTree } from "../MerkleTree";
import { web3DeepNormalize } from "../web3assertions";
import { MockChain } from "./MockChain";
import { TxInputOutput, TX_FAILED } from "./ChainInterfaces";

type ProvedDH<T extends DHType> = T & { merkleProof: string };

function totalValueFor(ios: TxInputOutput[], address: string) {
    let total = BN_ZERO;
    for (const [a, v] of ios) {
        if (a === address) total = total.add(v);
    }
    return total;
}

export class MockAttestationProvider {
    constructor(
        public chain: MockChain,
        public attestationClient: AttestationClientMockInstance,
        public chainId: number,
    ) { }
    
    stateConnectorRound = 0;

    CHECK_WINDOW = 86400;

    payment(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): DHPayment | null {
        if (!(transactionHash in this.chain.transactionIndex)) {
            return null;
        }
        const [blockNumber, txInd] = this.chain.transactionIndex[transactionHash];
        const block = this.chain.blocks[blockNumber];
        const transaction = block.transactions[txInd];
        if (sourceAddress == null) sourceAddress = transaction.inputs[0][0];
        if (receivingAddress == null) receivingAddress = transaction.outputs[0][0];
        const utxo = transaction.outputs.findIndex(([a, _]) => a === receivingAddress);
        if (utxo < 0) {
            return null;
        }
        const spent = totalValueFor(transaction.inputs, sourceAddress).sub(totalValueFor(transaction.outputs, sourceAddress));
        const proof: DHPayment = {
            stateConnectorRound: this.stateConnectorRound,
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

    balanceDecreasingTransaction(transactionHash: string, sourceAddress: string): DHBalanceDecreasingTransaction | null {
        if (!(transactionHash in this.chain.transactionIndex)) {
            return null;
        }
        const [blockNumber, txInd] = this.chain.transactionIndex[transactionHash];
        const block = this.chain.blocks[blockNumber];
        const transaction = block.transactions[txInd];
        const spent = totalValueFor(transaction.inputs, sourceAddress).sub(totalValueFor(transaction.outputs, sourceAddress));
        if (spent.eqn(0)) {
            return null;    // no balance decrease for sourceAddress
        }
        const proof: DHBalanceDecreasingTransaction = {
            stateConnectorRound: this.stateConnectorRound,
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
            stateConnectorRound: this.stateConnectorRound,
            endTimestamp: toBN(endTimestamp),
            endBlock: toBN(endBlock),
            destinationAddress: web3.utils.keccak256(destinationAddress),
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
            stateConnectorRound: this.stateConnectorRound,
            blockNumber: toBN(blockNumber),
            blockTimestamp: toBN(block.timestamp),
        };
        return web3DeepNormalize(proof);
    }

    async provePayment(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<ProvedDH<DHPayment>> {
        const proof = this.payment(transactionHash, sourceAddress, receivingAddress);
        assert.isNotNull(proof, "provePayment: transaction not found");
        return await this.proveGeneric(AttestationType.Payment, proof!);
    }

    async proveBalanceDecreasingTransaction(transactionHash: string, sourceAddress: string): Promise<ProvedDH<DHBalanceDecreasingTransaction>> {
        const proof = this.balanceDecreasingTransaction(transactionHash, sourceAddress);
        assert.isNotNull(proof, "proveBalanceDecreasingTransaction: transaction not found");
        return await this.proveGeneric(AttestationType.BalanceDecreasingTransaction, proof!);
    }

    async proveReferencedPaymentNonexistence(destinationAddress: string, paymentReference: string, amount: BN, endBlock: number, endTimestamp: number): Promise<ProvedDH<DHReferencedPaymentNonexistence>> {
        const proof = this.referencedPaymentNonexistence(destinationAddress, paymentReference, amount, endBlock, endTimestamp);
        assert.isNotNull(proof, "proveReferencedPaymentNonexistence: cannot prove");
        return await this.proveGeneric(AttestationType.ReferencedPaymentNonexistence, proof!);
    }

    async proveConfirmedBlockHeightExists(blockNumber: number): Promise<ProvedDH<DHConfirmedBlockHeightExists>> {
        const proof = this.confirmedBlockHeightExists(blockNumber);
        assert.isNotNull(proof, "proveConfirmedBlockHeightExists: block not found");
        return await this.proveGeneric(AttestationType.ConfirmedBlockHeightExists, proof!);
    }
    
    private async proveGeneric<T extends DHType>(attestationType: AttestationType, proof: T) {
        const hash = dataHash({ attestationType: attestationType, sourceId: this.chainId } as ARType, proof);
        const tree = new MerkleTree([hash]);
        await this.attestationClient.setMerkleRootForStateConnectorRound(tree.root!, this.stateConnectorRound);
        proof.stateConnectorRound = this.stateConnectorRound;
        proof.merkleProof = tree.getProof(0)!;
        ++this.stateConnectorRound;
        return proof as ProvedDH<T>;
    }
}
