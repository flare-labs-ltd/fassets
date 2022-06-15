//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

import Web3 from "web3";
import BN from "bn.js";
import { 
   ARPayment,
   ARBalanceDecreasingTransaction,
   ARConfirmedBlockHeightExists,
   ARReferencedPaymentNonexistence,
   ARTrustlineIssuance,
   ARType 
} from "./attestation-request-types";
import { AttestationType } from "./attestation-types-enum";
import { SourceId } from "../sources/sources";

const toBN = Web3.utils.toBN;
const web3 = new Web3();
//////////////////////////////////////////////////////////////
// Functions for parsing attestation requests from byte strings
//////////////////////////////////////////////////////////////

export class AttestationRequestParseError extends Error {
   constructor(message: any) {
      super(message);
      this.name = 'AttestationRequestParseError';
   }
}

export function unPrefix0x(tx: string) {
   return tx.startsWith("0x") ? tx.slice(2) : tx;
}

export function prefix0x(tx: string) {
   return tx.startsWith("0x") ? tx : "0x" + tx;
}

export function toHex(x: string | number | BN, padToBytes?: number) {
   if (padToBytes as any > 0) {
      return Web3.utils.leftPad(Web3.utils.toHex(x), padToBytes! * 2);
   }
   return Web3.utils.toHex(x);
}

function fromUnprefixedBytes(bytes: string, type: string, size: number) {
   switch (type) {
      case "AttestationType":
         return toBN(prefix0x(bytes)).toNumber() as AttestationType;
      case "NumberLike":
         return toBN(prefix0x(bytes));
      case "SourceId":
         return toBN(prefix0x(bytes)).toNumber() as SourceId;
      case "ByteSequenceLike":
         return toHex(prefix0x(bytes), size);
      default:
         throw new AttestationRequestParseError("Unsuported attestation request");
   }
}

export function getAttestationTypeAndSource(bytes: string) {
   try {
      let input = unPrefix0x(bytes);
      if (!bytes || bytes.length < 12) {
         throw new AttestationRequestParseError("Cannot read attestation type and source id")
      }
      return {
         attestationType: toBN(prefix0x(input.slice(0, 4))).toNumber() as AttestationType,
         sourceId: toBN(prefix0x(input.slice(4, 12))).toNumber() as SourceId
      }
   } catch(e) {
      throw new AttestationRequestParseError(e)
   }
}
  

export function parsePayment(bytes: string): ARPayment {
   if(!bytes) {
      throw new AttestationRequestParseError("Empty attestation request")
   }
   let input = unPrefix0x(bytes);  
   if(input.length != 144) {
      throw new AttestationRequestParseError("Incorrectly formatted attestation request")
   }
  
   return {
      attestationType: fromUnprefixedBytes(input.slice(0, 4), "AttestationType", 2) as AttestationType,
      sourceId: fromUnprefixedBytes(input.slice(4, 12), "SourceId", 4) as SourceId,
      upperBoundProof: fromUnprefixedBytes(input.slice(12, 76), "ByteSequenceLike", 32) as string,
      id: fromUnprefixedBytes(input.slice(76, 140), "ByteSequenceLike", 32) as string,
      inUtxo: fromUnprefixedBytes(input.slice(140, 142), "NumberLike", 1) as BN,
      utxo: fromUnprefixedBytes(input.slice(142, 144), "NumberLike", 1) as BN
   }
}

export function parseBalanceDecreasingTransaction(bytes: string): ARBalanceDecreasingTransaction {
   if(!bytes) {
      throw new AttestationRequestParseError("Empty attestation request")
   }
   let input = unPrefix0x(bytes);  
   if(input.length != 142) {
      throw new AttestationRequestParseError("Incorrectly formatted attestation request")
   }
  
   return {
      attestationType: fromUnprefixedBytes(input.slice(0, 4), "AttestationType", 2) as AttestationType,
      sourceId: fromUnprefixedBytes(input.slice(4, 12), "SourceId", 4) as SourceId,
      upperBoundProof: fromUnprefixedBytes(input.slice(12, 76), "ByteSequenceLike", 32) as string,
      id: fromUnprefixedBytes(input.slice(76, 140), "ByteSequenceLike", 32) as string,
      inUtxo: fromUnprefixedBytes(input.slice(140, 142), "NumberLike", 1) as BN
   }
}

export function parseConfirmedBlockHeightExists(bytes: string): ARConfirmedBlockHeightExists {
   if(!bytes) {
      throw new AttestationRequestParseError("Empty attestation request")
   }
   let input = unPrefix0x(bytes);  
   if(input.length != 76) {
      throw new AttestationRequestParseError("Incorrectly formatted attestation request")
   }
  
   return {
      attestationType: fromUnprefixedBytes(input.slice(0, 4), "AttestationType", 2) as AttestationType,
      sourceId: fromUnprefixedBytes(input.slice(4, 12), "SourceId", 4) as SourceId,
      upperBoundProof: fromUnprefixedBytes(input.slice(12, 76), "ByteSequenceLike", 32) as string
   }
}

export function parseReferencedPaymentNonexistence(bytes: string): ARReferencedPaymentNonexistence {
   if(!bytes) {
      throw new AttestationRequestParseError("Empty attestation request")
   }
   let input = unPrefix0x(bytes);  
   if(input.length != 252) {
      throw new AttestationRequestParseError("Incorrectly formatted attestation request")
   }
  
   return {
      attestationType: fromUnprefixedBytes(input.slice(0, 4), "AttestationType", 2) as AttestationType,
      sourceId: fromUnprefixedBytes(input.slice(4, 12), "SourceId", 4) as SourceId,
      upperBoundProof: fromUnprefixedBytes(input.slice(12, 76), "ByteSequenceLike", 32) as string,
      deadlineBlockNumber: fromUnprefixedBytes(input.slice(76, 84), "NumberLike", 4) as BN,
      deadlineTimestamp: fromUnprefixedBytes(input.slice(84, 92), "NumberLike", 4) as BN,
      destinationAddressHash: fromUnprefixedBytes(input.slice(92, 156), "ByteSequenceLike", 32) as string,
      amount: fromUnprefixedBytes(input.slice(156, 188), "NumberLike", 16) as BN,
      paymentReference: fromUnprefixedBytes(input.slice(188, 252), "ByteSequenceLike", 32) as string
   }
}

export function parseTrustlineIssuance(bytes: string): ARTrustlineIssuance {
   if(!bytes) {
      throw new AttestationRequestParseError("Empty attestation request")
   }
   let input = unPrefix0x(bytes);  
   if(input.length != 116) {
      throw new AttestationRequestParseError("Incorrectly formatted attestation request")
   }
  
   return {
      attestationType: fromUnprefixedBytes(input.slice(0, 4), "AttestationType", 2) as AttestationType,
      sourceId: fromUnprefixedBytes(input.slice(4, 12), "SourceId", 4) as SourceId,
      upperBoundProof: fromUnprefixedBytes(input.slice(12, 76), "ByteSequenceLike", 32) as string,
      issuerAccount: fromUnprefixedBytes(input.slice(76, 116), "ByteSequenceLike", 20) as string
   }
}

export function parseRequest(bytes: string): ARType {  
   let { attestationType } = getAttestationTypeAndSource(bytes);
   switch(attestationType) {
      case AttestationType.Payment:
         return parsePayment(bytes);
      case AttestationType.BalanceDecreasingTransaction:
         return parseBalanceDecreasingTransaction(bytes);
      case AttestationType.ConfirmedBlockHeightExists:
         return parseConfirmedBlockHeightExists(bytes);
      case AttestationType.ReferencedPaymentNonexistence:
         return parseReferencedPaymentNonexistence(bytes);
      case AttestationType.TrustlineIssuance:
         return parseTrustlineIssuance(bytes);
      default:
         throw new AttestationRequestParseError("Invalid attestation type");
   }
}
