//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

export enum AttestationType {
  Payment = 1,
  BalanceDecreasingTransaction = 2,
  ConfirmedBlockHeightExists = 3,
  ReferencedPaymentNonexistence = 4,
}
/**
 * Returns attestation type name for an attestation type enum
 * @param attestationType: number
 */
export function getAttestationTypeName(attestationType: number): string | null {
  if (attestationType == null || !AttestationType[attestationType]) {
    return null;
  }
  return AttestationType[attestationType];
}
