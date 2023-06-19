import { constants } from "@openzeppelin/test-helpers";
import { DHBalanceDecreasingTransaction, DHConfirmedBlockHeightExists, DHPayment, DHReferencedPaymentNonexistence, DHType } from "../verification/generated/attestation-hash-types";
import { ARBalanceDecreasingTransaction, ARConfirmedBlockHeightExists, ARPayment, ARReferencedPaymentNonexistence } from "../verification/generated/attestation-request-types";
import { AttestationType } from "../verification/generated/attestation-types-enum";
import { SourceId } from "../verification/sources/sources";
import { IBlockChain, TxInputOutput } from "./interfaces/IBlockChain";
import { AttestationRequestId, AttestationResponse, IStateConnectorClient } from "./interfaces/IStateConnectorClient";
import { AttestationDefinitionStore } from "../verification/attestation-types/AttestationDefinitionStore";

// Attestation provider data that is always proved (i.e. contains Merkle proof).
export type ProvedDH<T extends DHType> = T & { merkleProof: string };

export class AttestationClientError extends Error {
    constructor(message: string) {
        super(message);
    }
}

function findAddressIndex(ios: TxInputOutput[], address: string | null, defaultValue: number) {
    if (address == null) return defaultValue;
    for (let i = 0; i < ios.length; i++) {
        if (ios[i][0] === address) return i;
    }
    throw new AttestationClientError(`address ${address} not used in transaction`);
}

export class AttestationHelper {
    static deepCopyWithObjectCreate = true;

    constructor(
        public client: IStateConnectorClient,
        public chain: IBlockChain,
        public chainId: SourceId,
    ) {}

    roundFinalized(round: number): Promise<boolean> {
        return this.client.roundFinalized(round);
    }

    waitForRoundFinalization(round: number): Promise<void> {
        return this.client.waitForRoundFinalization(round);
    }

    async requestPaymentProof(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<AttestationRequestId | null> {
        const transaction = await this.chain.getTransaction(transactionHash);
        const block = await this.chain.getTransactionBlock(transactionHash);
        if (transaction == null || block == null) {
            throw new AttestationClientError(`transaction not found ${transactionHash}`);
        };
        const finalizationBlock = await this.chain.getBlockAt(block.number + this.chain.finalizationBlocks);
        if (finalizationBlock == null) {
            throw new AttestationClientError(`finalization block not found (block ${block.number}, height ${await this.chain.getBlockHeight()})`);
        }
        const request: ARPayment = {
            attestationType: AttestationType.Payment,
            sourceId: this.chainId,
            inUtxo: findAddressIndex(transaction.inputs, sourceAddress, 0),
            utxo: findAddressIndex(transaction.outputs, receivingAddress, 0),
            id: transactionHash,
            blockNumber: block.number,
            messageIntegrityCode: constants.ZERO_BYTES32,
        };
        return await this.client.submitRequest(request);
    }

    async requestBalanceDecreasingTransactionProof(transactionHash: string, sourceAddress: string): Promise<AttestationRequestId | null> {
        const transaction = await this.chain.getTransaction(transactionHash);
        const block = await this.chain.getTransactionBlock(transactionHash);
        if (transaction == null || block == null) {
            throw new AttestationClientError(`transaction not found ${transactionHash}`);
        };
        const finalizationBlock = await this.chain.getBlockAt(block.number + this.chain.finalizationBlocks);
        if (finalizationBlock == null) {
            throw new AttestationClientError(`finalization block not found (block ${block.number}, height ${await this.chain.getBlockHeight()})`);
        }
        const request: ARBalanceDecreasingTransaction = {
            attestationType: AttestationType.BalanceDecreasingTransaction,
            sourceId: this.chainId,
            sourceAddressIndicator: web3.utils.keccak256(sourceAddress),
            id: transactionHash,
            blockNumber: block.number,
            messageIntegrityCode: constants.ZERO_BYTES32,
        };
        return await this.client.submitRequest(request);
    }

    async requestReferencedPaymentNonexistenceProof(destinationAddress: string, paymentReference: string, amount: BN, startBlock: number, endBlock: number, endTimestamp: number): Promise<AttestationRequestId | null> {
        let overflowBlock = await this.chain.getBlockAt(endBlock + 1);
        while (overflowBlock != null && overflowBlock.timestamp <= endTimestamp) {
            overflowBlock = await this.chain.getBlockAt(overflowBlock.number + 1);
        }
        if (overflowBlock == null) {
            throw new AttestationClientError(`overflow block not found (overflowBlock ${endBlock + 1}, endTimestamp ${endTimestamp}, height ${await this.chain.getBlockHeight()})`);
        }
        const finalizationBlock = await this.chain.getBlockAt(overflowBlock.number + this.chain.finalizationBlocks);
        if (finalizationBlock == null) {
            throw new AttestationClientError(`finalization block not found (block ${overflowBlock.number}, height ${await this.chain.getBlockHeight()})`);
        }
        const request: ARReferencedPaymentNonexistence = {
            attestationType: AttestationType.ReferencedPaymentNonexistence,
            sourceId: this.chainId,
            minimalBlockNumber: startBlock,
            deadlineBlockNumber: endBlock,
            deadlineTimestamp: endTimestamp,
            destinationAddressHash: web3.utils.keccak256(destinationAddress),
            amount: amount,
            paymentReference: paymentReference,
            messageIntegrityCode: constants.ZERO_BYTES32,
        };
        return await this.client.submitRequest(request);
    }

    async requestConfirmedBlockHeightExistsProof(queryWindow: number): Promise<AttestationRequestId | null> {
        const blockHeight = await this.chain.getBlockHeight();
        const finalizationBlock = await this.chain.getBlockAt(blockHeight);
        if (finalizationBlock == null) {
            throw new AttestationClientError(`finalization block not found (block ${blockHeight}, height ${await this.chain.getBlockHeight()})`);
        }
        const request: ARConfirmedBlockHeightExists = {
            attestationType: AttestationType.ConfirmedBlockHeightExists,
            sourceId: this.chainId,
            blockNumber: blockHeight - this.chain.finalizationBlocks,
            queryWindow: queryWindow,
            messageIntegrityCode: constants.ZERO_BYTES32,
        };
        return await this.client.submitRequest(request);
    }

    async obtainPaymentProof(round: number, requestData: string): Promise<AttestationResponse<DHPayment>> {
        return await this.client.obtainProof(round, requestData) as AttestationResponse<DHPayment>;
    }

    async obtainBalanceDecreasingTransactionProof(round: number, requestData: string): Promise<AttestationResponse<DHBalanceDecreasingTransaction>> {
        return await this.client.obtainProof(round, requestData) as AttestationResponse<DHBalanceDecreasingTransaction>;
    }

    async obtainReferencedPaymentNonexistenceProof(round: number, requestData: string): Promise<AttestationResponse<DHReferencedPaymentNonexistence>> {
        return await this.client.obtainProof(round, requestData) as AttestationResponse<DHReferencedPaymentNonexistence>;
    }

    async obtainConfirmedBlockHeightExistsProof(round: number, requestData: string): Promise<AttestationResponse<DHConfirmedBlockHeightExists>> {
        return await this.client.obtainProof(round, requestData) as AttestationResponse<DHConfirmedBlockHeightExists>;
    }

    async provePayment(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<ProvedDH<DHPayment>> {
        const request = await this.requestPaymentProof(transactionHash, sourceAddress, receivingAddress);
        if (request == null) {
            throw new AttestationClientError("payment: not proved")
        }
        await this.client.waitForRoundFinalization(request.round);
        const { result } = await this.obtainPaymentProof(request.round, request.data);
        if (result == null || result.merkleProof == null) {
            throw new AttestationClientError("payment: not proved")
        }
        return result as ProvedDH<DHPayment>;
    }

    async proveBalanceDecreasingTransaction(transactionHash: string, sourceAddress: string): Promise<ProvedDH<DHBalanceDecreasingTransaction>> {
        const request = await this.requestBalanceDecreasingTransactionProof(transactionHash, sourceAddress);
        if (request == null) {
            throw new AttestationClientError("balanceDecreasingTransaction: not proved")
        }
        await this.client.waitForRoundFinalization(request.round);
        const { result } = await this.obtainBalanceDecreasingTransactionProof(request.round, request.data);
        if (result == null || result.merkleProof == null) {
            throw new AttestationClientError("balanceDecreasingTransaction: not proved")
        }
        return result as ProvedDH<DHBalanceDecreasingTransaction>;
    }

    async proveReferencedPaymentNonexistence(destinationAddress: string, paymentReference: string, amount: BN, startBlock: number, endBlock: number, endTimestamp: number): Promise<ProvedDH<DHReferencedPaymentNonexistence>> {
        const request = await this.requestReferencedPaymentNonexistenceProof(destinationAddress, paymentReference, amount, startBlock, endBlock, endTimestamp);
        if (request == null) {
            throw new AttestationClientError("referencedPaymentNonexistence: not proved")
        }
        await this.client.waitForRoundFinalization(request.round);
        const { result } = await this.obtainReferencedPaymentNonexistenceProof(request.round, request.data);
        if (result == null || result.merkleProof == null) {
            throw new AttestationClientError("referencedPaymentNonexistence: not proved")
        }
        return result as ProvedDH<DHReferencedPaymentNonexistence>;
    }

    async proveConfirmedBlockHeightExists(queryWindow: number): Promise<ProvedDH<DHConfirmedBlockHeightExists>> {
        const request = await this.requestConfirmedBlockHeightExistsProof(queryWindow);
        if (request == null) {
            throw new AttestationClientError("confirmedBlockHeightExists: not proved")
        }
        await this.client.waitForRoundFinalization(request.round);
        const { result } = await this.obtainConfirmedBlockHeightExistsProof(request.round, request.data);
        if (result == null || result.merkleProof == null) {
            throw new AttestationClientError("confirmedBlockHeightExists: not proved")
        }
        return result as ProvedDH<DHConfirmedBlockHeightExists>;
    }
}
