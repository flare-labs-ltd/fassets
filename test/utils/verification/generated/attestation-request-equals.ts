//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

import Web3 from "web3";  
import { 
   ARPayment,
   ARBalanceDecreasingTransaction,
   ARConfirmedBlockHeightExists,
   ARReferencedPaymentNonexistence,
   ARType 
} from "./attestation-request-types";
import { AttestationType } from "./attestation-types-enum";

const toBN = Web3.utils.toBN;
//////////////////////////////////////////////////////////////
// Functions for encoding attestation requests to byte strings
//////////////////////////////////////////////////////////////

export class AttestationRequestEqualsError extends Error {
   constructor(message: any) {
      super(message);
      this.name = 'AttestationRequestEqualsError';
   }
}

export function assertEqualsByScheme(a: any, b: any, type: string) {
   switch (type) {
      case "AttestationType":
         return a === b;
      case "NumberLike":
         return toBN(a).eq(toBN(b));
      case "SourceId":
         return a === b;
      case "ByteSequenceLike":
         return a === b;
      default:
         throw new AttestationRequestEqualsError("Wrong type")      
   }
}

export function equalsPayment(request1: ARPayment, request2: ARPayment) {
   if(!assertEqualsByScheme(request1.attestationType, request2.attestationType, "AttestationType")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.sourceId, request2.sourceId, "SourceId")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.blockNumber, request2.blockNumber, "NumberLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.utxo, request2.utxo, "NumberLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.inUtxo, request2.inUtxo, "NumberLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.id, request2.id, "ByteSequenceLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.dataAvailabilityProof, request2.dataAvailabilityProof, "ByteSequenceLike")) {
      return false;
   }
   return true;
}

export function equalsBalanceDecreasingTransaction(request1: ARBalanceDecreasingTransaction, request2: ARBalanceDecreasingTransaction) {
   if(!assertEqualsByScheme(request1.attestationType, request2.attestationType, "AttestationType")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.sourceId, request2.sourceId, "SourceId")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.blockNumber, request2.blockNumber, "NumberLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.inUtxo, request2.inUtxo, "NumberLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.id, request2.id, "ByteSequenceLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.dataAvailabilityProof, request2.dataAvailabilityProof, "ByteSequenceLike")) {
      return false;
   }
   return true;
}

export function equalsConfirmedBlockHeightExists(request1: ARConfirmedBlockHeightExists, request2: ARConfirmedBlockHeightExists) {
   if(!assertEqualsByScheme(request1.attestationType, request2.attestationType, "AttestationType")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.sourceId, request2.sourceId, "SourceId")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.blockNumber, request2.blockNumber, "NumberLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.dataAvailabilityProof, request2.dataAvailabilityProof, "ByteSequenceLike")) {
      return false;
   }
   return true;
}

export function equalsReferencedPaymentNonexistence(request1: ARReferencedPaymentNonexistence, request2: ARReferencedPaymentNonexistence) {
   if(!assertEqualsByScheme(request1.attestationType, request2.attestationType, "AttestationType")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.sourceId, request2.sourceId, "SourceId")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.endTimestamp, request2.endTimestamp, "NumberLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.endBlock, request2.endBlock, "NumberLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.destinationAddress, request2.destinationAddress, "ByteSequenceLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.amount, request2.amount, "NumberLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.paymentReference, request2.paymentReference, "ByteSequenceLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.overflowBlock, request2.overflowBlock, "NumberLike")) {
      return false;
   }
   if(!assertEqualsByScheme(request1.dataAvailabilityProof, request2.dataAvailabilityProof, "ByteSequenceLike")) {
      return false;
   }
   return true;
}

export function equalsRequest(request1: ARType, request2: ARType): boolean  {  
   if(request1.attestationType != request2.attestationType) {
      return false;
   }
   switch(request1.attestationType) {
      case AttestationType.Payment:
         return equalsPayment(request1 as ARPayment, request2 as ARPayment);
      case AttestationType.BalanceDecreasingTransaction:
         return equalsBalanceDecreasingTransaction(request1 as ARBalanceDecreasingTransaction, request2 as ARBalanceDecreasingTransaction);
      case AttestationType.ConfirmedBlockHeightExists:
         return equalsConfirmedBlockHeightExists(request1 as ARConfirmedBlockHeightExists, request2 as ARConfirmedBlockHeightExists);
      case AttestationType.ReferencedPaymentNonexistence:
         return equalsReferencedPaymentNonexistence(request1 as ARReferencedPaymentNonexistence, request2 as ARReferencedPaymentNonexistence);
      default:
         throw new AttestationRequestEqualsError("Invalid attestation type");
   }
}
