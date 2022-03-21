import { SourceId } from "../sources/sources";
import { AttestationTypeScheme, ATT_BYTES, BLOCKNUMBER_BYTES, SOURCE_ID_BYTES, DATA_AVAILABILITY_BYTES, TX_ID_BYTES, UTXO_BYTES } from "./attestation-types";

export const TDEF: AttestationTypeScheme = {
   id: 2,
   supportedSources: [SourceId.XRP, SourceId.BTC, SourceId.LTC, SourceId.DOGE, SourceId.ALGO],
   name: "BalanceDecreasingTransaction",
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
         key: "blockNumber",
         size: BLOCKNUMBER_BYTES,
         type: "NumberLike",
         description: 
`
Number of the block of the transaction.
`
      },  
      {
         key: "inUtxo",
         size: UTXO_BYTES,
         type: "NumberLike",
         description: 
`
Index of the sourceAddress on utxo chains.
`
      },
      {
         key: "id",
         size: TX_ID_BYTES,
         type: "ByteSequenceLike",
         description: 
`
Transaction hash to search for.
`
      },
      {
         key: "dataAvailabilityProof",
         size: DATA_AVAILABILITY_BYTES,
         type: "ByteSequenceLike",
         description: 
`
Block hash of the finalization block for the searched transaction (e.g. at least 6 blocks after the block with transaction).
`
      },
   ],
   dataHashDefinition: [
      {
         key: "blockNumber",
         type: "uint64",
         description:
`
Number of the transaction block on the underlying chain.
`
      },
      {
         key: "blockTimestamp",
         type: "uint64",
         description:
`
Timestamp of the transaction block on the underlying chain.
`
      },
      {
         key: "transactionHash",
         type: "bytes32",
         description:
`
Hash of the transaction on the underlying chain.
`
      },
      {
         key: "sourceAddress",
         type: "bytes32",
         description:
`
Hash of the source address as a string. For utxo transactions with multiple addresses,
it is the one for which \`spent\` is calculated and was indicated in the state connector instructions.
`
      },
      {
         key: "spentAmount",
         type: "int256",
         description:
`
The amount that went out of the \`sourceAddress\`, in smallest underlying units.
It includes both payment value and fee (gas). For utxo chains it is calculcated as 
\`outgoing_amount - returned_amount\` and can be negative, that's why signed \`int256\` is used.
`
      },
      {
         key: "paymentReference",
         type: "bytes32",
         description:
`
If the attestation provider detects that the transaction is actually a valid payment (same conditions
as for Payment), it should set this field to its the paymentReference.
Otherwise, paymentReference must be 0.
`
      },
   ]
}
