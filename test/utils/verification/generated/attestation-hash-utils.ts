//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

import Web3 from "web3";
import { 
   ARPayment,
   ARBalanceDecreasingTransaction,
   ARConfirmedBlockHeightExists,
   ARReferencedPaymentNonexistence,
   ARTrustlineIssuance,
   ARType 
} from "./attestation-request-types";
import {
   DHPayment,
   DHBalanceDecreasingTransaction,
   DHConfirmedBlockHeightExists,
   DHReferencedPaymentNonexistence,
   DHTrustlineIssuance,
   DHType 
} from "./attestation-hash-types";
import { AttestationType } from "./attestation-types-enum";

const web3 = new Web3();
//////////////////////////////////////////////////////////////
// Hash functions for requests and responses for particular 
// Attestation types.
//////////////////////////////////////////////////////////////

export function hashPayment(request: ARPayment, response: DHPayment) {
   let encoded = web3.eth.abi.encodeParameters(
      [
         "uint16",		// attestationType
         "uint32",		// sourceId
         "uint64",		// blockNumber
         "uint64",		// blockTimestamp
         "bytes32",		// transactionHash
         "uint8",		// inUtxo
         "uint8",		// utxo
         "bytes32",		// sourceAddressHash
         "bytes32",		// receivingAddressHash
         "int256",		// spentAmount
         "int256",		// receivedAmount
         "bytes32",		// paymentReference
         "bool",		// oneToOne
         "uint8",		// status
      ],
      [
         request.attestationType,
         request.sourceId,
         response.blockNumber,
         response.blockTimestamp,
         response.transactionHash,
         response.inUtxo,
         response.utxo,
         response.sourceAddressHash,
         response.receivingAddressHash,
         response.spentAmount,
         response.receivedAmount,
         response.paymentReference,
         response.oneToOne,
         response.status
      ]
   );
   return web3.utils.soliditySha3(encoded)!;
}

export function hashBalanceDecreasingTransaction(request: ARBalanceDecreasingTransaction, response: DHBalanceDecreasingTransaction) {
   let encoded = web3.eth.abi.encodeParameters(
      [
         "uint16",		// attestationType
         "uint32",		// sourceId
         "uint64",		// blockNumber
         "uint64",		// blockTimestamp
         "bytes32",		// transactionHash
         "uint8",		// inUtxo
         "bytes32",		// sourceAddressHash
         "int256",		// spentAmount
         "bytes32",		// paymentReference
      ],
      [
         request.attestationType,
         request.sourceId,
         response.blockNumber,
         response.blockTimestamp,
         response.transactionHash,
         response.inUtxo,
         response.sourceAddressHash,
         response.spentAmount,
         response.paymentReference
      ]
   );
   return web3.utils.soliditySha3(encoded)!;
}

export function hashConfirmedBlockHeightExists(request: ARConfirmedBlockHeightExists, response: DHConfirmedBlockHeightExists) {
   let encoded = web3.eth.abi.encodeParameters(
      [
         "uint16",		// attestationType
         "uint32",		// sourceId
         "uint64",		// blockNumber
         "uint64",		// blockTimestamp
         "uint8",		// numberOfConfirmations
         "uint64",		// averageBlockProductionTimeMs
         "uint64",		// lowestQueryWindowBlockNumber
         "uint64",		// lowestQueryWindowBlockTimestamp
      ],
      [
         request.attestationType,
         request.sourceId,
         response.blockNumber,
         response.blockTimestamp,
         response.numberOfConfirmations,
         response.averageBlockProductionTimeMs,
         response.lowestQueryWindowBlockNumber,
         response.lowestQueryWindowBlockTimestamp
      ]
   );
   return web3.utils.soliditySha3(encoded)!;
}

export function hashReferencedPaymentNonexistence(request: ARReferencedPaymentNonexistence, response: DHReferencedPaymentNonexistence) {
   let encoded = web3.eth.abi.encodeParameters(
      [
         "uint16",		// attestationType
         "uint32",		// sourceId
         "uint64",		// deadlineBlockNumber
         "uint64",		// deadlineTimestamp
         "bytes32",		// destinationAddressHash
         "bytes32",		// paymentReference
         "uint128",		// amount
         "uint64",		// lowerBoundaryBlockNumber
         "uint64",		// lowerBoundaryBlockTimestamp
         "uint64",		// firstOverflowBlockNumber
         "uint64",		// firstOverflowBlockTimestamp
      ],
      [
         request.attestationType,
         request.sourceId,
         response.deadlineBlockNumber,
         response.deadlineTimestamp,
         response.destinationAddressHash,
         response.paymentReference,
         response.amount,
         response.lowerBoundaryBlockNumber,
         response.lowerBoundaryBlockTimestamp,
         response.firstOverflowBlockNumber,
         response.firstOverflowBlockTimestamp
      ]
   );
   return web3.utils.soliditySha3(encoded)!;
}

export function hashTrustlineIssuance(request: ARTrustlineIssuance, response: DHTrustlineIssuance) {
   let encoded = web3.eth.abi.encodeParameters(
      [
         "uint16",		// attestationType
         "uint32",		// sourceId
         "bytes32",		// tokenCurrencyCode
         "uint256",		// tokenValueNominator
         "uint256",		// tokenValueDenominator
         "bytes32",		// tokenIssuer
      ],
      [
         request.attestationType,
         request.sourceId,
         response.tokenCurrencyCode,
         response.tokenValueNominator,
         response.tokenValueDenominator,
         response.tokenIssuer
      ]
   );
   return web3.utils.soliditySha3(encoded)!;
}

export function dataHash(request: ARType, response: DHType) {  
   switch(request.attestationType) {
      case AttestationType.Payment:
         return hashPayment(request as ARPayment, response as DHPayment);
      case AttestationType.BalanceDecreasingTransaction:
         return hashBalanceDecreasingTransaction(request as ARBalanceDecreasingTransaction, response as DHBalanceDecreasingTransaction);
      case AttestationType.ConfirmedBlockHeightExists:
         return hashConfirmedBlockHeightExists(request as ARConfirmedBlockHeightExists, response as DHConfirmedBlockHeightExists);
      case AttestationType.ReferencedPaymentNonexistence:
         return hashReferencedPaymentNonexistence(request as ARReferencedPaymentNonexistence, response as DHReferencedPaymentNonexistence);
      case AttestationType.TrustlineIssuance:
         return hashTrustlineIssuance(request as ARTrustlineIssuance, response as DHTrustlineIssuance);
      default:
         throw new Error("Invalid attestation type");
   }
}
