//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

import { ByteSequenceLike, NumberLike } from "../attestation-types/attestation-types";
import { AttestationType } from "./attestation-types-enum";
import { SourceId } from "../sources/sources";

export interface ARPayment {
   // Attestation type id for this request, see 'AttestationType' enum.
   attestationType: AttestationType;

   // The ID of the underlying chain, see 'SourceId' enum.
   sourceId: SourceId;

   // The hash of the confirmation block for an upper query window boundary block.
   upperBoundProof: ByteSequenceLike;

   // Transaction hash to search for.
   id: ByteSequenceLike;

   // Index of the source address on UTXO chains. Always 0 on non-UTXO chains.
   inUtxo: NumberLike;

   // Index of the receiving address on UTXO chains. Always 0 on non-UTXO chains.
   utxo: NumberLike;
}

export interface ARBalanceDecreasingTransaction {
   // Attestation type id for this request, see 'AttestationType' enum.
   attestationType: AttestationType;

   // The ID of the underlying chain, see 'SourceId' enum.
   sourceId: SourceId;

   // The hash of the confirmation block for an upper query window boundary block.
   upperBoundProof: ByteSequenceLike;

   // Transaction hash to search for.
   id: ByteSequenceLike;

   // Index of the source address on UTXO chains.
   inUtxo: NumberLike;
}

export interface ARConfirmedBlockHeightExists {
   // Attestation type id for this request, see AttestationType enum.
   attestationType: AttestationType;

   // The ID of the underlying chain, see SourceId enum.
   sourceId: SourceId;

   // The hash of the confirmation block for an upper query window boundary block.
   upperBoundProof: ByteSequenceLike;
}

export interface ARReferencedPaymentNonexistence {
   // Attestation type id for this request, see 'AttestationType' enum.
   attestationType: AttestationType;

   // The ID of the underlying chain, see 'SourceId' enum.
   sourceId: SourceId;

   // The hash of the confirmation block for an upper query window boundary block.
   upperBoundProof: ByteSequenceLike;

   // Maximum number of the block where the transaction is searched for.
   deadlineBlockNumber: NumberLike;

   // Maximum median timestamp of the block where the transaction is searched for.
   deadlineTimestamp: NumberLike;

   // Hash of exact address to which the payment was done to.
   destinationAddressHash: ByteSequenceLike;

   // The exact amount to search for.
   amount: NumberLike;

   // The payment reference to search for.
   paymentReference: ByteSequenceLike;
}

export interface ARTrustlineIssuance {
   // Attestation type id for this request, see 'AttestationType' enum.
   attestationType: AttestationType;

   // The ID of the underlying chain, see 'SourceId' enum.
   sourceId: SourceId;

   // The hash of the confirmation block for an upper query window boundary block.
   upperBoundProof: ByteSequenceLike;

   // Ripple account address as bytes.
   issuerAccount: ByteSequenceLike;
}
export type ARType = ARPayment | ARBalanceDecreasingTransaction | ARConfirmedBlockHeightExists | ARReferencedPaymentNonexistence | ARTrustlineIssuance;