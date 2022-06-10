import { SourceId } from "../sources/sources";
import {
   AttestationTypeScheme, ATT_BYTES, SOURCE_ID_BYTES, TX_ID_BYTES, UPPER_BOUND_PROOF_BYTES, UTXO_BYTES, XRP_ACCOUNT_BYTES
} from "./attestation-types";

export const TDEF: AttestationTypeScheme = {
   id: 5,
   supportedSources: [SourceId.XRP],
   name: "TrustlineIssuance",
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
         key: "issuerAccount",
         size: XRP_ACCOUNT_BYTES,
         type: "ByteSequenceLike",
         description: 
`
Ripple account address as bytes.
`
      }
   ],
   dataHashDefinition: [
      {
         key: "tokenCurrencyCode",
         type: "bytes32",
         description: 
`
3 letter code or 160-bit hexadecimal string known as 
[Currency code](https://xrpl.org/currency-formats.html#currency-codes).
The first byte indicates whether it is a 3 letter encoded ascii string "0x00..."
or 160 bit hex string "0x01...".
`
      },
      {
         key: "tokenValueNominator",
         type: "uint256",
         description:
`
Nominator of the token value described as the fraction reduced by the highest exponent of 10.
`
      },
      {
         key: "tokenValueDenominator",
         type: "uint256",
         description:
`
Denominator of the token value described as the fraction reduced by the highest exponent of 10.
`
      },
      {
         key: "tokenIssuer",
         type: "bytes32",
         description:
`
Ripple account address of token issuer as bytes (right padded address bytes (20 + 12)).
`
      }
   ]
}
