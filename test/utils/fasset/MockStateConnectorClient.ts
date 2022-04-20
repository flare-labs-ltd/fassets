import { AttestationClientMockInstance } from "../../../typechain-truffle";
import { BN_ZERO, BYTES32_ZERO, sleep, toBN, toNumber } from "../helpers";
import { MerkleTree } from "../MerkleTree";
import { DHType } from "../verification/generated/attestation-hash-types";
import { dataHash } from "../verification/generated/attestation-hash-utils";
import { parseRequest } from "../verification/generated/attestation-request-parse";
import { ARBalanceDecreasingTransaction, ARConfirmedBlockHeightExists, ARPayment, ARReferencedPaymentNonexistence, ARType } from "../verification/generated/attestation-request-types";
import { AttestationType } from "../verification/generated/attestation-types-enum";
import { SourceId } from "../verification/sources/sources";
import { TxInputOutput } from "./ChainInterfaces";
import { AttestationRequest, AttestationResponse, IStateConnectorClient } from "./IStateConnectorClient";
import { MockAttestationProver } from "./MockAttestationProver";
import { MockChain } from "./MockChain";

function totalValueFor(ios: TxInputOutput[], address: string) {
    let total = BN_ZERO;
    for (const [a, v] of ios) {
        if (a === address) total = total.add(v);
    }
    return total;
}

interface DHProof {
    attestationType: AttestationType;
    sourceId: SourceId;
    data: DHType;
    hash: string;
}

interface FinalizedRound {
    proofs: { [requestData: string]: DHProof };
    tree: MerkleTree;
}

// auto - create new round for every pushed request and finalize immediately - useful for unit tests
// on_wait - during waitForRoundFinalization finalize up to the awaited round - simulates simple (linear) real usage
// manual - user must manually call finalizeRound()
export type AutoFinalizationType = 'auto' | 'on_wait' | 'manual';

export class MockStateConnectorClient implements IStateConnectorClient {
    constructor(
        public attestationClient: AttestationClientMockInstance,
        public supportedChains: { [chainId: number]: MockChain },
        public finalizationType: AutoFinalizationType,
    ) {}
    
    rounds: string[][] = [];
    finalizedRounds: FinalizedRound[] = [];
    
    addChain(id: SourceId, chain: MockChain) {
        this.supportedChains[id] = chain;
    }
    
    async roundFinalized(round: number): Promise<boolean> {
        return this.finalizedRounds.length > round;
    }
    
    async waitForRoundFinalization(round: number): Promise<void> {
        if (round >= this.rounds.length) {
            throw new Error("round doesn't exist yet");
        }
        while (this.finalizedRounds.length <= round) {
            if (this.finalizationType == 'on_wait') {
                await this.finalizeRound();
            } else {
                await sleep(1000);
            }
        }
    }
    
    async submitRequest(data: string): Promise<AttestationRequest> {
        // start new round?
        if (this.finalizedRounds.length >= this.rounds.length) {
            this.rounds.push([]);
        }
        // add request
        const round = this.rounds.length - 1;
        this.rounds[round].push(data);
        // auto finalize?
        if (this.finalizationType === 'auto') {
            await this.finalizeRound();
        }
        return { round, data };
    }
    
    async obtainProof(round: number, requestData: string): Promise<AttestationResponse<DHType>> {
        if (round >= this.finalizedRounds.length) {
            return { finalized: false, result: null };  // not yet finalized
        }
        const proof = this.finalizedRounds[round].proofs[requestData];
        if (proof == null) {
            return { finalized: true, result: null };   // disproved
        }
        return { finalized: true, result: proof.data }; // proved
    }
    
    async finalizeRound() {
        const round = this.finalizedRounds.length;
        // all rounds finalized?
        if (round >= this.rounds.length) return;
        // if this is the last round, start a new one, so that the one we are finalizing doesn't change
        if (round == this.rounds.length - 1) {
            this.rounds.push([]);
        }
        // verify and collect proof data of requests
        const proofs: { [data: string]: DHProof } = {};
        for (const reqData of this.rounds[round]) {
            const proof = this.proveRequest(reqData);
            if (proof != null) {
                proofs[reqData] = proof;
            }
        }
        // build merkle tree
        const hashes = Object.values(proofs).map(proof => proof.hash);
        const tree = new MerkleTree(hashes);
        await this.attestationClient.setMerkleRootForStateConnectorRound(tree.root ?? BYTES32_ZERO, round);
        for (const proof of Object.values(proofs)) {
            proof.data.stateConnectorRound = round;
            proof.data.merkleProof = tree.getProof(hashes.indexOf(proof.hash)) ?? [];
        }
        // add new finalized round
        this.finalizedRounds.push({ proofs, tree });
    }
    
    private proveRequest(requestData: string): DHProof | null {
        const request = parseRequest(requestData);
        const response = this.proveParsedRequest(request);
        if (response == null) return null;
        const hash = dataHash({ attestationType: request.attestationType, sourceId: request.sourceId } as ARType, response);
        return { attestationType: request.attestationType, sourceId: request.sourceId, data: response, hash: hash };
    }
    
    private proveParsedRequest(parsedRequest: ARType): DHType | null {
        const chain = this.supportedChains[parsedRequest.sourceId];
        if (chain == null) throw new Error("unsupported chain");
        const prover = new MockAttestationProver(chain);
        switch (parsedRequest.attestationType) {
            case AttestationType.Payment: {
                const request = parsedRequest as ARPayment;
                return prover.payment(request.id, toNumber(request.inUtxo), toNumber(request.utxo));
            }
            case AttestationType.BalanceDecreasingTransaction: {
                const request = parsedRequest as ARBalanceDecreasingTransaction;
                return prover.balanceDecreasingTransaction(request.id, toNumber(request.inUtxo));
            }
            case AttestationType.ReferencedPaymentNonexistence: {
                const request = parsedRequest as ARReferencedPaymentNonexistence;
                return prover.referencedPaymentNonexistence(request.destinationAddressHash, request.paymentReference,
                    toBN(request.amount), toNumber(request.deadlineBlockNumber), toNumber(request.deadlineTimestamp));
            }
            case AttestationType.ConfirmedBlockHeightExists: {
                const request = parsedRequest as ARConfirmedBlockHeightExists;
                return prover.confirmedBlockHeightExists(request.upperBoundProof);
            }
        }
    }
}
