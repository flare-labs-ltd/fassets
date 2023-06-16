import { SourceId } from "../sources/sources";
import {
  AMOUNT_BYTES,
  AttestationTypeScheme,
  ATT_BYTES,
  BLOCKNUMBER_BYTES,
  MIC_BYTES,
  PAYMENT_REFERENCE_BYTES,
  SOURCE_ID_BYTES,
  TIMESTAMP_BYTES,
  TX_ID_BYTES,
} from "./attestation-types";

export const TDEF: AttestationTypeScheme = {
  id: 4,
  supportedSources: [SourceId.XRP, SourceId.BTC, SourceId.LTC, SourceId.DOGE, SourceId.ALGO],
  name: "ReferencedPaymentNonexistence",
  request: [
    {
      key: "minimalBlockNumber",
      size: BLOCKNUMBER_BYTES,
      type: "NumberLike",
      description: `
Minimum number of the block for the query window. Equal to 'lowerBoundaryBlockNumber' in response.
`,
    },
    {
      key: "deadlineBlockNumber",
      size: BLOCKNUMBER_BYTES,
      type: "NumberLike",
      description: `
Maximum number of the block where the transaction is searched for.
`,
    },
    {
      key: "deadlineTimestamp",
      size: TIMESTAMP_BYTES,
      type: "NumberLike",
      description: `
Maximum timestamp of the block where the transaction is searched for.
Search range is determined by the bigger of the 'deadlineBlockNumber'
and the last block with 'deadlineTimestamp'.
`,
    },
    {
      key: "destinationAddressHash",
      size: TX_ID_BYTES,
      type: "ByteSequenceLike",
      description: `
Standardized address hash of the exact address to which the payment was done to.
`,
    },
    {
      key: "amount",
      size: AMOUNT_BYTES,
      type: "NumberLike",
      description: `
The minimal amount to search for.
`,
    },
    {
      key: "paymentReference",
      size: PAYMENT_REFERENCE_BYTES,
      type: "ByteSequenceLike",
      description: `
The payment reference to search for.
`,
    },
  ],
  dataHashDefinition: [
    {
      key: "deadlineBlockNumber",
      type: "uint64",
      description: `
Deadline block number specified in the attestation request.
`,
    },
    {
      key: "deadlineTimestamp",
      type: "uint64",
      description: `
Deadline timestamp specified in the attestation request.
`,
    },
    {
      key: "destinationAddressHash",
      type: "bytes32",
      description: `
Standardized address hash of the destination address searched for.
`,
    },
    {
      key: "paymentReference",
      type: "bytes32",
      description: `
The payment reference searched for.
`,
    },
    {
      key: "amount",
      type: "uint128",
      description: `
The minimal amount intended to be paid to the destination address.
The actual amount should match or exceed this value.
`,
    },
    {
      key: "lowerBoundaryBlockNumber",
      type: "uint64",
      description: `
The first confirmed block that gets checked. It is exactly 'minimalBlockNumber' from the request.
`,
    },
    {
      key: "lowerBoundaryBlockTimestamp",
      type: "uint64",
      description: `
Timestamp of the 'lowerBoundaryBlockNumber'.
`,
    },
    {
      key: "firstOverflowBlockNumber",
      type: "uint64",
      description: `
The first (lowest) confirmed block with 'timestamp > deadlineTimestamp'
and 'blockNumber  > deadlineBlockNumber'.
`,
    },
    {
      key: "firstOverflowBlockTimestamp",
      type: "uint64",
      description: `
Timestamp of the firstOverflowBlock.
`,
    },
  ],
};
