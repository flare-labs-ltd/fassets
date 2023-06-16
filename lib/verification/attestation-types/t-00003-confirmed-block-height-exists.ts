import { SourceId } from "../sources/sources";
import { AttestationTypeScheme, BLOCKNUMBER_BYTES, TIME_DURATION_BYTES } from "./attestation-types";

export const TDEF: AttestationTypeScheme = {
  id: 3,
  supportedSources: [SourceId.XRP, SourceId.BTC, SourceId.LTC, SourceId.DOGE, SourceId.ALGO],
  name: "ConfirmedBlockHeightExists",
  request: [
    {
      key: "blockNumber",
      size: BLOCKNUMBER_BYTES,
      type: "NumberLike",
      description: `
Block number to be proved to be confirmed.
`,
    },
    {
      key: "queryWindow",
      size: TIME_DURATION_BYTES,
      type: "NumberLike",
      description: `
Period in seconds considered for sampling block production.
The block with number 'lowestQueryWindowBlockNumber' in the attestation response is defined
as the last block with the timestamp strictly smaller than 'block.timestamp - queryWindow'.
`,
    },
  ],
  dataHashDefinition: [
    {
      key: "blockNumber",
      type: "uint64",
      description: `
Number of the highest confirmed block that was proved to exist.
`,
    },
    {
      key: "blockTimestamp",
      type: "uint64",
      description: `
Timestamp of the confirmed block that was proved to exist.
`,
    },
    {
      key: "numberOfConfirmations",
      type: "uint8",
      description: `
Number of confirmations for the blockchain.
`,
    },
    {
      key: "lowestQueryWindowBlockNumber",
      type: "uint64",
      description: `
Lowest query window block number.
`,
    },
    {
      key: "lowestQueryWindowBlockTimestamp",
      type: "uint64",
      description: `
Lowest query window block timestamp.
`,
    },
  ],
};
