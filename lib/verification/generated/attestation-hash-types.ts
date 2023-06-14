//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

import BN from "bn.js";

export class DHPayment {
  /**
   * Merkle proof (a list of 32-byte hex hashes).
   */
  merkleProof?: string[];

  /**
   * Round id in which the attestation request was validated.
   */
  stateConnectorRound!: number;

  /**
   * Number of the transaction block on the underlying chain.
   */
  blockNumber!: BN;

  /**
   * Timestamp of the transaction block on the underlying chain.
   */
  blockTimestamp!: BN;

  /**
   * Hash of the transaction on the underlying chain.
   */
  transactionHash!: string;

  /**
   * Index of the transaction input indicating source address on UTXO chains, 0 on non-UTXO chains.
   */
  inUtxo!: BN;

  /**
   * Output index for a transaction with multiple outputs on UTXO chains, 0 on non-UTXO chains.
   * The same as in the 'utxo' parameter from the request.
   */
  utxo!: BN;

  /**
   * Standardized address hash of the source address viewed as a string
   * (the one indicated by the 'inUtxo' parameter for UTXO blockchains).
   */
  sourceAddressHash!: string;

  /**
   * Standardized address hash of the intended source address viewed as a string
   * (the one indicated by the 'inUtxo' parameter for UTXO blockchains).
   */
  intendedSourceAddressHash!: string;

  /**
   * Standardized address hash of the receiving address as a string
   * (the one indicated by the 'utxo' parameter for UTXO blockchains).
   */
  receivingAddressHash!: string;

  /**
   * Standardized address hash of the intended receiving address as a string
   * (the one indicated by the 'utxo' parameter for UTXO blockchains).
   */
  intendedReceivingAddressHash!: string;

  /**
   * The amount that went out of the source address, in the smallest underlying units.
   * In non-UTXO chains it includes both payment value and fee (gas).
   * Calculation for UTXO chains depends on the existence of standardized payment reference.
   * If it exists, it is calculated as 'outgoing_amount - returned_amount' and can be negative.
   * If the standardized payment reference does not exist, then it is just the spent amount
   * on the input indicated by 'inUtxo'.
   */
  spentAmount!: BN;

  /**
   * The amount that was intended to go out of the source address, in the smallest underlying units.
   * If the transaction status is successful the value matches 'spentAmount'.
   * If the transaction status is not successful, the value is the amount that was intended
   * to be spent by the source address.
   */
  intendedSpentAmount!: BN;

  /**
   * The amount received to the receiving address, in smallest underlying units.
   * Can be negative in UTXO chains.
   */
  receivedAmount!: BN;

  /**
   * The intended amount to be received by the receiving address, in smallest underlying units.
   * For transactions that are successful, this is the same as 'receivedAmount'.
   * If the transaction status is not successful, the value is the amount that was intended
   * to be received by the receiving address.
   */
  intendedReceivedAmount!: BN;

  /**
   * Standardized payment reference, if it exists, 0 otherwise.
   */
  paymentReference!: string;

  /**
   * 'true' if the transaction has exactly one source address and
   * exactly one receiving address (different from source).
   */
  oneToOne!: boolean;

  /**
   * Transaction success status, can have 3 values:
   *   - 0 - Success
   *   - 1 - Failure due to sender (this is the default failure)
   *   - 2 - Failure due to receiver (bad destination address)
   */
  status!: BN;
}

export class DHBalanceDecreasingTransaction {
  /**
   * Merkle proof (a list of 32-byte hex hashes).
   */
  merkleProof?: string[];

  /**
   * Round id in which the attestation request was validated.
   */
  stateConnectorRound!: number;

  /**
   * Number of the transaction block on the underlying chain.
   */
  blockNumber!: BN;

  /**
   * Timestamp of the transaction block on the underlying chain.
   */
  blockTimestamp!: BN;

  /**
   * Hash of the transaction on the underlying chain.
   */
  transactionHash!: string;

  /**
   * Either standardized hash of a source address or UTXO vin index in hex format
   * (as provided in the request).
   */
  sourceAddressIndicator!: string;

  /**
   * Standardized hash of the source address viewed as a string (the one indicated
   *   by the 'sourceAddressIndicator' (vin input index) parameter for UTXO blockchains).
   */
  sourceAddressHash!: string;

  /**
   * The amount that went out of the source address, in the smallest underlying units.
   * In non-UTXO chains it includes both payment value and fee (gas).
   * Calculation for UTXO chains depends on the existence of standardized payment reference.
   * If it exists, it is calculated as 'total_outgoing_amount - returned_amount' from the address
   * indicated by 'sourceAddressIndicator', and can be negative.
   * If the standardized payment reference does not exist, then it is just the spent amount
   * on the input indicated by 'sourceAddressIndicator'.
   */
  spentAmount!: BN;

  /**
   * Standardized payment reference, if it exists, 0 otherwise.
   */
  paymentReference!: string;
}

export class DHConfirmedBlockHeightExists {
  /**
   * Merkle proof (a list of 32-byte hex hashes).
   */
  merkleProof?: string[];

  /**
   * Round id in which the attestation request was validated.
   */
  stateConnectorRound!: number;

  /**
   * Number of the highest confirmed block that was proved to exist.
   */
  blockNumber!: BN;

  /**
   * Timestamp of the confirmed block that was proved to exist.
   */
  blockTimestamp!: BN;

  /**
   * Number of confirmations for the blockchain.
   */
  numberOfConfirmations!: BN;

  /**
   * Lowest query window block number.
   */
  lowestQueryWindowBlockNumber!: BN;

  /**
   * Lowest query window block timestamp.
   */
  lowestQueryWindowBlockTimestamp!: BN;
}

export class DHReferencedPaymentNonexistence {
  /**
   * Merkle proof (a list of 32-byte hex hashes).
   */
  merkleProof?: string[];

  /**
   * Round id in which the attestation request was validated.
   */
  stateConnectorRound!: number;

  /**
   * Deadline block number specified in the attestation request.
   */
  deadlineBlockNumber!: BN;

  /**
   * Deadline timestamp specified in the attestation request.
   */
  deadlineTimestamp!: BN;

  /**
   * Standardized address hash of the destination address searched for.
   */
  destinationAddressHash!: string;

  /**
   * The payment reference searched for.
   */
  paymentReference!: string;

  /**
   * The minimal amount intended to be paid to the destination address.
   * The actual amount should match or exceed this value.
   */
  amount!: BN;

  /**
   * The first confirmed block that gets checked. It is exactly 'minimalBlockNumber' from the request.
   */
  lowerBoundaryBlockNumber!: BN;

  /**
   * Timestamp of the 'lowerBoundaryBlockNumber'.
   */
  lowerBoundaryBlockTimestamp!: BN;

  /**
   * The first (lowest) confirmed block with 'timestamp > deadlineTimestamp'
   * and 'blockNumber  > deadlineBlockNumber'.
   */
  firstOverflowBlockNumber!: BN;

  /**
   * Timestamp of the firstOverflowBlock.
   */
  firstOverflowBlockTimestamp!: BN;
}
export type DHType = DHPayment | DHBalanceDecreasingTransaction | DHConfirmedBlockHeightExists | DHReferencedPaymentNonexistence;
export const DHTypeArray = [DHPayment, DHBalanceDecreasingTransaction, DHConfirmedBlockHeightExists, DHReferencedPaymentNonexistence];
