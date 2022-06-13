//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

import { 
   ARPayment,
   ARBalanceDecreasingTransaction,
   ARConfirmedBlockHeightExists,
   ARReferencedPaymentNonexistence,
   ARTrustlineIssuance,
   ARType 
} from "./attestation-request-types";
import { toHex, unPrefix0x } from "./attestation-request-parse";
import { AttestationType } from "./attestation-types-enum";

//////////////////////////////////////////////////////////////
// Functions for encoding attestation requests to byte strings
//////////////////////////////////////////////////////////////

export class AttestationRequestEncodeError extends Error {
   constructor(message: any) {
      super(message);
      this.name = 'AttestationRequestEncodeError';
   }
}

function toUnprefixedBytes(value: any, type: string, size: number, key: string) {
   let bytes = "";  
   switch (type) {
      case "AttestationType":
         bytes = unPrefix0x(toHex(value as number, size));
         break;
      case "NumberLike":
         bytes = unPrefix0x(toHex(value, size));
         break;
      case "SourceId":
         bytes = unPrefix0x(toHex(value as number, size));
         break;
      case "ByteSequenceLike":
         bytes =  unPrefix0x(toHex(value, size));
         break;
      default:
         throw new AttestationRequestEncodeError("Wrong type");
   }
   if(bytes.length > size * 2) {
      throw new AttestationRequestEncodeError("Too long byte string for key: " + key);
   }
   return bytes; 
}  

export function encodePayment(request: ARPayment) {
   if(request.attestationType == null) {
      throw new AttestationRequestEncodeError("Missing 'attestationType'")
   }
   if(request.sourceId == null) {
      throw new AttestationRequestEncodeError("Missing 'sourceId'")
   }
   if(request.upperBoundProof == null) {
      throw new AttestationRequestEncodeError("Missing 'upperBoundProof'")
   }
   if(request.id == null) {
      throw new AttestationRequestEncodeError("Missing 'id'")
   }
   if(request.inUtxo == null) {
      throw new AttestationRequestEncodeError("Missing 'inUtxo'")
   }
   if(request.utxo == null) {
      throw new AttestationRequestEncodeError("Missing 'utxo'")
   }
   let bytes = "0x"
   bytes += toUnprefixedBytes(request.attestationType, "AttestationType", 2, "attestationType");
   bytes += toUnprefixedBytes(request.sourceId, "SourceId", 4, "sourceId");
   bytes += toUnprefixedBytes(request.upperBoundProof, "ByteSequenceLike", 32, "upperBoundProof");
   bytes += toUnprefixedBytes(request.id, "ByteSequenceLike", 32, "id");
   bytes += toUnprefixedBytes(request.inUtxo, "NumberLike", 1, "inUtxo");
   bytes += toUnprefixedBytes(request.utxo, "NumberLike", 1, "utxo");
   return bytes;
}

export function encodeBalanceDecreasingTransaction(request: ARBalanceDecreasingTransaction) {
   if(request.attestationType == null) {
      throw new AttestationRequestEncodeError("Missing 'attestationType'")
   }
   if(request.sourceId == null) {
      throw new AttestationRequestEncodeError("Missing 'sourceId'")
   }
   if(request.upperBoundProof == null) {
      throw new AttestationRequestEncodeError("Missing 'upperBoundProof'")
   }
   if(request.id == null) {
      throw new AttestationRequestEncodeError("Missing 'id'")
   }
   if(request.inUtxo == null) {
      throw new AttestationRequestEncodeError("Missing 'inUtxo'")
   }
   let bytes = "0x"
   bytes += toUnprefixedBytes(request.attestationType, "AttestationType", 2, "attestationType");
   bytes += toUnprefixedBytes(request.sourceId, "SourceId", 4, "sourceId");
   bytes += toUnprefixedBytes(request.upperBoundProof, "ByteSequenceLike", 32, "upperBoundProof");
   bytes += toUnprefixedBytes(request.id, "ByteSequenceLike", 32, "id");
   bytes += toUnprefixedBytes(request.inUtxo, "NumberLike", 1, "inUtxo");
   return bytes;
}

export function encodeConfirmedBlockHeightExists(request: ARConfirmedBlockHeightExists) {
   if(request.attestationType == null) {
      throw new AttestationRequestEncodeError("Missing 'attestationType'")
   }
   if(request.sourceId == null) {
      throw new AttestationRequestEncodeError("Missing 'sourceId'")
   }
   if(request.upperBoundProof == null) {
      throw new AttestationRequestEncodeError("Missing 'upperBoundProof'")
   }
   let bytes = "0x"
   bytes += toUnprefixedBytes(request.attestationType, "AttestationType", 2, "attestationType");
   bytes += toUnprefixedBytes(request.sourceId, "SourceId", 4, "sourceId");
   bytes += toUnprefixedBytes(request.upperBoundProof, "ByteSequenceLike", 32, "upperBoundProof");
   return bytes;
}

export function encodeReferencedPaymentNonexistence(request: ARReferencedPaymentNonexistence) {
   if(request.attestationType == null) {
      throw new AttestationRequestEncodeError("Missing 'attestationType'")
   }
   if(request.sourceId == null) {
      throw new AttestationRequestEncodeError("Missing 'sourceId'")
   }
   if(request.upperBoundProof == null) {
      throw new AttestationRequestEncodeError("Missing 'upperBoundProof'")
   }
   if(request.deadlineBlockNumber == null) {
      throw new AttestationRequestEncodeError("Missing 'deadlineBlockNumber'")
   }
   if(request.deadlineTimestamp == null) {
      throw new AttestationRequestEncodeError("Missing 'deadlineTimestamp'")
   }
   if(request.destinationAddressHash == null) {
      throw new AttestationRequestEncodeError("Missing 'destinationAddressHash'")
   }
   if(request.amount == null) {
      throw new AttestationRequestEncodeError("Missing 'amount'")
   }
   if(request.paymentReference == null) {
      throw new AttestationRequestEncodeError("Missing 'paymentReference'")
   }
   let bytes = "0x"
   bytes += toUnprefixedBytes(request.attestationType, "AttestationType", 2, "attestationType");
   bytes += toUnprefixedBytes(request.sourceId, "SourceId", 4, "sourceId");
   bytes += toUnprefixedBytes(request.upperBoundProof, "ByteSequenceLike", 32, "upperBoundProof");
   bytes += toUnprefixedBytes(request.deadlineBlockNumber, "NumberLike", 4, "deadlineBlockNumber");
   bytes += toUnprefixedBytes(request.deadlineTimestamp, "NumberLike", 4, "deadlineTimestamp");
   bytes += toUnprefixedBytes(request.destinationAddressHash, "ByteSequenceLike", 32, "destinationAddressHash");
   bytes += toUnprefixedBytes(request.amount, "NumberLike", 16, "amount");
   bytes += toUnprefixedBytes(request.paymentReference, "ByteSequenceLike", 32, "paymentReference");
   return bytes;
}

export function encodeTrustlineIssuance(request: ARTrustlineIssuance) {
   if(request.attestationType == null) {
      throw new AttestationRequestEncodeError("Missing 'attestationType'")
   }
   if(request.sourceId == null) {
      throw new AttestationRequestEncodeError("Missing 'sourceId'")
   }
   if(request.upperBoundProof == null) {
      throw new AttestationRequestEncodeError("Missing 'upperBoundProof'")
   }
   if(request.issuerAccount == null) {
      throw new AttestationRequestEncodeError("Missing 'issuerAccount'")
   }
   let bytes = "0x"
   bytes += toUnprefixedBytes(request.attestationType, "AttestationType", 2, "attestationType");
   bytes += toUnprefixedBytes(request.sourceId, "SourceId", 4, "sourceId");
   bytes += toUnprefixedBytes(request.upperBoundProof, "ByteSequenceLike", 32, "upperBoundProof");
   bytes += toUnprefixedBytes(request.issuerAccount, "ByteSequenceLike", 20, "issuerAccount");
   return bytes;
}

export function encodeRequest(request: ARType): string  {  
   switch(request.attestationType) {
      case AttestationType.Payment:
         return encodePayment(request as ARPayment);
      case AttestationType.BalanceDecreasingTransaction:
         return encodeBalanceDecreasingTransaction(request as ARBalanceDecreasingTransaction);
      case AttestationType.ConfirmedBlockHeightExists:
         return encodeConfirmedBlockHeightExists(request as ARConfirmedBlockHeightExists);
      case AttestationType.ReferencedPaymentNonexistence:
         return encodeReferencedPaymentNonexistence(request as ARReferencedPaymentNonexistence);
      case AttestationType.TrustlineIssuance:
         return encodeTrustlineIssuance(request as ARTrustlineIssuance);
      default:
         throw new AttestationRequestEncodeError("Invalid attestation type");
   }
}
