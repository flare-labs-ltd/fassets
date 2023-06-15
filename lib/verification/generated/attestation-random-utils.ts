//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

import BN from "bn.js";
import Web3 from "web3";
import { randSol } from "../attestation-types/attestation-types-helpers";
import { ARPayment, ARBalanceDecreasingTransaction, ARConfirmedBlockHeightExists, ARReferencedPaymentNonexistence } from "./attestation-request-types";
import { DHPayment, DHBalanceDecreasingTransaction, DHConfirmedBlockHeightExists, DHReferencedPaymentNonexistence } from "./attestation-hash-types";
import { AttestationType } from "./attestation-types-enum";
import { SourceId } from "../sources/sources";

const toBN = Web3.utils.toBN;
const web3 = new Web3();

export function randomResponsePayment(roundId = 0) {
  const response = {
    stateConnectorRound: roundId,
    blockNumber: randSol({}, "blockNumber", "uint64") as BN,
    blockTimestamp: randSol({}, "blockTimestamp", "uint64") as BN,
    transactionHash: randSol({}, "transactionHash", "bytes32") as string,
    inUtxo: randSol({}, "inUtxo", "uint8") as BN,
    utxo: randSol({}, "utxo", "uint8") as BN,
    sourceAddressHash: randSol({}, "sourceAddressHash", "bytes32") as string,
    intendedSourceAddressHash: randSol({}, "intendedSourceAddressHash", "bytes32") as string,
    receivingAddressHash: randSol({}, "receivingAddressHash", "bytes32") as string,
    intendedReceivingAddressHash: randSol({}, "intendedReceivingAddressHash", "bytes32") as string,
    spentAmount: randSol({}, "spentAmount", "int256") as BN,
    intendedSpentAmount: randSol({}, "intendedSpentAmount", "int256") as BN,
    receivedAmount: randSol({}, "receivedAmount", "int256") as BN,
    intendedReceivedAmount: randSol({}, "intendedReceivedAmount", "int256") as BN,
    paymentReference: randSol({}, "paymentReference", "bytes32") as string,
    oneToOne: randSol({}, "oneToOne", "bool") as boolean,
    status: randSol({}, "status", "uint8") as BN,
  } as DHPayment;

  return response;
}

export function randomResponseBalanceDecreasingTransaction(roundId = 0) {
  const response = {
    stateConnectorRound: roundId,
    blockNumber: randSol({}, "blockNumber", "uint64") as BN,
    blockTimestamp: randSol({}, "blockTimestamp", "uint64") as BN,
    transactionHash: randSol({}, "transactionHash", "bytes32") as string,
    sourceAddressIndicator: randSol({}, "sourceAddressIndicator", "bytes32") as string,
    sourceAddressHash: randSol({}, "sourceAddressHash", "bytes32") as string,
    spentAmount: randSol({}, "spentAmount", "int256") as BN,
    paymentReference: randSol({}, "paymentReference", "bytes32") as string,
  } as DHBalanceDecreasingTransaction;

  return response;
}

export function randomResponseConfirmedBlockHeightExists(roundId = 0) {
  const response = {
    stateConnectorRound: roundId,
    blockNumber: randSol({}, "blockNumber", "uint64") as BN,
    blockTimestamp: randSol({}, "blockTimestamp", "uint64") as BN,
    numberOfConfirmations: randSol({}, "numberOfConfirmations", "uint8") as BN,
    lowestQueryWindowBlockNumber: randSol({}, "lowestQueryWindowBlockNumber", "uint64") as BN,
    lowestQueryWindowBlockTimestamp: randSol({}, "lowestQueryWindowBlockTimestamp", "uint64") as BN,
  } as DHConfirmedBlockHeightExists;

  return response;
}

export function randomResponseReferencedPaymentNonexistence(roundId = 0) {
  const response = {
    stateConnectorRound: roundId,
    deadlineBlockNumber: randSol({}, "deadlineBlockNumber", "uint64") as BN,
    deadlineTimestamp: randSol({}, "deadlineTimestamp", "uint64") as BN,
    destinationAddressHash: randSol({}, "destinationAddressHash", "bytes32") as string,
    paymentReference: randSol({}, "paymentReference", "bytes32") as string,
    amount: randSol({}, "amount", "uint128") as BN,
    lowerBoundaryBlockNumber: randSol({}, "lowerBoundaryBlockNumber", "uint64") as BN,
    lowerBoundaryBlockTimestamp: randSol({}, "lowerBoundaryBlockTimestamp", "uint64") as BN,
    firstOverflowBlockNumber: randSol({}, "firstOverflowBlockNumber", "uint64") as BN,
    firstOverflowBlockTimestamp: randSol({}, "firstOverflowBlockTimestamp", "uint64") as BN,
  } as DHReferencedPaymentNonexistence;

  return response;
}
//////////////////////////////////////////////////////////////
// Random attestation requests and resposes. Used for testing.
//////////////////////////////////////////////////////////////

export function getRandomResponseForType(attestationType: AttestationType, roundId = 0) {
  switch (attestationType) {
    case AttestationType.Payment:
      return randomResponsePayment(roundId);

    case AttestationType.BalanceDecreasingTransaction:
      return randomResponseBalanceDecreasingTransaction(roundId);

    case AttestationType.ConfirmedBlockHeightExists:
      return randomResponseConfirmedBlockHeightExists(roundId);

    case AttestationType.ReferencedPaymentNonexistence:
      return randomResponseReferencedPaymentNonexistence(roundId);

    default:
      throw new Error("Wrong attestation type.");
  }
}

export function getRandomRequest() {
  const ids = [1, 2, 3, 4];
  const randomAttestationType: AttestationType = ids[Math.floor(Math.random() * 4)];
  let sourceId: SourceId = -1;
  let sourceIds: SourceId[] = [];
  switch (randomAttestationType) {
    case AttestationType.Payment:
      sourceIds = [3, 0, 1, 2, 4];
      sourceId = sourceIds[Math.floor(Math.random() * 5)];
      return { attestationType: randomAttestationType, sourceId } as ARPayment;
    case AttestationType.BalanceDecreasingTransaction:
      sourceIds = [3, 0, 1, 2, 4];
      sourceId = sourceIds[Math.floor(Math.random() * 5)];
      return { attestationType: randomAttestationType, sourceId } as ARBalanceDecreasingTransaction;
    case AttestationType.ConfirmedBlockHeightExists:
      sourceIds = [3, 0, 1, 2, 4];
      sourceId = sourceIds[Math.floor(Math.random() * 5)];
      return { attestationType: randomAttestationType, sourceId } as ARConfirmedBlockHeightExists;
    case AttestationType.ReferencedPaymentNonexistence:
      sourceIds = [3, 0, 1, 2, 4];
      sourceId = sourceIds[Math.floor(Math.random() * 5)];
      return { attestationType: randomAttestationType, sourceId } as ARReferencedPaymentNonexistence;
    default:
      throw new Error("Invalid attestation type");
  }
}

export function getRandomRequestForAttestationTypeAndSourceId(attestationType: AttestationType, sourceId: SourceId) {
  switch (attestationType) {
    case AttestationType.Payment:
      return {
        attestationType,
        sourceId,
        messageIntegrityCode: Web3.utils.randomHex(32),
        id: Web3.utils.randomHex(32),
        blockNumber: toBN(Web3.utils.randomHex(4)),
        inUtxo: toBN(Web3.utils.randomHex(1)),
        utxo: toBN(Web3.utils.randomHex(1)),
      } as ARPayment;
    case AttestationType.BalanceDecreasingTransaction:
      return {
        attestationType,
        sourceId,
        messageIntegrityCode: Web3.utils.randomHex(32),
        id: Web3.utils.randomHex(32),
        blockNumber: toBN(Web3.utils.randomHex(4)),
        sourceAddressIndicator: Web3.utils.randomHex(32),
      } as ARBalanceDecreasingTransaction;
    case AttestationType.ConfirmedBlockHeightExists:
      return {
        attestationType,
        sourceId,
        messageIntegrityCode: Web3.utils.randomHex(32),
        blockNumber: toBN(Web3.utils.randomHex(4)),
        queryWindow: toBN(Web3.utils.randomHex(4)),
      } as ARConfirmedBlockHeightExists;
    case AttestationType.ReferencedPaymentNonexistence:
      return {
        attestationType,
        sourceId,
        messageIntegrityCode: Web3.utils.randomHex(32),
        minimalBlockNumber: toBN(Web3.utils.randomHex(4)),
        deadlineBlockNumber: toBN(Web3.utils.randomHex(4)),
        deadlineTimestamp: toBN(Web3.utils.randomHex(4)),
        destinationAddressHash: Web3.utils.randomHex(32),
        amount: toBN(Web3.utils.randomHex(16)),
        paymentReference: Web3.utils.randomHex(32),
      } as ARReferencedPaymentNonexistence;
    default:
      throw new Error("Invalid attestation type");
  }
}
