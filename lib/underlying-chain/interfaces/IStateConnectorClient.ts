import { DHType } from "../../verification/generated/attestation-hash-types";
import { ARBase } from "../../verification/generated/attestation-request-types";

export interface AttestationRequestId {
    round: number;
    data: string;
}

export interface AttestationResponse<T extends DHType> {
    finalized: boolean;
    result: T | null;
}

// All methods build attestation request, submit it to the state connector and return the encoded request.
// We create one requester per chain, so chainId is baked in.
export interface IStateConnectorClient {
    roundFinalized(round: number): Promise<boolean>;
    waitForRoundFinalization(round: number): Promise<void>;
    submitRequest(request: ARBase): Promise<AttestationRequestId | null>;
    obtainProof(round: number, requestData: string): Promise<AttestationResponse<DHType>>;
}
