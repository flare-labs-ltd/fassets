import { erc7201slot } from "../utils/helpers";

const namespace = process.argv[2];

if (!namespace) {
    console.error(`Usage: ${process.argv[1]} <namespace>`);
    console.error(`Prints ERC-7201 namespaced slot address for diamond state storage.`)
    process.exit(1);
}

console.log(`// keccak256(abi.encode(uint256(keccak256("${namespace}")) - 1)) & ~bytes32(uint256(0xff))`);
console.log(`bytes32 private constant _STORAGE_LOCATION = ${erc7201slot(namespace)};`);
