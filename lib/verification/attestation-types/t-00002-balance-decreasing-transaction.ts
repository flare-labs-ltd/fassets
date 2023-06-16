import { SourceId } from "../sources/sources";
import { AttestationTypeScheme, BLOCKNUMBER_BYTES, IN_UTXO_BYTES, TX_ID_BYTES } from "./attestation-types";

export const TDEF: AttestationTypeScheme = {
  id: 2,
  supportedSources: [SourceId.XRP, SourceId.BTC, SourceId.LTC, SourceId.DOGE, SourceId.ALGO],
  name: "BalanceDecreasingTransaction",
  request: [
    {
      key: "id",
      size: TX_ID_BYTES,
      type: "ByteSequenceLike",
      description: `
Transaction hash to search for.
`,
    },
    {
      key: "blockNumber",
      size: BLOCKNUMBER_BYTES,
      type: "NumberLike",
      description: `
Block number of the transaction.
`,
    },
    {
      key: "sourceAddressIndicator",
      size: IN_UTXO_BYTES,
      type: "ByteSequenceLike",
      description: `
Either standardized hash of a source address or UTXO vin index in hex format.
`,
    },
  ],
  dataHashDefinition: [
    {
      key: "blockNumber",
      type: "uint64",
      description: `
Number of the transaction block on the underlying chain.
`,
    },
    {
      key: "blockTimestamp",
      type: "uint64",
      description: `
Timestamp of the transaction block on the underlying chain.
`,
    },
    {
      key: "transactionHash",
      type: "bytes32",
      description: `
Hash of the transaction on the underlying chain.
`,
    },
    {
      key: "sourceAddressIndicator",
      type: "bytes32",
      description: `
Either standardized hash of a source address or UTXO vin index in hex format
(as provided in the request).
`,
    },
    {
      key: "sourceAddressHash",
      type: "bytes32",
      description: `
Standardized hash of the source address viewed as a string (the one indicated
  by the 'sourceAddressIndicator' (vin input index) parameter for UTXO blockchains).
`,
    },
    {
      key: "spentAmount",
      type: "int256",
      description: `
The amount that went out of the source address, in the smallest underlying units.
In non-UTXO chains it includes both payment value and fee (gas).
Calculation for UTXO chains depends on the existence of standardized payment reference.
If it exists, it is calculated as 'total_outgoing_amount - returned_amount' from the address
indicated by 'sourceAddressIndicator', and can be negative.
If the standardized payment reference does not exist, then it is just the spent amount
on the input indicated by 'sourceAddressIndicator'.
`,
    },
    {
      key: "paymentReference",
      type: "bytes32",
      description: `
Standardized payment reference, if it exists, 0 otherwise.
`,
    },
  ],
};
