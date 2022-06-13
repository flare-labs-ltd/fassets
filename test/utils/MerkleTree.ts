import BN from "bn.js";
import Web3 from "web3";
import { toBN, toHex } from "./helpers";

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

export function singleHash(val: string | BN) {
  return web3.utils.soliditySha3Raw(toHex(val, 32));
}

export function sortedHashPair(x: string, y: string) {
  if (x <= y) {
    return web3.utils.soliditySha3Raw(web3.eth.abi.encodeParameters(["bytes32", "bytes32"], [x, y]));
  }
  return web3.utils.soliditySha3Raw(web3.eth.abi.encodeParameters(["bytes32", "bytes32"], [y, x]));
}

export class MerkleTree {
  _tree: string[] = [];
  initialHash = false;

  constructor(values: string[], initialHash = false) {
    this.initialHash = initialHash;
    this.build(values);
  }

  get root() {
    return this._tree.length === 0 ? null : this._tree[0];
  }

  get rootBN() {
    let rt = this.root;
    return rt ? toBN(rt) : toBN(0);
  }

  get tree(): string[] {
    return [...this._tree];
  }

  get hashCount() {
    return this._tree.length ? (this._tree.length + 1) / 2 : 0;
  }

  get sortedHashes() {
    let n = this.hashCount;
    return this._tree.slice(this.hashCount - 1);
  }

  parent(i: number) {
    return Math.floor((i - 1) / 2);
  }

  build(values: string[]) {
    let sorted = values.map((x) => toHex(x, 32));
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
    let n = hashes.length;
    if (n !== 0) {
      this._tree = [...new Array(n - 1).fill(0), ...hashes];
      for (let i = n - 2; i >= 0; i--) {
        this._tree[i] = sortedHashPair(this._tree[2 * i + 1], this._tree[2 * i + 2])!;
      }
    } else {
      this._tree = [];
    }
  }

  getHash(i: number) {
    if (this.hashCount === 0 || i < 0 || i >= this.hashCount) {
      return null;
    }
    let pos = this._tree.length - this.hashCount + i;
    return this._tree[pos];
  }

  getProof(i: number) {
    if (this.hashCount === 0 || i < 0 || i >= this.hashCount) {
      return null;
    }
    let proof: string[] = [];
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

  verify(leaf: string, proof: string[]) {
    if (!leaf || !proof || !this.root) return false;
    let hash = leaf;
    for (let pair of proof) {
      hash = sortedHashPair(pair, hash)!;
    }
    return hash === this.root;
  }
}
