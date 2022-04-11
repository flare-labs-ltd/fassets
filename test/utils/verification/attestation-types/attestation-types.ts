import BN from "bn.js";
import { SourceId } from "../sources/sources";

//////////////////////////////////////////////////////////////////////////////////////////////////////
// Verification status
//////////////////////////////////////////////////////////////////////////////////////////////////////

export enum VerificationStatus {
  // Successful verification
  OK = "OK",

  // Needs recheck
  RECHECK_LATER = "RECHECK_LATER",
  
  // Temporary status during checks
  NEEDS_MORE_CHECKS = "NEEDS_MORE_CHECKS",
  
  // Source failure - source data is not up to date and does not allow consistent queries
  SYSTEM_FAILURE = "SYSTEM_FAILURE",
  
  // Error fields
  NOT_CONFIRMED = "NOT_CONFIRMED",
  
  WRONG_DATA_AVAILABILITY_PROOF = "WRONG_DATA_AVAILABILITY_PROOF",

  NON_EXISTENT_TRANSACTION = "NON_EXISTENT_TRANSACTION",
  NON_EXISTENT_BLOCK = "NON_EXISTENT_BLOCK",
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
