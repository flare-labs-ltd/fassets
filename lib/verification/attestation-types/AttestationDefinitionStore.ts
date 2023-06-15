import Web3 from "web3";
import { ARBase } from "../generated/attestation-request-types";
import { ATT_BYTES, AttestationTypeScheme, REQUEST_BASE_DEFINITIONS, RESPONSE_BASE_DEFINITIONS, SupportedSolidityType } from "./attestation-types";
import { readAttestationTypeSchemes } from "./attestation-types-helpers";
import {
  AttestationRequestEncodeError,
  toUnprefixedBytes,
  AttestationRequestParseError,
  unPrefix0x,
  fromUnprefixedBytes,
  assertEqualsByScheme,
} from "./attestation-types-utils";

/**
 * Reads attestation type definition schemes and provide methods to encode, decode, compare and hash attestation requests and attestation responses.
 */
export class AttestationDefinitionStore {
  definitions!: AttestationTypeScheme[];
  web3!: Web3;

  async initialize() {
    this.web3 = new Web3();
    this.definitions = await readAttestationTypeSchemes();
  }

  getDefinitionForAttestationType(attestationTypeId: number) {
    return this.definitions.find((definition) => definition.id === attestationTypeId);
  }

  /**
   * Calculates the hash of a @param response to the attestation @param request with added @param salt
   * @param request
   * @param response
   * @param salt
   * @returns
   */
  dataHash(request: ARBase, response: any, salt?: string): string | null | undefined {
    let definition = this.getDefinitionForAttestationType(request.attestationType);
    if (!definition) {
      return;
    }
    const types: SupportedSolidityType[] = [
      "uint16", // attestationType
      "uint32", // sourceId,
      ...[...RESPONSE_BASE_DEFINITIONS, ...definition.dataHashDefinition].map((def) => def.type),
    ];
    const values = [
      request.attestationType,
      request.sourceId,
      ...[...RESPONSE_BASE_DEFINITIONS, ...definition.dataHashDefinition].map((def) => response[def.key]),
    ];
    // All values must be defined in response
    if (values.find((value) => value === undefined)) {
      return;
    }
    if (salt) {
      types.push("string");
      values.push(salt);
    }
    const encoded = this.web3.eth.abi.encodeParameters(types, values);

    return this.web3.utils.soliditySha3(encoded);
  }

  /**
   * Encodes the attestation @request into a byte string with respect to its attestation type
   */
  encodeRequest(request: ARBase): string {
    let definition = this.getDefinitionForAttestationType(request.attestationType);
    if (!definition) {
      throw new AttestationRequestEncodeError(`Unsupported attestation type id: ${request.attestationType}`);
    }
    let bytes = "0x";
    for (let def of [...REQUEST_BASE_DEFINITIONS, ...definition.request]) {
      const value = request[def.key as keyof ARBase];
      if (value === undefined) {
        throw new AttestationRequestEncodeError(`Missing key ${def.key} in request`);
      }
      bytes += toUnprefixedBytes(value, def.type, def.size, def.key);
    }
    return bytes;
  }

  /**
   * Parses an attestation request from byte string @param bytes to object of type ARType
   */
  parseRequest<AR extends ARBase>(bytes: string): AR {
    if (!bytes) {
      throw new AttestationRequestParseError("Empty attestation request");
    }
    if (bytes.length < 2 + ATT_BYTES * 2) {
      throw new AttestationRequestParseError("Incorrectly formatted attestation request");
    }
    let attestationType = parseInt(bytes.slice(0, 2 + ATT_BYTES * 2), 16);
    if (isNaN(attestationType)) {
      throw new AttestationRequestParseError("Cannot extract attestation type");
    }
    let definition = this.getDefinitionForAttestationType(attestationType);
    if (!definition) {
      throw new AttestationRequestParseError(`Unsupported attestation type id: ${attestationType}`);
    }
    const totalLength = [...REQUEST_BASE_DEFINITIONS, ...definition.request].map((item) => item.size * 2).reduce((a, b) => a + b);
    const input = unPrefix0x(bytes);
    if (input.length != totalLength) {
      throw new AttestationRequestParseError("Incorrectly formatted attestation request");
    }
    let start = 0;
    let result: any = {};
    for (const item of [...REQUEST_BASE_DEFINITIONS, ...definition.request]) {
      const end = start + item.size * 2;
      result[item.key] = fromUnprefixedBytes(input.slice(start, end), item.type, item.size);
      start = end;
    }
    return result as AR;
  }

  /**
   * Checks whether @param request1 and @param request2 are querying the same thing
   */
  equalsRequest(request1: ARBase, request2: ARBase): boolean {
    if (request1.attestationType != request2.attestationType) {
      return false;
    }
    const attestationType = request1.attestationType;
    let definition = this.getDefinitionForAttestationType(attestationType);
    if (!definition) {
      throw new AttestationRequestEncodeError(`Unsupported attestation type id: ${attestationType}`);
    }

    for (const item of [...REQUEST_BASE_DEFINITIONS, ...definition.request]) {
      const key = item.key as keyof ARBase;
      if (!assertEqualsByScheme(request1[key], request2[key], item.type)) {
        return false;
      }
    }
    return true;
  }
}
