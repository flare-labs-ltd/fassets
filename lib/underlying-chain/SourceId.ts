import { encodeAttestationName } from "@flarenetwork/state-connector-protocol";

export type SourceId = string;

export namespace SourceId {
    export const XRP = encodeAttestationName("XRP");
    export const testXRP = encodeAttestationName("testXRP");
    export const BTC = encodeAttestationName("BTC");
    export const testBTC = encodeAttestationName("testBTC");
    export const DOGE = encodeAttestationName("DOGE");
    export const testDOGE = encodeAttestationName("testDOGE");
    export const LTC = encodeAttestationName("LTC");
    export const ALGO = encodeAttestationName("ALGO");
}
