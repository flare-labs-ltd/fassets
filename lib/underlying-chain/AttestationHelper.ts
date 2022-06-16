import { DHBalanceDecreasingTransaction, DHConfirmedBlockHeightExists, DHPayment, DHReferencedPaymentNonexistence, DHType } from "../verification/generated/attestation-hash-types";
import { encodeBalanceDecreasingTransaction, encodeConfirmedBlockHeightExists, encodePayment, encodeReferencedPaymentNonexistence } from "../verification/generated/attestation-request-encode";
import { ARBalanceDecreasingTransaction, ARConfirmedBlockHeightExists, ARPayment, ARReferencedPaymentNonexistence } from "../verification/generated/attestation-request-types";
import { AttestationType } from "../verification/generated/attestation-types-enum";
import { SourceId } from "../verification/sources/sources";
import { IBlockChain, TxInputOutput } from "./interfaces/IBlockChain";
import { AttestationRequest, AttestationResponse, IStateConnectorClient } from "./interfaces/IStateConnectorClient";

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
    throw new AttestationClientError("unknown address");
}

export class AttestationHelper {
    constructor(
        public client: IStateConnectorClient,
        public chain: IBlockChain,
        public chainId: SourceId,
        public finalizationBlocks: number,
    ) {}
    
    roundFinalized(round: number): Promise<boolean> {
        return this.client.roundFinalized(round);
    }
    
    waitForRoundFinalization(round: number): Promise<void> {
        return this.client.waitForRoundFinalization(round);
    }
    
    async requestPaymentProof(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<AttestationRequest | null> {
        const transaction = await this.chain.getTransaction(transactionHash);
        const block = await this.chain.getTransactionBlock(transactionHash);
        if (transaction == null || block == null) return null;
        const finalizationBlock = await this.chain.getBlockAt(block.number + this.finalizationBlocks);
        if (finalizationBlock == null) return null;
        const request: ARPayment = {
            attestationType: AttestationType.Payment,
            sourceId: this.chainId,
            inUtxo: findAddressIndex(transaction.inputs, sourceAddress, 0),
            utxo: findAddressIndex(transaction.outputs, receivingAddress, 0),
            id: transactionHash,
            upperBoundProof: finalizationBlock.hash,
        };
        const data = encodePayment(request);
        return await this.client.submitRequest(data);
    }

    async requestBalanceDecreasingTransactionProof(transactionHash: string, sourceAddress: string): Promise<AttestationRequest | null> {
        const transaction = await this.chain.getTransaction(transactionHash);
        const block = await this.chain.getTransactionBlock(transactionHash);
        if (transaction == null || block == null) return null;
        const finalizationBlock = await this.chain.getBlockAt(block.number + this.finalizationBlocks);
        if (finalizationBlock == null) return null;
        const request: ARBalanceDecreasingTransaction = {
            attestationType: AttestationType.BalanceDecreasingTransaction,
            sourceId: this.chainId,
            inUtxo: findAddressIndex(transaction.inputs, sourceAddress, 0),
            id: transactionHash,
            upperBoundProof: finalizationBlock.hash,
        };
        const data = encodeBalanceDecreasingTransaction(request);
        return await this.client.submitRequest(data);
    }

    async requestReferencedPaymentNonexistenceProof(destinationAddress: string, paymentReference: string, amount: BN, endBlock: number, endTimestamp: number): Promise<AttestationRequest | null> {
        let overflowBlock = await this.chain.getBlockAt(endBlock + 1);
        while (overflowBlock != null && overflowBlock.timestamp <= endTimestamp) {
            overflowBlock = await this.chain.getBlockAt(overflowBlock.number + 1);
        }
        if (overflowBlock == null) return null;
        const finalizationBlock = await this.chain.getBlockAt(overflowBlock.number + this.finalizationBlocks);
        if (finalizationBlock == null) return null;
        const request: ARReferencedPaymentNonexistence = {
            attestationType: AttestationType.ReferencedPaymentNonexistence,
            sourceId: this.chainId,
            deadlineBlockNumber: endBlock,
            deadlineTimestamp: endTimestamp,
            destinationAddressHash: web3.utils.keccak256(destinationAddress),
            amount: amount,
            paymentReference: paymentReference,
            upperBoundProof: finalizationBlock.hash,
        };
        const data = encodeReferencedPaymentNonexistence(request);
        return await this.client.submitRequest(data);
    }

    async requestConfirmedBlockHeightExistsProof(): Promise<AttestationRequest | null> {
        const blockHeight = await this.chain.getBlockHeight();
        const finalizationBlock = await this.chain.getBlockAt(blockHeight);
        if (finalizationBlock == null) return null;
        const request: ARConfirmedBlockHeightExists = {
            attestationType: AttestationType.ConfirmedBlockHeightExists,
            sourceId: this.chainId,
            upperBoundProof: finalizationBlock.hash,
        };
        const data = encodeConfirmedBlockHeightExists(request);
        return await this.client.submitRequest(data);
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
    
    async tryProvePayment(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<ProvedDH<DHPayment> | null> {
        const request = await this.requestPaymentProof(transactionHash, sourceAddress, receivingAddress);
        if (request == null) return null;
        await this.client.waitForRoundFinalization(request.round);
        const { result } = await this.obtainPaymentProof(request.round, request.data);
        if (result == null || result.merkleProof == null) return null;
        return result as ProvedDH<DHPayment>;
    }

    async tryProveBalanceDecreasingTransaction(transactionHash: string, sourceAddress: string): Promise<ProvedDH<DHBalanceDecreasingTransaction> | null> {
        const request = await this.requestBalanceDecreasingTransactionProof(transactionHash, sourceAddress);
        if (request == null) return null;
        await this.client.waitForRoundFinalization(request.round);
        const { result } = await this.obtainBalanceDecreasingTransactionProof(request.round, request.data);
        if (result == null || result.merkleProof == null) return null;
        return result as ProvedDH<DHBalanceDecreasingTransaction>;
    }

    async tryProveReferencedPaymentNonexistence(destinationAddress: string, paymentReference: string, amount: BN, endBlock: number, endTimestamp: number): Promise<ProvedDH<DHReferencedPaymentNonexistence> | null> {
        const request = await this.requestReferencedPaymentNonexistenceProof(destinationAddress, paymentReference, amount, endBlock, endTimestamp);
        if (request == null) return null;
        await this.client.waitForRoundFinalization(request.round);
        const { result } = await this.obtainReferencedPaymentNonexistenceProof(request.round, request.data);
        if (result == null || result.merkleProof == null) return null;
        return result as ProvedDH<DHReferencedPaymentNonexistence>;
    }

    async tryProveConfirmedBlockHeightExists(): Promise<ProvedDH<DHConfirmedBlockHeightExists> | null> {
        const request = await this.requestConfirmedBlockHeightExistsProof();
        if (request == null) return null;
        await this.client.waitForRoundFinalization(request.round);
        const { result } = await this.obtainConfirmedBlockHeightExistsProof(request.round, request.data);
        if (result == null || result.merkleProof == null) return null;
        return result as ProvedDH<DHConfirmedBlockHeightExists>;
    }
    
    async provePayment(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<ProvedDH<DHPayment>> {
        const proof = await this.tryProvePayment(transactionHash, sourceAddress, receivingAddress);
        if (proof != null) return proof;
        throw new AttestationClientError("provePayment: transaction not found");
    }

    async proveBalanceDecreasingTransaction(transactionHash: string, sourceAddress: string): Promise<ProvedDH<DHBalanceDecreasingTransaction>> {
        const proof = await this.tryProveBalanceDecreasingTransaction(transactionHash, sourceAddress);
        if (proof != null) return proof;
        throw new AttestationClientError("proveBalanceDecreasingTransaction: transaction not found");
    }

    async proveReferencedPaymentNonexistence(destinationAddress: string, paymentReference: string, amount: BN, endBlock: number, endTimestamp: number): Promise<ProvedDH<DHReferencedPaymentNonexistence>> {
        const proof = await this.tryProveReferencedPaymentNonexistence(destinationAddress, paymentReference, amount, endBlock, endTimestamp);
        if (proof != null) return proof;
        throw new AttestationClientError("proveReferencedPaymentNonexistence: cannot prove");
    }

    async proveConfirmedBlockHeightExists(): Promise<ProvedDH<DHConfirmedBlockHeightExists>> {
        const proof = await this.tryProveConfirmedBlockHeightExists();
        if (proof != null) return proof;
        throw new AttestationClientError("proveConfirmedBlockHeightExists: block not found");
    }
}
