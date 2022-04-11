//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

import { 
   ARPayment,
   ARBalanceDecreasingTransaction,
   ARConfirmedBlockHeightExists,
   ARReferencedPaymentNonexistence,
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
   if(request.blockNumber == null) {
      throw new AttestationRequestEncodeError("Missing 'blockNumber'")
   }
   if(request.utxo == null) {
      throw new AttestationRequestEncodeError("Missing 'utxo'")
   }
   if(request.inUtxo == null) {
      throw new AttestationRequestEncodeError("Missing 'inUtxo'")
   }
   if(request.id == null) {
      throw new AttestationRequestEncodeError("Missing 'id'")
   }
   if(request.dataAvailabilityProof == null) {
      throw new AttestationRequestEncodeError("Missing 'dataAvailabilityProof'")
   }
   let bytes = "0x"
   bytes += toUnprefixedBytes(request.attestationType, "AttestationType", 2, "attestationType");
   bytes += toUnprefixedBytes(request.sourceId, "SourceId", 4, "sourceId");
   bytes += toUnprefixedBytes(request.blockNumber, "NumberLike", 4, "blockNumber");
   bytes += toUnprefixedBytes(request.utxo, "NumberLike", 1, "utxo");
   bytes += toUnprefixedBytes(request.inUtxo, "NumberLike", 1, "inUtxo");
   bytes += toUnprefixedBytes(request.id, "ByteSequenceLike", 32, "id");
   bytes += toUnprefixedBytes(request.dataAvailabilityProof, "ByteSequenceLike", 32, "dataAvailabilityProof");
   return bytes;
}

export function encodeBalanceDecreasingTransaction(request: ARBalanceDecreasingTransaction) {
   if(request.attestationType == null) {
      throw new AttestationRequestEncodeError("Missing 'attestationType'")
   }
   if(request.sourceId == null) {
      throw new AttestationRequestEncodeError("Missing 'sourceId'")
   }
   if(request.blockNumber == null) {
      throw new AttestationRequestEncodeError("Missing 'blockNumber'")
   }
   if(request.inUtxo == null) {
      throw new AttestationRequestEncodeError("Missing 'inUtxo'")
   }
   if(request.id == null) {
      throw new AttestationRequestEncodeError("Missing 'id'")
   }
   if(request.dataAvailabilityProof == null) {
      throw new AttestationRequestEncodeError("Missing 'dataAvailabilityProof'")
   }
   let bytes = "0x"
   bytes += toUnprefixedBytes(request.attestationType, "AttestationType", 2, "attestationType");
   bytes += toUnprefixedBytes(request.sourceId, "SourceId", 4, "sourceId");
   bytes += toUnprefixedBytes(request.blockNumber, "NumberLike", 4, "blockNumber");
   bytes += toUnprefixedBytes(request.inUtxo, "NumberLike", 1, "inUtxo");
   bytes += toUnprefixedBytes(request.id, "ByteSequenceLike", 32, "id");
   bytes += toUnprefixedBytes(request.dataAvailabilityProof, "ByteSequenceLike", 32, "dataAvailabilityProof");
   return bytes;
}

export function encodeConfirmedBlockHeightExists(request: ARConfirmedBlockHeightExists) {
   if(request.attestationType == null) {
      throw new AttestationRequestEncodeError("Missing 'attestationType'")
   }
   if(request.sourceId == null) {
      throw new AttestationRequestEncodeError("Missing 'sourceId'")
   }
   if(request.blockNumber == null) {
      throw new AttestationRequestEncodeError("Missing 'blockNumber'")
   }
   if(request.dataAvailabilityProof == null) {
      throw new AttestationRequestEncodeError("Missing 'dataAvailabilityProof'")
   }
   let bytes = "0x"
   bytes += toUnprefixedBytes(request.attestationType, "AttestationType", 2, "attestationType");
   bytes += toUnprefixedBytes(request.sourceId, "SourceId", 4, "sourceId");
   bytes += toUnprefixedBytes(request.blockNumber, "NumberLike", 4, "blockNumber");
   bytes += toUnprefixedBytes(request.dataAvailabilityProof, "ByteSequenceLike", 32, "dataAvailabilityProof");
   return bytes;
}

export function encodeReferencedPaymentNonexistence(request: ARReferencedPaymentNonexistence) {
   if(request.attestationType == null) {
      throw new AttestationRequestEncodeError("Missing 'attestationType'")
   }
   if(request.sourceId == null) {
      throw new AttestationRequestEncodeError("Missing 'sourceId'")
   }
   if(request.endTimestamp == null) {
      throw new AttestationRequestEncodeError("Missing 'endTimestamp'")
   }
   if(request.endBlock == null) {
      throw new AttestationRequestEncodeError("Missing 'endBlock'")
   }
   if(request.destinationAddress == null) {
      throw new AttestationRequestEncodeError("Missing 'destinationAddress'")
   }
   if(request.amount == null) {
      throw new AttestationRequestEncodeError("Missing 'amount'")
   }
   if(request.paymentReference == null) {
      throw new AttestationRequestEncodeError("Missing 'paymentReference'")
   }
   if(request.overflowBlock == null) {
      throw new AttestationRequestEncodeError("Missing 'overflowBlock'")
   }
   if(request.dataAvailabilityProof == null) {
      throw new AttestationRequestEncodeError("Missing 'dataAvailabilityProof'")
   }
   let bytes = "0x"
   bytes += toUnprefixedBytes(request.attestationType, "AttestationType", 2, "attestationType");
   bytes += toUnprefixedBytes(request.sourceId, "SourceId", 4, "sourceId");
   bytes += toUnprefixedBytes(request.endTimestamp, "NumberLike", 4, "endTimestamp");
   bytes += toUnprefixedBytes(request.endBlock, "NumberLike", 4, "endBlock");
   bytes += toUnprefixedBytes(request.destinationAddress, "ByteSequenceLike", 32, "destinationAddress");
   bytes += toUnprefixedBytes(request.amount, "NumberLike", 16, "amount");
   bytes += toUnprefixedBytes(request.paymentReference, "ByteSequenceLike", 32, "paymentReference");
   bytes += toUnprefixedBytes(request.overflowBlock, "NumberLike", 4, "overflowBlock");
   bytes += toUnprefixedBytes(request.dataAvailabilityProof, "ByteSequenceLike", 32, "dataAvailabilityProof");
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
      default:
         throw new AttestationRequestEncodeError("Invalid attestation type");
   }
}
