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
} from "./attestation-request-types";
import {
   DHPayment,
   DHBalanceDecreasingTransaction,
   DHConfirmedBlockHeightExists,
   DHReferencedPaymentNonexistence,
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
      utxo: randSol({}, "utxo", "uint8") as BN,
      sourceAddress: randSol({}, "sourceAddress", "bytes32") as string,
      receivingAddress: randSol({}, "receivingAddress", "bytes32") as string,
      paymentReference: randSol({}, "paymentReference", "bytes32") as string,
      spentAmount: randSol({}, "spentAmount", "int256") as BN,
      receivedAmount: randSol({}, "receivedAmount", "uint256") as BN,
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
      sourceAddress: randSol({}, "sourceAddress", "bytes32") as string,
      spentAmount: randSol({}, "spentAmount", "int256") as BN,
      paymentReference: randSol({}, "paymentReference", "bytes32") as string      
   } as DHBalanceDecreasingTransaction;
   return response;
}

export function randomResponseConfirmedBlockHeightExists() {
   let response = {
      blockNumber: randSol({}, "blockNumber", "uint64") as BN,
      blockTimestamp: randSol({}, "blockTimestamp", "uint64") as BN      
   } as DHConfirmedBlockHeightExists;
   return response;
}

export function randomResponseReferencedPaymentNonexistence() {
   let response = {
      endTimestamp: randSol({}, "endTimestamp", "uint64") as BN,
      endBlock: randSol({}, "endBlock", "uint64") as BN,
      destinationAddress: randSol({}, "destinationAddress", "bytes32") as string,
      paymentReference: randSol({}, "paymentReference", "bytes32") as string,
      amount: randSol({}, "amount", "uint128") as BN,
      firstCheckedBlock: randSol({}, "firstCheckedBlock", "uint64") as BN,
      firstCheckedBlockTimestamp: randSol({}, "firstCheckedBlockTimestamp", "uint64") as BN,
      firstOverflowBlock: randSol({}, "firstOverflowBlock", "uint64") as BN,
      firstOverflowBlockTimestamp: randSol({}, "firstOverflowBlockTimestamp", "uint64") as BN      
   } as DHReferencedPaymentNonexistence;
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
      default:
         throw new Error("Wrong attestation type.")
  }   
}

export function getRandomRequest() {  
   let ids = [1, 2, 3, 4];
   let randomAttestationType: AttestationType = ids[Math.floor(Math.random()*4)];
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
            blockNumber: toBN(Web3.utils.randomHex(4)),
            utxo: toBN(Web3.utils.randomHex(1)),
            inUtxo: toBN(Web3.utils.randomHex(1)),
            id: Web3.utils.randomHex(32),
            dataAvailabilityProof: Web3.utils.randomHex(32)
         } as ARPayment;
      case AttestationType.BalanceDecreasingTransaction:
         return {
            attestationType,
            sourceId,
            blockNumber: toBN(Web3.utils.randomHex(4)),
            inUtxo: toBN(Web3.utils.randomHex(1)),
            id: Web3.utils.randomHex(32),
            dataAvailabilityProof: Web3.utils.randomHex(32)
         } as ARBalanceDecreasingTransaction;
      case AttestationType.ConfirmedBlockHeightExists:
         return {
            attestationType,
            sourceId,
            blockNumber: toBN(Web3.utils.randomHex(4)),
            dataAvailabilityProof: Web3.utils.randomHex(32)
         } as ARConfirmedBlockHeightExists;
      case AttestationType.ReferencedPaymentNonexistence:
         return {
            attestationType,
            sourceId,
            endTimestamp: toBN(Web3.utils.randomHex(4)),
            endBlock: toBN(Web3.utils.randomHex(4)),
            destinationAddress: Web3.utils.randomHex(32),
            amount: toBN(Web3.utils.randomHex(16)),
            paymentReference: Web3.utils.randomHex(32),
            overflowBlock: toBN(Web3.utils.randomHex(4)),
            dataAvailabilityProof: Web3.utils.randomHex(32)
         } as ARReferencedPaymentNonexistence;
      default:
         throw new Error("Invalid attestation type");
   }
}
