import { SourceId } from "../sources/sources";
import { AttestationTypeScheme, ATT_BYTES, SOURCE_ID_BYTES, TX_ID_BYTES, UPPER_BOUND_PROOF_BYTES, UTXO_BYTES } from "./attestation-types";

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
         key: "id",
         size: TX_ID_BYTES,
         type: "ByteSequenceLike",
         description: 
`
Transaction hash to search for.
`
      },
      {
         key: "inUtxo",
         size: UTXO_BYTES,
         type: "NumberLike",
         description: 
`
Index of the source address on UTXO chains.
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
         key: "inUtxo",
         type: "uint8",
         description:
`
Index of the transaction input indicating source address on UTXO chains, 0 on non-UTXO chains.
`
      },
      {
         key: "sourceAddressHash",
         type: "bytes32",
         description:
`
Hash of the source address as a string. For UTXO transactions with multiple input addresses 
this is the address that is on the input indicated by 'inUtxo' parameter.
`
      },
      {
         key: "spentAmount",
         type: "int256",
         description:
`
The amount that went out of the source address, in the smallest underlying units.
In non-UTXO chains it includes both payment value and fee (gas).
Calculation for UTXO chains depends on the existence of standardized payment reference.
If it exists, it is calculated as 'outgoing_amount - returned_amount' and can be negative.
If the standardized payment reference does not exist, then it is just the spent amount
on the input indicated by 'inUtxo'.
`
      },
      {
         key: "paymentReference",
         type: "bytes32",
         description:
`
Standardized payment reference, if it exists, 0 otherwise.
`
      },
   ]
}
