import { constants } from "@openzeppelin/test-helpers";
import { AddressValidity, BalanceDecreasingTransaction, ConfirmedBlockHeightExists, Payment, ReferencedPaymentNonexistence } from "@flarenetwork/state-connector-protocol";
import { SourceId } from "./SourceId";
import { IBlockChain, TxInputOutput } from "./interfaces/IBlockChain";
import { AttestationNotProved, AttestationProof, AttestationRequestId, IStateConnectorClient, OptionalAttestationProof } from "./interfaces/IStateConnectorClient";

export class AttestationHelperError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export function attestationProved(result: OptionalAttestationProof): result is AttestationProof {
    return typeof result === 'object' && result != null;
}

function findAddressIndex(ios: TxInputOutput[], address: string | null, defaultValue: number) {
    if (address == null) return defaultValue;
    for (let i = 0; i < ios.length; i++) {
        if (ios[i][0] === address) return i;
    }
    throw new AttestationHelperError(`address ${address} not used in transaction`);
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
            throw new AttestationHelperError(`transaction not found ${transactionHash}`);
        };
        const finalizationBlock = await this.chain.getBlockAt(block.number + this.chain.finalizationBlocks);
        if (finalizationBlock == null) {
            throw new AttestationHelperError(`finalization block not found (block ${block.number}, height ${await this.chain.getBlockHeight()})`);
        }
        const request: Payment.Request = {
            attestationType: Payment.TYPE,
            sourceId: this.chainId,
            messageIntegrityCode: constants.ZERO_BYTES32,
            requestBody: {
                transactionId: transactionHash,
                inUtxo: String(findAddressIndex(transaction.inputs, sourceAddress, 0)),
                utxo: String(findAddressIndex(transaction.outputs, receivingAddress, 0)),
            },
        };
        return await this.client.submitRequest(request);
    }

    async requestBalanceDecreasingTransactionProof(transactionHash: string, sourceAddress: string): Promise<AttestationRequestId | null> {
        const transaction = await this.chain.getTransaction(transactionHash);
        const block = await this.chain.getTransactionBlock(transactionHash);
        if (transaction == null || block == null) {
            throw new AttestationHelperError(`transaction not found ${transactionHash}`);
        };
        const finalizationBlock = await this.chain.getBlockAt(block.number + this.chain.finalizationBlocks);
        if (finalizationBlock == null) {
            throw new AttestationHelperError(`finalization block not found (block ${block.number}, height ${await this.chain.getBlockHeight()})`);
        }
        const request: BalanceDecreasingTransaction.Request = {
            attestationType: BalanceDecreasingTransaction.TYPE,
            sourceId: this.chainId,
            messageIntegrityCode: constants.ZERO_BYTES32,
            requestBody: {
                transactionId: transactionHash,
                sourceAddressIndicator: web3.utils.keccak256(sourceAddress),
            },
        };
        return await this.client.submitRequest(request);
    }

    async requestReferencedPaymentNonexistenceProof(destinationAddress: string, paymentReference: string, amount: BN, startBlock: number, endBlock: number, endTimestamp: number): Promise<AttestationRequestId | null> {
        let overflowBlock = await this.chain.getBlockAt(endBlock + 1);
        while (overflowBlock != null && overflowBlock.timestamp <= endTimestamp) {
            overflowBlock = await this.chain.getBlockAt(overflowBlock.number + 1);
        }
        if (overflowBlock == null) {
            throw new AttestationHelperError(`overflow block not found (overflowBlock ${endBlock + 1}, endTimestamp ${endTimestamp}, height ${await this.chain.getBlockHeight()})`);
        }
        const finalizationBlock = await this.chain.getBlockAt(overflowBlock.number + this.chain.finalizationBlocks);
        if (finalizationBlock == null) {
            throw new AttestationHelperError(`finalization block not found (block ${overflowBlock.number}, height ${await this.chain.getBlockHeight()})`);
        }
        const request: ReferencedPaymentNonexistence.Request = {
            attestationType: ReferencedPaymentNonexistence.TYPE,
            sourceId: this.chainId,
            messageIntegrityCode: constants.ZERO_BYTES32,
            requestBody: {
                minimalBlockNumber: String(startBlock),
                deadlineBlockNumber: String(endBlock),
                deadlineTimestamp: String(endTimestamp),
                destinationAddressHash: web3.utils.keccak256(destinationAddress),
                amount: String(amount),
                standardPaymentReference: paymentReference,
            },
        };
        return await this.client.submitRequest(request);
    }

    async requestConfirmedBlockHeightExistsProof(queryWindow: number): Promise<AttestationRequestId | null> {
        const blockHeight = await this.chain.getBlockHeight();
        const finalizationBlock = await this.chain.getBlockAt(blockHeight);
        if (finalizationBlock == null) {
            throw new AttestationHelperError(`finalization block not found (block ${blockHeight}, height ${await this.chain.getBlockHeight()})`);
        }
        const request: ConfirmedBlockHeightExists.Request = {
            attestationType: ConfirmedBlockHeightExists.TYPE,
            sourceId: this.chainId,
            messageIntegrityCode: constants.ZERO_BYTES32,
            requestBody: {
                blockNumber: String(blockHeight - this.chain.finalizationBlocks),
                queryWindow: String(queryWindow),
            },
        };
        return await this.client.submitRequest(request);
    }

    async requestAddressValidityProof(underlyingAddress: string): Promise<AttestationRequestId | null> {
        const request: AddressValidity.Request = {
            attestationType: AddressValidity.TYPE,
            sourceId: this.chainId,
            messageIntegrityCode: constants.ZERO_BYTES32,
            requestBody: {
                addressStr: underlyingAddress,
            },
        };
        return await this.client.submitRequest(request);
    }

    async obtainPaymentProof(round: number, requestData: string): Promise<Payment.Proof | AttestationNotProved> {
        return await this.client.obtainProof(round, requestData);
    }

    async obtainBalanceDecreasingTransactionProof(round: number, requestData: string): Promise<BalanceDecreasingTransaction.Proof | AttestationNotProved> {
        return await this.client.obtainProof(round, requestData);
    }

    async obtainReferencedPaymentNonexistenceProof(round: number, requestData: string): Promise<ReferencedPaymentNonexistence.Proof | AttestationNotProved> {
        return await this.client.obtainProof(round, requestData);
    }

    async obtainConfirmedBlockHeightExistsProof(round: number, requestData: string): Promise<ConfirmedBlockHeightExists.Proof | AttestationNotProved> {
        return await this.client.obtainProof(round, requestData);
    }

    async obtainAddressValidityProof(round: number, requestData: string): Promise<AddressValidity.Proof | AttestationNotProved> {
        return await this.client.obtainProof(round, requestData);
    }

    async provePayment(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<Payment.Proof> {
        const request = await this.requestPaymentProof(transactionHash, sourceAddress, receivingAddress);
        if (request == null) {
            throw new AttestationHelperError("payment: not proved")
        }
        await this.client.waitForRoundFinalization(request.round);
        const result = await this.client.obtainProof(request.round, request.data);
        if (!attestationProved(result)) {
            throw new AttestationHelperError("payment: not proved")
        }
        return result;
    }

    async proveBalanceDecreasingTransaction(transactionHash: string, sourceAddress: string): Promise<BalanceDecreasingTransaction.Proof> {
        const request = await this.requestBalanceDecreasingTransactionProof(transactionHash, sourceAddress);
        if (request == null) {
            throw new AttestationHelperError("balanceDecreasingTransaction: not proved")
        }
        await this.client.waitForRoundFinalization(request.round);
        const result = await this.client.obtainProof(request.round, request.data);
        if (!attestationProved(result)) {
            throw new AttestationHelperError("balanceDecreasingTransaction: not proved")
        }
        return result;
    }

    async proveReferencedPaymentNonexistence(destinationAddress: string, paymentReference: string, amount: BN, startBlock: number, endBlock: number, endTimestamp: number): Promise<ReferencedPaymentNonexistence.Proof> {
        const request = await this.requestReferencedPaymentNonexistenceProof(destinationAddress, paymentReference, amount, startBlock, endBlock, endTimestamp);
        if (request == null) {
            throw new AttestationHelperError("referencedPaymentNonexistence: not proved")
        }
        await this.client.waitForRoundFinalization(request.round);
        const result = await this.client.obtainProof(request.round, request.data);
        if (!attestationProved(result)) {
            throw new AttestationHelperError("referencedPaymentNonexistence: not proved")
        }
        return result;
    }

    async proveConfirmedBlockHeightExists(queryWindow: number): Promise<ConfirmedBlockHeightExists.Proof> {
        const request = await this.requestConfirmedBlockHeightExistsProof(queryWindow);
        if (request == null) {
            throw new AttestationHelperError("confirmedBlockHeightExists: not proved")
        }
        await this.client.waitForRoundFinalization(request.round);
        const result = await this.client.obtainProof(request.round, request.data);
        if (!attestationProved(result)) {
            throw new AttestationHelperError("confirmedBlockHeightExists: not proved")
        }
        return result;
    }

    async proveAddressValidity(underlyingAddress: string): Promise<AddressValidity.Proof> {
        const request = await this.requestAddressValidityProof(underlyingAddress);
        if (request == null) {
            throw new AttestationHelperError("addressValidity: not proved")
        }
        await this.client.waitForRoundFinalization(request.round);
        const result = await this.client.obtainProof(request.round, request.data);
        if (!attestationProved(result)) {
            throw new AttestationHelperError("addressValidity: not proved")
        }
        return result;
    }
}
