import BN from "bn.js";
import Web3 from "web3";

/**
 * There are several variants for hashing sequences in Merkle trees in cases when there is odd number of hashes on some level.
 * - Bitcoin hashes remaining hash with itself
 * - Ethereum community was considering this:
 *     https://github.com/proofchains/python-proofmarshal/blob/efe9b58921b9a306f2b3552c30b84e1043ab866f/proofmarshal/mmr.py#L96
 * - This review shows various options and in particular it describes the "Monero way", which gives balanced trees but they
 *   had some issues with bugs
 *     https://medium.com/coinmonks/merkle-trees-concepts-and-use-cases-5da873702318
 *
 * The current implementation is a derivation and simplification of "Monero" way. It uses ideas
 * from binary heaps represented in array. This significantly simplifies the construction both of a Merkle tree and a proof.
 *
 * Important formulas for a left-aligned full tree represented in an array for n hashes as leafs
 * - array has exactly 2*n - 1 nodes (n leafs other internal)
 * - array[0] is merkle root, array[n-1, ..., 2*n - 2] contains leaf hashes in order
 * - given tree array of length l = 2*n - 1, then n = floor((l + 1)/2) --- be careful with 1 element
 * - parent(i) = Math.floor((i - 1) / 2);
 * - left(i) = 2*i + 1
 * - right(i) = 2*i + 2
 *
 * Importants: all input strings should represent bytes32, hence should be 32-byte padded hex strings.
 */

const web3 = new Web3();

/**
 * Conversion function to Hex value with left padding
 * @param x input value
 * @param padToBytes size to pad to
 * @returns padded hex value
 */
function toHex(x: string | number | BN, padToBytes: number) {
  return Web3.utils.leftPad(Web3.utils.toHex(x), padToBytes * 2);
}

/**
 * Single value hash function. Uses keccak function compatible with the one used in Solidity
 * It is supposed to be used with `0x`-prefixed 32-byte strings as hex values
 * @param val input hash in form of the string `0x` prefixed.
 * @returns hash of the input value
 */
export function singleHash(val: string) {
  return Web3.utils.soliditySha3Raw(val);
}

/**
 * Helper function for constructing the commit hash used with StateConnector.sol contract
 * @param merkleRoot merkle root (`0x`-prefixed 32-byte hex string)
 * @param randomNumber secure random number (`0x`-prefixed 32-byte hex string)
 * @param address addres (`0x`-prefixed 20-byte hex string)
 * @returns `0x`-prefixed 32-byte hex string (hash)
 */
export function commitHash(merkleRoot: string, randomNumber: string, address: string): string {
  return Web3.utils.soliditySha3Raw(web3.eth.abi.encodeParameters(["bytes32", "bytes32", "address"], [merkleRoot, randomNumber, address]));
}

/**
 * A sorted hash of two 32-byte strings
 * @param x first `0x`-prefixed 32-byte hex string
 * @param y second `0x`-prefixed 32-byte hex string
 * @returns the sorted hash
 */
export function sortedHashPair(x: string, y: string) {
  if (x <= y) {
    return Web3.utils.soliditySha3Raw(web3.eth.abi.encodeParameters(["bytes32", "bytes32"], [x, y]));
  }
  return Web3.utils.soliditySha3Raw(web3.eth.abi.encodeParameters(["bytes32", "bytes32"], [y, x]));
}

/**
 * Merkle tree implementation with all the helper function for constructing the tree and extracting the root and proofs for every leaf.
 */
export class MerkleTree {
  _tree: string[] = [];
  initialHash = false;

  constructor(values: string[], initialHash = false) {
    this.initialHash = initialHash;
    this.build(values);
  }

  /**
   * Merkle root
   */
  get root() {
    return this._tree.length === 0 ? null : this._tree[0];
  }

  /**
   * Merkle root as a BN (big number from BN.js)
   */
  get rootBN() {
    const rt = this.root;
    return rt ? Web3.utils.toBN(rt) : Web3.utils.toBN(0);
  }

  /**
   * The array representing full tree (length is `2*hashCount - 1`)
   */
  get tree(): string[] {
    return [...this._tree];
  }

  /**
   * Number of leaves in the Merkle tree
   */
  get hashCount() {
    return this._tree.length ? (this._tree.length + 1) / 2 : 0;
  }

  /**
   * Returns leaves in array of the length `hashCount` sorted as `0x`-prefixed 32-byte hex strings.
   */
  get sortedHashes() {
    const n = this.hashCount;
    return this._tree.slice(this.hashCount - 1);
  }

  /**
   * Parent index of the node at index `i` in array
   * @param i index of a node in the Merkle tree
   * @returns parent index
   */
  parent(i: number) {
    return Math.floor((i - 1) / 2);
  }

  /**
   * Given an array of leave hashes (`0x`-prefixed 32-byte hex strings) it builds the Merkle tree.
   * @param values
   */
  build(values: string[]) {
    const sorted = values.map((x) => toHex(x, 32));
    sorted.sort();

    let hashes = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i == 0 || sorted[i] !== sorted[i - 1]) {
        hashes.push(sorted[i]);
      }
    }
    if (this.initialHash) {
      hashes = hashes.map((x) => singleHash(x));
    }
    const n = hashes.length;
    this._tree = [...new Array(Math.max(n - 1, 0)).fill(0), ...hashes];
    for (let i = n - 2; i >= 0; i--) {
      this._tree[i] = sortedHashPair(this._tree[2 * i + 1], this._tree[2 * i + 2])!;
    }
  }

  /**
   * Returns the hash of the `i`-th leaf (index determined by sorting and positioning in the build)
   * @param i
   * @returns
   */
  getHash(i: number) {
    if (this.hashCount === 0 || i < 0 || i >= this.hashCount) {
      return null;
    }
    const pos = this._tree.length - this.hashCount + i;
    return this._tree[pos];
  }

  /**
   * Extracts the Merkle proof for the `i`-th leaf
   * @param i index of the leaf
   * @returns the Merkle proof - a list of `0x`-prefixed 32-byte hex strings
   */
  getProof(i: number): string[] | null {
    if (this.hashCount === 0 || i < 0 || i >= this.hashCount) {
      return null;
    }
    const proof: string[] = [];
    let pos = this._tree.length - this.hashCount + i;
    while (pos > 0) {
      proof.push(
        this._tree[pos + 2 * (pos % 2) - 1] // if pos even, take left sibiling at pos - 1, else the right sibiling at pos + 1
      );
      pos = this.parent(pos);
    }
    return proof;
  }

  getProofForValue(value: string) {
    const valueNorm = toHex(value, 32);
    const hash = this.initialHash ? singleHash(valueNorm) : valueNorm;
    const start = this._tree.length - this.hashCount;
    const index = this._tree.indexOf(hash, start);
    if (index < 0) return null;
    return this.getProof(index - start);
  }
}

/**
 * Verifies a Merkle proof for a given leaf
 * @param leaf leaf as (`0x`-prefixed 32-byte hex string)
 * @param proof Merkle proof (a list of `0x`-prefixed 32-byte hex strings)
 * @param root Merkle root (`0x`-prefixed 32-byte hex string)
 * @returns `true` if the proof is valid, `false` otherwise
 */
export function verifyWithMerkleProof(leaf: string, proof: string[], root: string) {
  if (!leaf || !proof || !root) return false;
  let hash = leaf;
  for (const pair of proof) {
    hash = sortedHashPair(pair, hash)!;
  }
  return hash == root;
}
