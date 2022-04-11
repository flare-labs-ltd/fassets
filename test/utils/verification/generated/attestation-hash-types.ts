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

   // Output index for transactions with multiple outputs.
   utxo: BN;

   // Hash of the source address as a string. For utxo transactions with multiple addresses,
   // it is the one for which `spent` is calculated and was indicated 
   // in the state connector instructions by the `inUtxo` parameter.
   sourceAddress: string;

   // Hash of the receiving address as a string (the one indicated by the `utxo` parameter).
   receivingAddress: string;

   // Chain dependent extra data (e.g. memo field, detination tag, tx data)
   // For minting and redemption payment it depends on request id, 
   // for topup and self-mint it depends on the agent vault address.
   // See PaymentReference.sol for details of payment reference calculation.
   paymentReference: string;

   // The amount that went out of the `sourceAddress`, in smallest underlying units.
   // It includes both payment value and fee (gas). For utxo chains it is calculcated as 
   // `outgoing_amount - returned_amount` and can be negative, that's why signed `int256` is used.
   spentAmount: BN;

   // The amount the receiving address received, in smallest underlying units.
   receivedAmount: BN;

   // True if the transaction has exactly one source address and 
   // exactly one receiving address (different from source).
   oneToOne: boolean;

   // Transaction success status, can have 3 values:
   // 0 - Success
   // 1 - Failure due to sender fault (this is the default failure)
   // 2 - Failure due to receiver fault (bad destination address)
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

   // Hash of the source address as a string. For utxo transactions with multiple addresses,
   // it is the one for which `spent` is calculated and was indicated in the state connector instructions.
   sourceAddress: string;

   // The amount that went out of the `sourceAddress`, in smallest underlying units.
   // It includes both payment value and fee (gas). For utxo chains it is calculcated as 
   // `outgoing_amount - returned_amount` and can be negative, that's why signed `int256` is used.
   spentAmount: BN;

   // If the attestation provider detects that the transaction is actually a valid payment (same conditions
   // as for Payment), it should set this field to its the paymentReference.
   // Otherwise, paymentReference must be 0.
   paymentReference: string;
}

export interface DHConfirmedBlockHeightExists {
   // Attestation type
   stateConnectorRound: number;
   merkleProof?: string[];
   
   // Number of the block that was proved to exist.
   blockNumber: BN;

   // Timestamp of the block that was proved to exist.
   blockTimestamp: BN;
}

export interface DHReferencedPaymentNonexistence {
   // Attestation type
   stateConnectorRound: number;
   merkleProof?: string[];
   
   // End timestamp specified in attestation request.
   endTimestamp: BN;

   // End block specified in attestation request.
   endBlock: BN;

   // Payment nonexistence is confirmed if there is no payment transaction (attestation of `Payment` type)
   // with correct `(destinationAddress, paymentReference, amount)` combination
   // and with transaction status 0 (success) or 2 (failure, receiver's fault). 
   // Note: if there exist only payment(s) with status 1 (failure, sender's fault) 
   // then payment nonexistence is still confirmed.
   destinationAddress: string;

   // The payment reference searched for.
   paymentReference: string;

   // The amount searched for.
   amount: BN;

   // The first (confirmed) block that gets checked. It is the block that has timestamp (median time) 
   // greater or equal to `endTimestamp - CHECK_WINDOW`. 
   // f-asset: check that `firstCheckBlock <= currentUnderlyingBlock` at the time of redemption request.
   firstCheckedBlock: BN;

   // Timestamp of the firstCheckedBlock.
   firstCheckedBlockTimestamp: BN;

   // The first confirmed block with `timestamp > endTimestamp` and `blockNumber  > endBlock`. 
   // f-asset: check that `firstOverflowBlock > last payment block` (`= currentUnderlyingBlock + blocksToPay`).
   firstOverflowBlock: BN;

   // Timestamp of the firstOverflowBlock.
   // f-asset: check that `firstOverflowBlockTimestamp > last payment timestamp` 
   //      (`= currentUnderlyingBlockTimestamp + time to pay`).
   firstOverflowBlockTimestamp: BN;
}
export type DHType = DHPayment | DHBalanceDecreasingTransaction | DHConfirmedBlockHeightExists | DHReferencedPaymentNonexistence;