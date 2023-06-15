import { AttestationType } from "../generated/attestation-types-enum";
import { SourceId } from "../sources/sources";
/**
 * Helper type to configure which verifier types should be generated for
 * which source and attestation types.
 */
export interface VerifierTypeGenerationConfig {
  sourceId: SourceId;
  attestationTypes: AttestationType[];
}

/**
 * Configuration of the verifier types for which specific code should be generated to
 * support verifier server implementations.
 */
export const VERIFIER_TYPES_GENERATION_CONFIG: VerifierTypeGenerationConfig[] = [
  {
    sourceId: SourceId.BTC,
    attestationTypes: [
      AttestationType.Payment,
      AttestationType.BalanceDecreasingTransaction,
      AttestationType.ConfirmedBlockHeightExists,
      AttestationType.ReferencedPaymentNonexistence,
    ],
  },
  {
    sourceId: SourceId.DOGE,
    attestationTypes: [
      AttestationType.Payment,
      AttestationType.BalanceDecreasingTransaction,
      AttestationType.ConfirmedBlockHeightExists,
      AttestationType.ReferencedPaymentNonexistence,
    ],
  },
  {
    sourceId: SourceId.XRP,
    attestationTypes: [
      AttestationType.Payment,
      AttestationType.BalanceDecreasingTransaction,
      AttestationType.ConfirmedBlockHeightExists,
      AttestationType.ReferencedPaymentNonexistence,
    ],
  },
  {
    sourceId: SourceId.ALGO,
    attestationTypes: [
      AttestationType.Payment,
      AttestationType.BalanceDecreasingTransaction,
      AttestationType.ConfirmedBlockHeightExists,
      AttestationType.ReferencedPaymentNonexistence,
    ],
  },
  {
    sourceId: SourceId.LTC,
    attestationTypes: [
      AttestationType.Payment,
      AttestationType.BalanceDecreasingTransaction,
      AttestationType.ConfirmedBlockHeightExists,
      AttestationType.ReferencedPaymentNonexistence,
    ],
  },
];

/**
 * Helper class to check if the verifier type generation config contains a source or attestation type.
 * Also checks if a given source has an attestation type for it and vice versa.
 * This is used to determine if the code generation should be performed for a given source and attestation type.
 * @see VERIFIER_TYPES_GENERATION_CONFIG
 */
export class VerifierTypeConfigGenerationChecker {
  sourceToTypes = new Map<SourceId, Set<AttestationType>>();
  typesToSources = new Map<AttestationType, Set<SourceId>>();

  constructor() {
    for (const config of VERIFIER_TYPES_GENERATION_CONFIG) {
      for (const type of config.attestationTypes) {
        if (!this.typesToSources.has(type)) {
          this.typesToSources.set(type, new Set());
        }
        this.typesToSources.get(type)!.add(config.sourceId);
      }
      this.sourceToTypes.set(config.sourceId, new Set(config.attestationTypes));
    }
  }

  /**
   * Determine if the verifier type generation config contains a source.
   * @param sourceId
   * @returns
   */
  hasSource(sourceId: SourceId): boolean {
    return this.sourceToTypes.has(sourceId);
  }

  /**
   * Determine if the verifier type generation config contains an attestation type.
   * @param type
   * @returns
   */
  hasAttestationType(type: AttestationType): boolean {
    return this.typesToSources.has(type);
  }

  /**
   * For a given source, does the verifier type generation config contain an attestation type for it?
   * @param sourceId
   * @param type
   * @returns
   */
  givenSourceHasAttestationTypeForSource(sourceId: SourceId, type: AttestationType): boolean {
    return this.hasSource(sourceId) && this.sourceToTypes.get(sourceId)!.has(type);
  }

  /**
   * For a given attestation type, does the verifier type generation config contain a source for it?
   * @param type
   * @param sourceId
   * @returns
   */
  givenAttestationTypeHasSourceForAttestationType(type: AttestationType, sourceId: SourceId): boolean {
    return this.hasAttestationType(type) && this.typesToSources.get(type)!.has(sourceId);
  }
}
