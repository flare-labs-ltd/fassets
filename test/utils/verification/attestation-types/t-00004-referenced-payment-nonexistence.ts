import { SourceId } from "../sources/sources";
import {
   AMOUNT_BYTES,
   AttestationTypeScheme, ATT_BYTES,
   BLOCKNUMBER_BYTES,
   SOURCE_ID_BYTES,
   DATA_AVAILABILITY_BYTES,
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
Attestation type id for this request, see AttestationType enum.
`
      },
      {
         key: "sourceId",
         size: SOURCE_ID_BYTES,
         type: "SourceId",
         description: 
`
The ID of the underlying chain, see SourceId enum.
`
      },
      {
         key: "endTimestamp",
         size: TIMESTAMP_BYTES,
         type: "NumberLike",
         description: 
`
Maximum median timestamp of the block where the transaction is searched for.
`
      },
      {
         key: "endBlock",
         size: BLOCKNUMBER_BYTES,
         type: "NumberLike",
         description: 
`
Maximum number of the block where the transaction is searched for.
`
      },
      {
         key: "destinationAddress",
         size: TX_ID_BYTES,
         type: "ByteSequenceLike",
         description:
`
Payment nonexistence is confirmed if there is no payment transaction (attestation of \`Payment\` type)
with correct \`(destinationAddress, paymentReference, amount)\` combination
and with transaction status 0 (success) or 2 (failure, receiver's fault). 
Note: if there exist only payment(s) with status 1 (failure, sender's fault) 
then payment nonexistence is still confirmed.
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
      {
         key: "overflowBlock",
         size: BLOCKNUMBER_BYTES,
         type: "NumberLike",
         description: 
`
Number of the overflow block - the block which has \`block.timestamp > endTimestamp\` and \`block.blockNumber > endBlock\`.
Does not need to be the first such block. It has to be confirmed.
`
      },
      {
         key: "dataAvailabilityProof",
         size: DATA_AVAILABILITY_BYTES,
         type: "ByteSequenceLike",
         description: 
`
Block hash of the confirmation data availability block for the overflow block.
`
      },
   ],
   dataHashDefinition: [
      {
         key: "endTimestamp",
         type: "uint64",
         description:
`
End timestamp specified in attestation request.
`
      },
      {
         key: "endBlock",
         type: "uint64",
         description:
`
End block specified in attestation request.
`
      },
      {
         key: "destinationAddress",
         type: "bytes32",
         description:
`
Payment nonexistence is confirmed if there is no payment transaction (attestation of \`Payment\` type)
with correct \`(destinationAddress, paymentReference, amount)\` combination
and with transaction status 0 (success) or 2 (failure, receiver's fault). 
Note: if there exist only payment(s) with status 1 (failure, sender's fault) 
then payment nonexistence is still confirmed.
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
         key: "firstCheckedBlock",
         type: "uint64",
         description:
`
The first (confirmed) block that gets checked. It is the block that has timestamp (median time) 
greater or equal to \`endTimestamp - CHECK_WINDOW\`. 
f-asset: check that \`firstCheckBlock <= currentUnderlyingBlock\` at the time of redemption request.
`
      },
      {
         key: "firstCheckedBlockTimestamp",
         type: "uint64",
         description:
`
Timestamp of the firstCheckedBlock.
`
      },
      {
         key: "firstOverflowBlock",
         type: "uint64",
         description:
`
The first confirmed block with \`timestamp > endTimestamp\` and \`blockNumber  > endBlock\`. 
f-asset: check that \`firstOverflowBlock > last payment block\` (\`= currentUnderlyingBlock + blocksToPay\`).
`
      },
      {
         key: "firstOverflowBlockTimestamp",
         type: "uint64",
         description:
`
Timestamp of the firstOverflowBlock.
f-asset: check that \`firstOverflowBlockTimestamp > last payment timestamp\` 
     (\`= currentUnderlyingBlockTimestamp + time to pay\`). 
`
      },
   ]
}
