import { encodeAttestationName } from "state-connector-protocol";

export type SourceId = string;

export namespace SourceId {
    export const XRP = encodeAttestationName("XRP");
    export const BTC = encodeAttestationName("BTC");
    export const LTC = encodeAttestationName("LTC");
    export const DOGE = encodeAttestationName("DOGE");
    export const ALGO = encodeAttestationName("ALGO");
}
