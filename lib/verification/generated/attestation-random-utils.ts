//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

import BN from "bn.js";
import Web3 from "web3";
import { randSol } from "../attestation-types/attestation-types-helpers";
import { 
   ARPayment,
   ARBalanceDecreasingTransaction,
   ARConfirmedBlockHeightExists,
   ARReferencedPaymentNonexistence,
   ARTrustlineIssuance,
} from "./attestation-request-types";
import {
   DHPayment,
   DHBalanceDecreasingTransaction,
   DHConfirmedBlockHeightExists,
   DHReferencedPaymentNonexistence,
   DHTrustlineIssuance,
} from "./attestation-hash-types";
import { AttestationType } from "./attestation-types-enum";
import { SourceId } from "../sources/sources";

const toBN = Web3.utils.toBN;
const web3 = new Web3();

export function randomResponsePayment() {
   let response = {
      blockNumber: randSol({}, "blockNumber", "uint64") as BN,
      blockTimestamp: randSol({}, "blockTimestamp", "uint64") as BN,
      transactionHash: randSol({}, "transactionHash", "bytes32") as string,
      inUtxo: randSol({}, "inUtxo", "uint8") as BN,
      utxo: randSol({}, "utxo", "uint8") as BN,
      sourceAddressHash: randSol({}, "sourceAddressHash", "bytes32") as string,
      receivingAddressHash: randSol({}, "receivingAddressHash", "bytes32") as string,
      spentAmount: randSol({}, "spentAmount", "int256") as BN,
      receivedAmount: randSol({}, "receivedAmount", "int256") as BN,
      paymentReference: randSol({}, "paymentReference", "bytes32") as string,
      oneToOne: randSol({}, "oneToOne", "bool") as boolean,
      status: randSol({}, "status", "uint8") as BN      
   } as DHPayment;
   return response;
}

export function randomResponseBalanceDecreasingTransaction() {
   let response = {
      blockNumber: randSol({}, "blockNumber", "uint64") as BN,
      blockTimestamp: randSol({}, "blockTimestamp", "uint64") as BN,
      transactionHash: randSol({}, "transactionHash", "bytes32") as string,
      inUtxo: randSol({}, "inUtxo", "uint8") as BN,
      sourceAddressHash: randSol({}, "sourceAddressHash", "bytes32") as string,
      spentAmount: randSol({}, "spentAmount", "int256") as BN,
      paymentReference: randSol({}, "paymentReference", "bytes32") as string      
   } as DHBalanceDecreasingTransaction;
   return response;
}

export function randomResponseConfirmedBlockHeightExists() {
   let response = {
      blockNumber: randSol({}, "blockNumber", "uint64") as BN,
      blockTimestamp: randSol({}, "blockTimestamp", "uint64") as BN,
      numberOfConfirmations: randSol({}, "numberOfConfirmations", "uint8") as BN,
      averageBlockProductionTimeMs: randSol({}, "averageBlockProductionTimeMs", "uint64") as BN,
      lowestQueryWindowBlockNumber: randSol({}, "lowestQueryWindowBlockNumber", "uint64") as BN,
      lowestQueryWindowBlockTimestamp: randSol({}, "lowestQueryWindowBlockTimestamp", "uint64") as BN      
   } as DHConfirmedBlockHeightExists;
   return response;
}

export function randomResponseReferencedPaymentNonexistence() {
   let response = {
      deadlineBlockNumber: randSol({}, "deadlineBlockNumber", "uint64") as BN,
      deadlineTimestamp: randSol({}, "deadlineTimestamp", "uint64") as BN,
      destinationAddressHash: randSol({}, "destinationAddressHash", "bytes32") as string,
      paymentReference: randSol({}, "paymentReference", "bytes32") as string,
      amount: randSol({}, "amount", "uint128") as BN,
      lowerBoundaryBlockNumber: randSol({}, "lowerBoundaryBlockNumber", "uint64") as BN,
      lowerBoundaryBlockTimestamp: randSol({}, "lowerBoundaryBlockTimestamp", "uint64") as BN,
      firstOverflowBlockNumber: randSol({}, "firstOverflowBlockNumber", "uint64") as BN,
      firstOverflowBlockTimestamp: randSol({}, "firstOverflowBlockTimestamp", "uint64") as BN      
   } as DHReferencedPaymentNonexistence;
   return response;
}

export function randomResponseTrustlineIssuance() {
   let response = {
      tokenCurrencyCode: randSol({}, "tokenCurrencyCode", "bytes32") as string,
      tokenValueNominator: randSol({}, "tokenValueNominator", "uint256") as BN,
      tokenValueDenominator: randSol({}, "tokenValueDenominator", "uint256") as BN,
      tokenIssuer: randSol({}, "tokenIssuer", "bytes32") as string      
   } as DHTrustlineIssuance;
   return response;
}
//////////////////////////////////////////////////////////////
// Random attestation requests and resposes. Used for testing.
//////////////////////////////////////////////////////////////

export function getRandomResponseForType(attestationType: AttestationType) {
   switch(attestationType) {
      case AttestationType.Payment:
         return randomResponsePayment();
      case AttestationType.BalanceDecreasingTransaction:
         return randomResponseBalanceDecreasingTransaction();
      case AttestationType.ConfirmedBlockHeightExists:
         return randomResponseConfirmedBlockHeightExists();
      case AttestationType.ReferencedPaymentNonexistence:
         return randomResponseReferencedPaymentNonexistence();
      case AttestationType.TrustlineIssuance:
         return randomResponseTrustlineIssuance();
      default:
         throw new Error("Wrong attestation type.")
  }   
}

export function getRandomRequest() {  
   let ids = [1, 2, 3, 4, 5];
   let randomAttestationType: AttestationType = ids[Math.floor(Math.random()*5)];
   let sourceId: SourceId = -1;
   let sourceIds: SourceId[] = [];
   switch(randomAttestationType) {
      case AttestationType.Payment:
         sourceIds = [3,0,1,2,4];
         sourceId = sourceIds[Math.floor(Math.random()*5)];
         return {attestationType: randomAttestationType, sourceId } as ARPayment;
      case AttestationType.BalanceDecreasingTransaction:
         sourceIds = [3,0,1,2,4];
         sourceId = sourceIds[Math.floor(Math.random()*5)];
         return {attestationType: randomAttestationType, sourceId } as ARBalanceDecreasingTransaction;
      case AttestationType.ConfirmedBlockHeightExists:
         sourceIds = [3,0,1,2,4];
         sourceId = sourceIds[Math.floor(Math.random()*5)];
         return {attestationType: randomAttestationType, sourceId } as ARConfirmedBlockHeightExists;
      case AttestationType.ReferencedPaymentNonexistence:
         sourceIds = [3,0,1,2,4];
         sourceId = sourceIds[Math.floor(Math.random()*5)];
         return {attestationType: randomAttestationType, sourceId } as ARReferencedPaymentNonexistence;
      case AttestationType.TrustlineIssuance:
         sourceIds = [3];
         sourceId = sourceIds[Math.floor(Math.random()*1)];
         return {attestationType: randomAttestationType, sourceId } as ARTrustlineIssuance;
      default:
         throw new Error("Invalid attestation type");
   }
}

export function getRandomRequestForAttestationTypeAndSourceId (
   attestationType: AttestationType,
   sourceId: SourceId
) {  
   switch(attestationType) {
      case AttestationType.Payment:
         return {
            attestationType,
            sourceId,
            upperBoundProof: Web3.utils.randomHex(32),
            id: Web3.utils.randomHex(32),
            inUtxo: toBN(Web3.utils.randomHex(1)),
            utxo: toBN(Web3.utils.randomHex(1))
         } as ARPayment;
      case AttestationType.BalanceDecreasingTransaction:
         return {
            attestationType,
            sourceId,
            upperBoundProof: Web3.utils.randomHex(32),
            id: Web3.utils.randomHex(32),
            inUtxo: toBN(Web3.utils.randomHex(1))
         } as ARBalanceDecreasingTransaction;
      case AttestationType.ConfirmedBlockHeightExists:
         return {
            attestationType,
            sourceId,
            upperBoundProof: Web3.utils.randomHex(32)
         } as ARConfirmedBlockHeightExists;
      case AttestationType.ReferencedPaymentNonexistence:
         return {
            attestationType,
            sourceId,
            upperBoundProof: Web3.utils.randomHex(32),
            deadlineBlockNumber: toBN(Web3.utils.randomHex(4)),
            deadlineTimestamp: toBN(Web3.utils.randomHex(4)),
            destinationAddressHash: Web3.utils.randomHex(32),
            amount: toBN(Web3.utils.randomHex(16)),
            paymentReference: Web3.utils.randomHex(32)
         } as ARReferencedPaymentNonexistence;
      case AttestationType.TrustlineIssuance:
         return {
            attestationType,
            sourceId,
            upperBoundProof: Web3.utils.randomHex(32),
            issuerAccount: Web3.utils.randomHex(20)
         } as ARTrustlineIssuance;
      default:
         throw new Error("Invalid attestation type");
   }
}
