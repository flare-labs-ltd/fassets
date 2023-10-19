import { constants } from "@openzeppelin/test-helpers";
import { ARBase, ARESBase, AttestationDefinitionStore, BalanceDecreasingTransaction, ConfirmedBlockHeightExists, MIC_SALT, MerkleTree, Payment, ReferencedPaymentNonexistence, decodeAttestationName } from "state-connector-protocol";
import { SourceId } from "../../../lib/underlying-chain/SourceId";
import { AttestationProof, AttestationRequestId, IStateConnectorClient } from "../../../lib/underlying-chain/interfaces/IStateConnectorClient";
import { findRequiredEvent } from "../../../lib/utils/events/truffle";
import { filterStackTrace, sleep, toBN, toNumber } from "../../../lib/utils/helpers";
import { stringifyJson } from "../../../lib/utils/json-bn";
import { ILogger } from "../../../lib/utils/logging";
import { StateConnectorMockInstance } from "../../../typechain-truffle";
import { AttestationRequest } from "../../../typechain-truffle/IStateConnector";
import { MockAttestationProver, MockAttestationProverError } from "./MockAttestationProver";
import { MockChain } from "./MockChain";

interface DHProof {
    response: ARESBase;
    hash: string;
}

interface FinalizedRound {
    proofs: { [requestData: string]: DHProof };
    tree: MerkleTree;
}

export class StateConnectorClientError extends Error {
    constructor(message: string) {
        super(message);
    }
}

// auto - create new round for every pushed request and finalize immediately - useful for unit tests
// on_wait - during waitForRoundFinalization finalize up to the awaited round - simulates simple (linear) real usage
// timed - finalize rounds based on time, like in real case
// manual - user must manually call finalizeRound()
export type AutoFinalizationType = 'auto' | 'on_wait' | 'timed' | 'manual';

export class MockStateConnectorClient implements IStateConnectorClient {
    static deepCopyWithObjectCreate = true;

    constructor(
        public stateConnector: StateConnectorMockInstance,
        public supportedChains: { [chainId: string]: MockChain },
        public finalizationType: AutoFinalizationType,
    ) {
    }

    rounds: string[][] = [];
    finalizedRounds: FinalizedRound[] = [];
    logger?: ILogger;
    queryWindowSeconds = 86400;
    definitionStore = new AttestationDefinitionStore();

    setTimedFinalization(timedRoundSeconds: number) {
        this.finalizationType = 'timed';
        setInterval(() => this.finalizeRound(), timedRoundSeconds * 1000);
    }

    addChain(id: SourceId, chain: MockChain) {
        this.supportedChains[id] = chain;
    }

    async roundFinalized(round: number): Promise<boolean> {
        return this.finalizedRounds.length > round;
    }

    async waitForRoundFinalization(round: number): Promise<void> {
        if (round >= this.rounds.length) {
            throw new StateConnectorClientError(`StateConnectorClient: round doesn't exist yet (${round} >= ${this.rounds.length})`);
        }
        while (this.finalizedRounds.length <= round) {
            if (this.finalizationType == 'on_wait') {
                await this.finalizeRound();
            } else {
                await sleep(1000);
            }
        }
    }

    async submitRequest(request: ARBase): Promise<AttestationRequestId | null> {
        // add message integrity code to request data - for this, we have to obtain the response before submitting request
        const responseData = this.proveParsedRequest(request);
        if (responseData == null) return null;  // cannot prove request (yet)
        const mic = this.definitionStore.attestationResponseHash(responseData, MIC_SALT);
        if (mic == null) {
            throw new StateConnectorClientError(`StateConnectorClient: invalid attestation data`);
        }
        const data = this.definitionStore.encodeRequest({ ...request, messageIntegrityCode: mic });
        // submit request and mock listening to event
        const res = await this.stateConnector.requestAttestations(data);
        const event = findRequiredEvent(res, 'AttestationRequest');
        return await this.handleAttestationRequest(event);
    }

    async handleAttestationRequest(event: Truffle.TransactionLog<AttestationRequest>) {
        const data = event.args.data;
        // start new round?
        if (this.finalizedRounds.length >= this.rounds.length) {
            this.rounds.push([]);
        }
        // add request
        const round = this.rounds.length - 1;
        this.rounds[round].push(data);
        this.logger?.log(`STATE CONNECTOR SUBMIT round=${round} data=${data}`);
        // auto finalize?
        if (this.finalizationType === 'auto') {
            await this.finalizeRound();
        }
        return { round, data };
    }

    async obtainProof(round: number, requestData: string): Promise<AttestationProof<ARESBase> | null> {
        if (round >= this.finalizedRounds.length) return null;  // not yet finalized
        const finalizedRound = this.finalizedRounds[round];
        const proof = finalizedRound.proofs[requestData];
        if (proof == null) return null;   // disproved
        const merkleProof = finalizedRound.tree.getProof(proof.hash) ?? [];
        return { merkleProof, data: proof.response }; // proved
    }

    finalizing = false;

    async finalizeRound() {
        while (this.finalizing) await sleep(100);
        this.finalizing = true;
        try {
            await this._finalizeRound();
        } finally {
            this.finalizing = false;
        }
    }

    private async _finalizeRound() {
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
            const proof = this.proveRequest(reqData, round);
            if (proof != null) {
                proofs[reqData] = proof;
            }
        }
        // build merkle tree
        const hashes = Object.values(proofs).map(proof => proof.hash);
        const tree = new MerkleTree(hashes);
        await this.stateConnector.setMerkleRoot(round, tree.root ?? constants.ZERO_BYTES32);
        // add new finalized round
        this.finalizedRounds.push({ proofs, tree });
        // log
        if (this.logger) {
            this.logger.log(`STATE CONNECTOR ROUND ${round} FINALIZED`);
            for (const [data, proof] of Object.entries(proofs)) {
                this.logger.log(`    ${data}  ${stringifyJson(proof)}`);
            }
        }
    }

    private proveRequest(requestData: string, stateConnectorRound: number): DHProof | null {
        const request = this.definitionStore.parseRequest<ARBase>(requestData);
        const response = this.proveParsedRequest(request);
        if (response == null) return null;
        // verify MIC (message integrity code) - stateConnectorRound field must be 0
        const mic = this.definitionStore.attestationResponseHash(response, MIC_SALT);
        if (mic == null || mic !== request.messageIntegrityCode) {
            throw new StateConnectorClientError(`StateConnectorClient: invalid message integrity code`);
        }
        // now set correct voting round
        response.votingRound = String(stateConnectorRound);
        // calculate hash for Merkle tree - requires correct stateConnectorRound field
        const hash = this.definitionStore.attestationResponseHash(response);
        if (hash == null) {
            throw new StateConnectorClientError(`StateConnectorClient: invalid attestation reponse`);
        }
        return { response, hash };
    }

    private proveParsedRequest(parsedRequest: ARBase): ARESBase | null {
        try {
            const chain = this.supportedChains[parsedRequest.sourceId];
            if (chain == null) throw new StateConnectorClientError(`StateConnectorClient: unsupported chain ${parsedRequest.sourceId}`);
            const responseBody = this.proveParsedRequestBody(chain, parsedRequest);
            return {
                attestationType: parsedRequest.attestationType,
                sourceId: parsedRequest.sourceId,
                votingRound: '0',                   // must be 0 for hash, later set to correct value
                lowestUsedTimestamp: String(0),     // no window limit in mock
                requestBody: parsedRequest.requestBody,
                responseBody: responseBody,
            };
        } catch (e) {
            if (e instanceof MockAttestationProverError) {
                const stack = filterStackTrace(e);
                console.error(stack);
                this.logger?.log("!!! " + stack);
                return null;
            }
            throw e;    // other errors not allowed
        }
    }

    private proveParsedRequestBody(chain: MockChain, parsedRequest: ARBase) {
        const prover = new MockAttestationProver(chain, this.queryWindowSeconds);
        switch (parsedRequest.attestationType) {
            case Payment.TYPE: {
                const request = parsedRequest.requestBody as Payment.RequestBody;
                return prover.payment(request.transactionId, toNumber(request.inUtxo), toNumber(request.utxo));
            }
            case BalanceDecreasingTransaction.TYPE: {
                const request = parsedRequest.requestBody as BalanceDecreasingTransaction.RequestBody;
                return prover.balanceDecreasingTransaction(request.transactionId, request.sourceAddressIndicator);
            }
            case ReferencedPaymentNonexistence.TYPE: {
                const request = parsedRequest.requestBody as ReferencedPaymentNonexistence.RequestBody;
                return prover.referencedPaymentNonexistence(request.destinationAddressHash, request.standardPaymentReference, toBN(request.amount),
                    toNumber(request.minimalBlockNumber), toNumber(request.deadlineBlockNumber), toNumber(request.deadlineTimestamp));
            }
            case ConfirmedBlockHeightExists.TYPE: {
                const request = parsedRequest.requestBody as ConfirmedBlockHeightExists.RequestBody;
                return prover.confirmedBlockHeightExists(toNumber(request.blockNumber), toNumber(request.queryWindow));
            }
            default: {
                throw new StateConnectorClientError(`StateConnectorClient: unsupported attestation request ${decodeAttestationName(parsedRequest.attestationType)} (${parsedRequest.attestationType})`);
            }
        }
    }
}
