import { ARBase, ARESBase } from "state-connector-protocol";

export interface AttestationRequestId {
    round: number;
    data: string;
}

export interface AttestationProof<RESPONSE extends ARESBase> {
    merkleProof: string[];
    data: RESPONSE;
}

// All methods build attestation request, submit it to the state connector and return the encoded request.
// We create one requester per chain, so chainId is baked in.
export interface IStateConnectorClient {
    roundFinalized(round: number): Promise<boolean>;
    waitForRoundFinalization(round: number): Promise<void>;
    submitRequest(request: ARBase): Promise<AttestationRequestId | null>;
    obtainProof(round: number, requestData: string): Promise<AttestationProof<ARESBase> | null>;
}
