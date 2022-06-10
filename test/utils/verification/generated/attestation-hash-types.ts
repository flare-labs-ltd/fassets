//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

import BN from "bn.js";


export interface DHPayment {
   // Attestation type
   stateConnectorRound: number;
   merkleProof?: string[];
   
   // Number of the transaction block on the underlying chain.
   blockNumber: BN;

   // Timestamp of the transaction block on the underlying chain.
   blockTimestamp: BN;

   // Hash of the transaction on the underlying chain.
   transactionHash: string;

   // Index of the transaction input indicating source address on UTXO chains, 0 on non-UTXO chains.
   inUtxo: BN;

   // Output index for a transaction with multiple outputs on UTXO chains, 0 on non-UTXO chains.
   // The same as in the 'utxo' parameter from the request.
   utxo: BN;

   // Hash of the source address viewed as a string (the one indicated by the 'inUtxo'
   // parameter for UTXO blockchains).
   sourceAddressHash: string;

   // Hash of the receiving address as a string (the one indicated by the 'utxo'
   // parameter for UTXO blockchains).
   receivingAddressHash: string;

   // The amount that went out of the source address, in the smallest underlying units.
   // In non-UTXO chains it includes both payment value and fee (gas).
   // Calculation for UTXO chains depends on the existence of standardized payment reference.
   // If it exists, it is calculated as 'outgoing_amount - returned_amount' and can be negative.
   // If the standardized payment reference does not exist, then it is just the spent amount
   // on the input indicated by 'inUtxo'.
   spentAmount: BN;

   // The amount received to the receiving address, in smallest underlying units. Can be negative in UTXO chains.
   receivedAmount: BN;

   // Standardized payment reference, if it exists, 0 otherwise.
   paymentReference: string;

   // 'true' if the transaction has exactly one source address and 
   // exactly one receiving address (different from source).
   oneToOne: boolean;

   // Transaction success status, can have 3 values:
   //   - 0 - Success
   //   - 1 - Failure due to sender (this is the default failure)
   //   - 2 - Failure due to receiver (bad destination address)
   status: BN;
}

export interface DHBalanceDecreasingTransaction {
   // Attestation type
   stateConnectorRound: number;
   merkleProof?: string[];
   
   // Number of the transaction block on the underlying chain.
   blockNumber: BN;

   // Timestamp of the transaction block on the underlying chain.
   blockTimestamp: BN;

   // Hash of the transaction on the underlying chain.
   transactionHash: string;

   // Index of the transaction input indicating source address on UTXO chains, 0 on non-UTXO chains.
   inUtxo: BN;

   // Hash of the source address as a string. For UTXO transactions with multiple input addresses 
   // this is the address that is on the input indicated by 'inUtxo' parameter.
   sourceAddressHash: string;

   // The amount that went out of the source address, in the smallest underlying units.
   // In non-UTXO chains it includes both payment value and fee (gas).
   // Calculation for UTXO chains depends on the existence of standardized payment reference.
   // If it exists, it is calculated as 'outgoing_amount - returned_amount' and can be negative.
   // If the standardized payment reference does not exist, then it is just the spent amount
   // on the input indicated by 'inUtxo'.
   spentAmount: BN;

   // Standardized payment reference, if it exists, 0 otherwise.
   paymentReference: string;
}

export interface DHConfirmedBlockHeightExists {
   // Attestation type
   stateConnectorRound: number;
   merkleProof?: string[];
   
   // Number of the highest confirmed block that was proved to exist.
   blockNumber: BN;

   // Timestamp of the confirmed block that was proved to exist.
   blockTimestamp: BN;

   // Number of confirmations for the blockchain.
   numberOfConfirmations: BN;

   // Average block production time based on the data in the query window.
   averageBlockProductionTimeMs: BN;

   // Lowest query window block number.
   lowestQueryWindowBlockNumber: BN;

   // Lowest query window block timestamp.
   lowestQueryWindowBlockTimestamp: BN;
}

export interface DHReferencedPaymentNonexistence {
   // Attestation type
   stateConnectorRound: number;
   merkleProof?: string[];
   
   // Deadline block number specified in the attestation request.
   deadlineBlockNumber: BN;

   // Deadline timestamp specified in the attestation request.
   deadlineTimestamp: BN;

   // Hash of the destination address searched for.
   destinationAddressHash: string;

   // The payment reference searched for.
   paymentReference: string;

   // The amount searched for.
   amount: BN;

   // The first confirmed block that gets checked.
   // It is the lowest block in the synchronized query window.
   lowerBoundaryBlockNumber: BN;

   // Timestamp of the lowerBoundaryBlockNumber.
   lowerBoundaryBlockTimestamp: BN;

   // The first (lowest) confirmed block with 'timestamp > deadlineTimestamp' 
   // and 'blockNumber  > deadlineBlockNumber'.
   firstOverflowBlockNumber: BN;

   // Timestamp of the firstOverflowBlock.
   firstOverflowBlockTimestamp: BN;
}

export interface DHTrustlineIssuance {
   // Attestation type
   stateConnectorRound: number;
   merkleProof?: string[];
   
   // 3 letter code or 160-bit hexadecimal string known as 
   // [Currency code](https://xrpl.org/currency-formats.html#currency-codes).
   // The first byte indicates whether it is a 3 letter encoded ascii string "0x00..."
   // or 160 bit hex string "0x01...".
   tokenCurrencyCode: string;

   // Nominator of the token value described as the fraction reduced by the highest exponent of 10.
   tokenValueNominator: BN;

   // Denominator of the token value described as the fraction reduced by the highest exponent of 10.
   tokenValueDenominator: BN;

   // Ripple account address of token issuer as bytes (right padded address bytes (20 + 12)).
   tokenIssuer: string;
}
export type DHType = DHPayment | DHBalanceDecreasingTransaction | DHConfirmedBlockHeightExists | DHReferencedPaymentNonexistence | DHTrustlineIssuance;