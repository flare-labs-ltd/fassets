//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

import Web3 from "web3";
import { 
   ARPayment,
   ARBalanceDecreasingTransaction,
   ARConfirmedBlockHeightExists,
   ARReferencedPaymentNonexistence,
   ARType 
} from "./attestation-request-types";
import {
   DHPayment,
   DHBalanceDecreasingTransaction,
   DHConfirmedBlockHeightExists,
   DHReferencedPaymentNonexistence,
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
         "uint8",		// utxo
         "bytes32",		// sourceAddress
         "bytes32",		// receivingAddress
         "bytes32",		// paymentReference
         "int256",		// spentAmount
         "uint256",		// receivedAmount
         "bool",		// oneToOne
         "uint8",		// status
      ],
      [
         request.attestationType,
         request.sourceId,
         response.blockNumber,
         response.blockTimestamp,
         response.transactionHash,
         response.utxo,
         response.sourceAddress,
         response.receivingAddress,
         response.paymentReference,
         response.spentAmount,
         response.receivedAmount,
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
         "bytes32",		// sourceAddress
         "int256",		// spentAmount
         "bytes32",		// paymentReference
      ],
      [
         request.attestationType,
         request.sourceId,
         response.blockNumber,
         response.blockTimestamp,
         response.transactionHash,
         response.sourceAddress,
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
      ],
      [
         request.attestationType,
         request.sourceId,
         response.blockNumber,
         response.blockTimestamp
      ]
   );
   return web3.utils.soliditySha3(encoded)!;
}

export function hashReferencedPaymentNonexistence(request: ARReferencedPaymentNonexistence, response: DHReferencedPaymentNonexistence) {
   let encoded = web3.eth.abi.encodeParameters(
      [
         "uint16",		// attestationType
         "uint32",		// sourceId
         "uint64",		// endTimestamp
         "uint64",		// endBlock
         "bytes32",		// destinationAddress
         "bytes32",		// paymentReference
         "uint128",		// amount
         "uint64",		// firstCheckedBlock
         "uint64",		// firstCheckedBlockTimestamp
         "uint64",		// firstOverflowBlock
         "uint64",		// firstOverflowBlockTimestamp
      ],
      [
         request.attestationType,
         request.sourceId,
         response.endTimestamp,
         response.endBlock,
         response.destinationAddress,
         response.paymentReference,
         response.amount,
         response.firstCheckedBlock,
         response.firstCheckedBlockTimestamp,
         response.firstOverflowBlock,
         response.firstOverflowBlockTimestamp
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
      default:
         throw new Error("Invalid attestation type");
   }
}
