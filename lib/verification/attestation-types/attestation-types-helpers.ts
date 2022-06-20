import BN from "bn.js";
import glob from "glob";
import Web3 from "web3";
import { AttestationTypeScheme, NumberLike, SupportedSolidityType, WeightedRandomChoice } from "./attestation-types";

const toBN = Web3.utils.toBN;

export const ATT_TYPE_DEFINITIONS_ROOT = "lib/verification/attestation-types";

export function tsTypeForSolidityType(type: SupportedSolidityType) {
  switch (type) {
    case "uint8":
    case "uint16":
    case "uint32":
    case "uint64":
    case "uint128":
    case "uint256":
    case "int256":
      return "BN";
    case "bool":
      return "boolean";
    case "string":
    case "bytes4":
    case "bytes32":
      return "string";
    default:
      // exhaustive switch guard: if a compile time error appears here, you have forgotten one of the cases
      ((_: never): void => { })(type);
  }
}

export function randSol(request: any, key: string, type: SupportedSolidityType) {
  let web3 = new Web3();
  if (request[key]) {
    return request[key];
  }
  switch (type) {
    case "uint8":
      return toBN(web3.utils.randomHex(1))
    case "uint16":
      return toBN(web3.utils.randomHex(2))
    case "uint32":
      return toBN(web3.utils.randomHex(4))
    case "uint64":
      return toBN(web3.utils.randomHex(8))
    case "uint128":
      return toBN(web3.utils.randomHex(16))
    case "uint256":
      return toBN(web3.utils.randomHex(32))
    case "int256":
      return toBN(web3.utils.randomHex(30))  // signed!
    case "bool":
      return toBN(web3.utils.randomHex(1)).mod(toBN(2));
    case "string":
      return web3.utils.randomHex(32)
    case "bytes4":
      return web3.utils.randomHex(4)
    case "bytes32":
      return web3.utils.randomHex(32)
    default:
      // exhaustive switch guard: if a compile time error appears here, you have forgotten one of the cases
      ((_: never): void => { })(type);
  }
}

export function numberLikeToNumber(n: NumberLike): number | undefined {
  if (typeof n === "string") {
    return parseInt(n, 10);
  }
  if (n === undefined || n === null) return undefined;
  if (n && n.constructor?.name === "BN") return (n as BN).toNumber();
  return n as number;
}

export function randomListElement<T>(list: T[]) {
  let randN = Math.floor(Math.random() * list.length);
  return list[randN];
}

export function randomWeightedChoice<T>(choices: WeightedRandomChoice<T>[]): T {
  let weightSum = choices.map(choice => choice.weight).reduce((a, b) => a + b);
  let randSum = Math.floor(Math.random() * (weightSum + 1));
  let tmpSum = 0;
  for (let choice of choices) {
    tmpSum += choice.weight;
    if (tmpSum >= randSum) return choice.name;
  }
  return choices[choices.length - 1].name;
}


export async function getAttTypesDefinitionFiles(): Promise<string[]> {

  const pattern = `t-*.${process.env.NODE_ENV === "development" ? "ts" : "js"}`;

  return new Promise((resolve, reject) => {
    glob(pattern, { cwd: ATT_TYPE_DEFINITIONS_ROOT }, (er: any, files: string[] | null) => {
      if (er) {
        reject(er);
      } else {
        if (files) {
          files.sort();
        }
        resolve(files || []);
      }
    });
  });
}

export async function readAttestationTypeSchemes(): Promise<AttestationTypeScheme[]> {
  let names = await getAttTypesDefinitionFiles();
  return names.map(name => require(`../attestation-types/${name}`).TDEF as AttestationTypeScheme)
}

export function toHex(x: string | number | BN, padToBytes?: number) {
  if (padToBytes as any > 0) {
    return Web3.utils.leftPad(Web3.utils.toHex(x), padToBytes! * 2);
  }
  return Web3.utils.toHex(x);
}

export function prefix0x(tx: string) {
  return tx.startsWith("0x") ? tx : "0x" + tx;
}

export function hexlifyBN(obj: any): any {
  const isHexReqex = /^[0-9A-Fa-f]+$/
  if(obj?.mul) {
     return prefix0x(toHex(obj));
  }
  if(Array.isArray(obj)) {
     return (obj as any[]).map(item => hexlifyBN(item));
  }
  if(typeof obj === "object") {
     let res = {} as any;
     for(let key of Object.keys(obj)) {
        let value = obj[key];
        res[key] = hexlifyBN(value);
     }   
     return res;      
  }
  if(typeof obj === "string" && obj.match(isHexReqex)){
    return prefix0x(obj);
  }
  return obj
}
