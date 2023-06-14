import BN from "bn.js";
import { SourceId } from "../sources/sources";

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Verification status
//////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Enumerated verification status of attestation
 */
export enum VerificationStatus {
  ///////////////////////////
  // VALID STATUS
  ///////////////////////////

  OK = "OK",

  ///////////////////////////
  // INDETERMINATE STATUSES
  ///////////////////////////

  DATA_AVAILABILITY_ISSUE = "DATA_AVAILABILITY_ISSUE",
  // Temporary status during checks
  NEEDS_MORE_CHECKS = "NEEDS_MORE_CHECKS",
  // Source failure - error in checking
  SYSTEM_FAILURE = "SYSTEM_FAILURE",

  NON_EXISTENT_BLOCK = "NON_EXISTENT_BLOCK",

  ///////////////////////////
  // ERROR STATUSES
  ///////////////////////////

  // generic invalid response
  NOT_CONFIRMED = "NOT_CONFIRMED",

  NON_EXISTENT_TRANSACTION = "NON_EXISTENT_TRANSACTION",

  NOT_PAYMENT = "NOT_PAYMENT",

  REFERENCED_TRANSACTION_EXISTS = "REFERENCED_TRANSACTION_EXISTS",
  ZERO_PAYMENT_REFERENCE_UNSUPPORTED = "ZERO_PAYMENT_REFERENCE_UNSUPPORTED",
  NOT_STANDARD_PAYMENT_REFERENCE = "NOT_STANDARD_PAYMENT_REFERENCE",
  PAYMENT_SUMMARY_ERROR = "PAYMENT_SUMMARY_ERROR",
}

/**
 * Summarized verification status into three options.
 */
export enum SummarizedVerificationStatus {
  valid,
  invalid,
  indeterminate,
}

/**
 * Given a VerificationStatus status it returns the corresponding SummarizedValidationStatus
 * @param status
 * @returns
 */
export function getSummarizedVerificationStatus(status: VerificationStatus): SummarizedVerificationStatus {
  switch (status) {
    case VerificationStatus.OK:
      return SummarizedVerificationStatus.valid;
    case VerificationStatus.DATA_AVAILABILITY_ISSUE:
    case VerificationStatus.NEEDS_MORE_CHECKS:
    case VerificationStatus.SYSTEM_FAILURE:
    case VerificationStatus.NON_EXISTENT_BLOCK:
      return SummarizedVerificationStatus.indeterminate;
    case VerificationStatus.NOT_CONFIRMED:
    case VerificationStatus.NON_EXISTENT_TRANSACTION:
    case VerificationStatus.NOT_PAYMENT:
    case VerificationStatus.REFERENCED_TRANSACTION_EXISTS:
    case VerificationStatus.ZERO_PAYMENT_REFERENCE_UNSUPPORTED:
    case VerificationStatus.NOT_STANDARD_PAYMENT_REFERENCE:
    case VerificationStatus.PAYMENT_SUMMARY_ERROR:
      return SummarizedVerificationStatus.invalid;
  }
  // exhaustive switch guard: if a compile time error appears here, you have forgotten one of the cases
  ((_: never): void => { })(status);
}

/**
 * DTO Object returned after attestation request verification.
 * If status is 'OK' then parameters @param hash, @param request and @param response appear
 * in the full response.
 */
export class Verification<R, T> {
  /**
   * Hash of the attestation as included in Merkle tree.
   */
  hash?: string;
  /**
   * Parsed attestation request.
   */
  request?: R;
  /**
   * Attestation response.
   */
  response?: T;
  /**
   * Verification status.
   */
  status!: VerificationStatus;
}

export interface WeightedRandomChoice<T> {
  name: T;
  weight: number;
}
//////////////////////////////////////////////////////////////////////////////////////////////////////
// Encoding schemes
//////////////////////////////////////////////////////////////////////////////////////////////////////

export const ATT_BYTES = 2;
export const SOURCE_ID_BYTES = 4;
export const UTXO_BYTES = 1;
export const IN_UTXO_BYTES = 32;
export const BLOCKNUMBER_BYTES = 4;
export const TIMESTAMP_BYTES = 4;
export const TIME_DURATION_BYTES = 4;
export const AMOUNT_BYTES = 16;
export const TX_ID_BYTES = 32;
export const MIC_BYTES = 32;
export const SOURCE_ADDRESS_KEY_BYTES = 32;
export const SOURCE_ADDRESS_CHEKSUM_BYTES = 4;
export const PAYMENT_REFERENCE_BYTES = 32;
export const XRP_ACCOUNT_BYTES = 20;

export type NumberLike = number | BN | string;
export type ByteSequenceLike = string;

export type SupportedSolidityType =
  | "uint8"
  | "uint16"
  | "uint32"
  | "uint64"
  | "uint128"
  | "uint256"
  | "int256"
  | "bytes4"
  | "bytes32"
  | "bytes20"
  | "bool"
  | "string";
export type SupportedRequestType = "ByteSequenceLike" | "NumberLike" | "AttestationType" | "SourceId";
export interface AttestationRequestScheme {
  key: string;
  size: number;
  type: SupportedRequestType;
  description?: string;
}

export interface DataHashScheme {
  key: string;
  type: SupportedSolidityType;
  description: string;
  tsType?: string;
}
export interface AttestationTypeScheme {
  id: number;
  supportedSources: SourceId[];
  name: string;
  request: AttestationRequestScheme[];
  dataHashDefinition: DataHashScheme[];
}
export class AttestationRequest {
  /**
   * Attestation request in hex string representing byte sequence as submitted to State Connector smart contract.
   */
  request!: string;
}

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Message integrity code
//////////////////////////////////////////////////////////////////////////////////////////////////////
export const MIC_SALT = "Flare";

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Request base
//////////////////////////////////////////////////////////////////////////////////////////////////////
export const REQUEST_BASE_DEFINITIONS: AttestationRequestScheme[] = [
  {
    key: "attestationType",
    size: ATT_BYTES,
    type: "AttestationType",
    description: `
Attestation type id for this request, see 'AttestationType' enum.
`,
  },
  {
    key: "sourceId",
    size: SOURCE_ID_BYTES,
    type: "SourceId",
    description: `
The ID of the underlying chain, see 'SourceId' enum.
`,
  },
  {
    key: "messageIntegrityCode",
    size: MIC_BYTES,
    type: "ByteSequenceLike",
    description: `
The hash of the expected attestation response appended by string 'Flare'. Used to verify consistency of the attestation response against the anticipated result, thus preventing wrong (forms of) attestations.
`,
  },
];

export const RESPONSE_BASE_DEFINITIONS: DataHashScheme[] = [
  {
    key: "stateConnectorRound",
    type: "uint256",
    tsType: "number",
    description: `
Round id in which the attestation request was validated.
`,
  },
];
