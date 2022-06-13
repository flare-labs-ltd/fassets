import { SourceId } from "../sources/sources";
import {
   AttestationTypeScheme, ATT_BYTES, SOURCE_ID_BYTES,
   UPPER_BOUND_PROOF_BYTES
} from "./attestation-types";

export const TDEF: AttestationTypeScheme = {
   id: 3,
   supportedSources: [SourceId.XRP, SourceId.BTC, SourceId.LTC, SourceId.DOGE, SourceId.ALGO],
   name: "ConfirmedBlockHeightExists",
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
         key: "upperBoundProof",
         size: UPPER_BOUND_PROOF_BYTES,
         type: "ByteSequenceLike",
         description: 
`
The hash of the confirmation block for an upper query window boundary block.
`
      },
   ],
   dataHashDefinition: [
      {
         key: "blockNumber",
         type: "uint64",
         description:
`
Number of the highest confirmed block that was proved to exist.
`
      },
      {
         key: "blockTimestamp",
         type: "uint64",
         description:
`
Timestamp of the confirmed block that was proved to exist.
`
      },
      {
         key: "numberOfConfirmations",
         type: "uint8",
         description:
`
Number of confirmations for the blockchain.
`
      },
      {
         key: "averageBlockProductionTimeMs",
         type: "uint64",
         description:
`
Average block production time based on the data in the query window.
`
      },
      {
         key: "lowestQueryWindowBlockNumber",
         type: "uint64",
         description:
`
Lowest query window block number.
`
      },
      {
         key: "lowestQueryWindowBlockTimestamp",
         type: "uint64",
         description:
`
Lowest query window block timestamp.
`
      }
   ]
}
