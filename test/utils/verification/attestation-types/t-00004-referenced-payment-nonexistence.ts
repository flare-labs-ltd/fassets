import { SourceId } from "../sources/sources";
import {
   AMOUNT_BYTES,
   AttestationTypeScheme, ATT_BYTES,
   BLOCKNUMBER_BYTES,
   SOURCE_ID_BYTES,
   UPPER_BOUND_PROOF_BYTES,
   PAYMENT_REFERENCE_BYTES,
   TIMESTAMP_BYTES,
   TX_ID_BYTES
} from "./attestation-types";

export const TDEF: AttestationTypeScheme = {
   id: 4,
   supportedSources: [SourceId.XRP, SourceId.BTC, SourceId.LTC, SourceId.DOGE, SourceId.ALGO],
   name: "ReferencedPaymentNonexistence",
   request: [
      {
         key: "attestationType",
         size: ATT_BYTES,
         type: "AttestationType",
         description: 
`
Attestation type id for this request, see 'AttestationType' enum.
`
      },
      {
         key: "sourceId",
         size: SOURCE_ID_BYTES,
         type: "SourceId",
         description: 
`
The ID of the underlying chain, see 'SourceId' enum.
`
      },
      {
         key: "upperBoundProof",
         size: UPPER_BOUND_PROOF_BYTES,
         type: "ByteSequenceLike",
         description: 
`
The hash of the confirmation block for an upper query window boundary block.
`
      },
      {
         key: "deadlineBlockNumber",
         size: BLOCKNUMBER_BYTES,
         type: "NumberLike",
         description: 
`
Maximum number of the block where the transaction is searched for.
`
      },

      {
         key: "deadlineTimestamp",
         size: TIMESTAMP_BYTES,
         type: "NumberLike",
         description: 
`
Maximum median timestamp of the block where the transaction is searched for.
`
      },
      {
         key: "destinationAddressHash",
         size: TX_ID_BYTES,
         type: "ByteSequenceLike",
         description:
`
Hash of exact address to which the payment was done to.
`
      },
      {
         key: "amount",
         size: AMOUNT_BYTES,
         type: "NumberLike",
         description: 
`
The exact amount to search for.
`
      },
      {
         key: "paymentReference",
         size: PAYMENT_REFERENCE_BYTES,
         type: "ByteSequenceLike",
         description: 
`
The payment reference to search for.
`
      },
   ],
   dataHashDefinition: [
      {
         key: "deadlineBlockNumber",
         type: "uint64",
         description:
`
Deadline block number specified in the attestation request.
`
      },

      {
         key: "deadlineTimestamp",
         type: "uint64",
         description:
`
Deadline timestamp specified in the attestation request.
`
      },
      {
         key: "destinationAddressHash",
         type: "bytes32",
         description:
`
Hash of the destination address searched for.
`
      },
      {
         key: "paymentReference",
         type: "bytes32",
         description:
`
The payment reference searched for.
`
      },
      {
         key: "amount",
         type: "uint128",
         description:
`
The amount searched for.
`
      },
      {
         key: "lowerBoundaryBlockNumber",
         type: "uint64",
         description:
`
The first confirmed block that gets checked.
It is the lowest block in the synchronized query window.
`
      },
      {
         key: "lowerBoundaryBlockTimestamp",
         type: "uint64",
         description:
`
Timestamp of the lowerBoundaryBlockNumber.
`
      },
      {
         key: "firstOverflowBlockNumber",
         type: "uint64",
         description:
`
The first (lowest) confirmed block with 'timestamp > deadlineTimestamp' 
and 'blockNumber  > deadlineBlockNumber'.
`
      },
      {
         key: "firstOverflowBlockTimestamp",
         type: "uint64",
         description:
`
Timestamp of the firstOverflowBlock. 
`
      },
   ]
}
