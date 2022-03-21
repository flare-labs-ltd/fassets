import BN from "bn.js";
import { SourceId } from "../sources/sources";

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Verification status
//////////////////////////////////////////////////////////////////////////////////////////////////////

export enum VerificationStatus {
  OK = "OK",
  RECHECK_LATER = "RECHECK_LATER",
  // Temporary status during checks
  NEEDS_MORE_CHECKS = "NEEDS_MORE_CHECKS",
  // Error fields
  NOT_CONFIRMED = "NOT_CONFIRMED",

  FORBIDDEN_SELF_SENDING = "FORBIDDEN_SELF_SENDING",
  NOT_SINGLE_SOURCE_ADDRESS = "NOT_SINGLE_SOURCE_ADDRESS",
  NOT_SINGLE_DESTINATION_ADDRESS = "NOT_SINGLE_DESTINATION_ADDRESS",
  EMPTY_IN_ADDRESS = "EMPTY_IN_ADDRESS",
  EMPTY_OUT_ADDRESS = "EMPTY_OUT_ADDRESS",
  UNSUPPORTED_SOURCE_ADDRESS = "UNSUPPORTED_SOURCE_ADDRESS",
  UNSUPPORTED_DESTINATION_ADDRESS = "UNSUPPORTED_DESTINATION_ADDRESS",

  WRONG_IN_UTXO = "WRONG_IN_UTXO",
  MISSING_IN_UTXO = "MISSING_IN_UTXO",
  WRONG_OUT_UTXO = "WRONG_OUT_UTXO",
  MISSING_OUT_UTXO = "MISSING_OUT_UTXO",

  // Payment reference Errors
  NOT_SINGLE_PAYMENT_REFERENCE = "NOT_SINGLE_PAYMENT_REFERENCE",
  
  // MISSING_SOURCE_ADDRESS_HASH = "MISSING_SOURCE_ADDRESS_HASH",
  // SOURCE_ADDRESS_DOES_NOT_MATCH = "SOURCE_ADDRESS_DOES_NOT_MATCH",
  INSTRUCTIONS_DO_NOT_MATCH = "INSTRUCTIONS_DO_NOT_MATCH",

  WRONG_DATA_AVAILABILITY_PROOF = "WRONG_DATA_AVAILABILITY_PROOF",
  WRONG_DATA_AVAILABILITY_HEIGHT = "WRONG_DATA_AVAILABILITY_HEIGHT",
  DATA_AVAILABILITY_PROOF_REQUIRED = "DATA_AVAILABILITY_PROOF_REQUIRED",

  FORBIDDEN_MULTI_ADDRESS_SOURCE = "FORBIDDEN_MULTI_ADDRESS_SOURCE",
  FORBIDDEN_MULTI_ADDRESS_DESTINATION = "FORBIDDEN_MULTI_ADDRESS_DESTINATION",
  
  FUNDS_UNCHANGED = "FUNDS_UNCHANGED",
  FUNDS_INCREASED = "FUNDS_INCREASED",
  // COINBASE_TRANSACTION = "COINBASE_TRANSACTION",
  UNSUPPORTED_TX_TYPE = "UNSUPPORTED_TX_TYPE",
  NON_EXISTENT_TRANSACTION = "NON_EXISTENT_TRANSACTION",
  NON_EXISTENT_BLOCK = "NON_EXISTENT_BLOCK",
  NON_EXISTENT_OVERFLOW_BLOCK = "NON_EXISTENT_OVERFLOW_BLOCK",
  BLOCK_HASH_DOES_NOT_EXIST = "BLOCK_DOES_NOT_EXIST",
  NOT_PAYMENT = "NOT_PAYMENT",
  WRONG_OVERFLOW_BLOCK_ENDTIMESTAMP = "WRONG_OVERFLOW_BLOCK_ENDTIMESTAMP",
  WRONG_OVERFLOW_BLOCK_ENDTIME = "WRONG_OVERFLOW_BLOCK_ENDTIME",
  REFERENCED_TRANSACTION_EXISTS = "REFERENCED_TRANSACTION_EXISTS",

  NON_EXISTENT_INPUT_UTXO_ADDRESS = "NON_EXISTENT_INPUT_UTXO_ADDRESS",
  NON_EXISTENT_OUTPUT_UTXO_ADDRESS = "NON_EXISTENT_OUTPUT_UTXO_ADDRESS",


}
export interface Verification<R, T> {
  hash?: string;
  request?: R;
  response?: T;
  rawResponse?: any;
  status: VerificationStatus;
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
export const BLOCKNUMBER_BYTES = 4;
export const TIMESTAMP_BYTES = 4;
export const AMOUNT_BYTES = 16;
export const TX_ID_BYTES = 32;
export const DATA_AVAILABILITY_BYTES = 32;
export const SOURCE_ADDRESS_KEY_BYTES = 32;
export const SOURCE_ADDRESS_CHEKSUM_BYTES = 4;
export const PAYMENT_REFERENCE_BYTES = 32;

export type NumberLike = number | BN | string;
export type ByteSequenceLike = string;

export type SupportedSolidityType = "uint8" | "uint16" | "uint32" | "uint64" | "uint128" | "uint256" | "int256" | "bytes4" | "bytes32" | "bool" | "string";
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
}
export interface AttestationTypeScheme {
  id: number;
  supportedSources: SourceId[];
  name: string;
  request: AttestationRequestScheme[];
  dataHashDefinition: DataHashScheme[];
}



////////// DEPRECATED

// export interface AttestationRequest {
//   timestamp?: BN;
//   instructions: BN;
//   id: string;
//   dataAvailabilityProof: string;
//   // optional fields to which the result gets parsed
//   attestationType?: AttestationType;
//   chainId?: BN | number;
// }
// export interface VerificationResult extends AttestationRequest {
//   verificationStatus: VerificationStatus;
// }

// export interface AdditionalTransactionDetails {
  
// }

// export interface ChainVerification extends AdditionalTransactionDetails , VerificationResult {
//   isFromOne?: boolean;
//   utxo?: BN;
// }

// export interface DataAvailabilityProof {
//   hash?: string;
//   blockNumber?: number;
// }

// export interface TransactionAttestationRequest extends AttestationRequest {
//   blockNumber: BN | number;
//   utxo?: BN | number;
// }

// export interface VerifiedAttestation {
//   chainType: ChainType;
//   attestType: AttestationType;
//   txResponse?: any;
//   blockResponse?: any;
//   sender?: string;
//   utxo?: number;
//   fee?: BN;
//   spent?: BN;
//   delivered?: BN;
// }

// export interface AttestationTypeEncoding {
//   sizes: number[];
//   keys: string[];
//   hashTypes: string[];
//   hashKeys: string[];
// }

// export interface VerificationTestOptions {
//   testFailProbability?: number;
//   skipDataAvailabilityProof?: boolean;
// }
