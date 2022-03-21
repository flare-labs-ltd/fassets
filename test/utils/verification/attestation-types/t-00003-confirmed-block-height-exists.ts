import { SourceId } from "../sources/sources";
import {
   AttestationTypeScheme, ATT_BYTES,
   BLOCKNUMBER_BYTES,
   SOURCE_ID_BYTES,
   DATA_AVAILABILITY_BYTES
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
         key: "blockNumber",
         size: BLOCKNUMBER_BYTES,
         type: "NumberLike",
         description: 
`
Number of the block to prove the existence of.
`
      },
      {
         key: "dataAvailabilityProof",
         size: DATA_AVAILABILITY_BYTES,
         type: "ByteSequenceLike",
         description: 
`
Hash of the block to prove the existence of.
`
      },
   ],
   dataHashDefinition: [
      {
         key: "blockNumber",
         type: "uint64",
         description:
`
Number of the block that was proved to exist.
`
      },
      {
         key: "blockTimestamp",
         type: "uint64",
         description:
`
Timestamp of the block that was proved to exist.
`
      },
   ]
}
