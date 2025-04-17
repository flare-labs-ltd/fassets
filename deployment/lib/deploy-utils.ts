import { Artifact, HardhatRuntimeEnvironment } from "hardhat/types";

// same as in @openzeppelin/test-helpers, but including those in hadhat scripts breaks tests for some reason
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface DeployAccounts {
    deployer: string;
}

export function requiredEnvironmentVariable(name: string): string {
    const value = process.env[name];
    if (value) return value;
    throw new Error(`Missing environment variable ${name}`);
}

export function loadDeployAccounts(hre: HardhatRuntimeEnvironment): DeployAccounts {
    const deployerPrivateKey = requiredEnvironmentVariable('DEPLOYER_PRIVATE_KEY');
    const deployerAccount = hre.web3.eth.accounts.privateKeyToAccount(deployerPrivateKey);
    hre.web3.eth.accounts.wallet.add(deployerPrivateKey);
    return {
        deployer: deployerAccount.address
    };
}

export async function readDeployedCode(address: string | undefined) {
    if (address == null) return null;
    const code = await web3.eth.getCode(address);
    return code.replace(new RegExp(address.slice(2), "gi"), "0000000000000000000000000000000000000000");
}

export async function deployedCodeMatches(artifact: Artifact, address: string | undefined) {
    if (!address) return false;
    const code = await readDeployedCode(address);
    return artifact.deployedBytecode === code;
}

export function abiEncodeCall<I extends Truffle.ContractInstance>(instance: I, call: (inst: I) => any) {
    return call(instance.contract.methods).encodeABI() as string;
}

// we use hardhat.json for network with name 'local'
export function networkConfigName(hre: HardhatRuntimeEnvironment) {
    return hre.network.name === 'local' ? 'hardhat' : hre.network.name;
}

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(() => resolve(), ms));
}

export type WaitFinalizeOptions = { extraBlocks: number, retries: number, sleepMS: number }
export const waitFinalizeDefaults: WaitFinalizeOptions = { extraBlocks: 0, retries: 3, sleepMS: 1000 };

/**
 * Finalization wrapper for web3/truffle. Needed on Flare network since account nonce has to increase
 * to have the transaction confirmed.
 */
export async function waitFinalize<T>(hre: HardhatRuntimeEnvironment, address: string, func: () => Promise<T>, options: WaitFinalizeOptions = waitFinalizeDefaults) {
    if (hre.network.name === 'local' || hre.network.name === 'hardhat') {
        return await func();
    }
    let nonce = await hre.web3.eth.getTransactionCount(address);
    let res = await func();
    while (await hre.web3.eth.getTransactionCount(address) <= nonce) {
        await sleep(options.sleepMS);
    }
    for (let i = 0; i < options.retries; i++) {
        const currentBlock = await hre.web3.eth.getBlockNumber();
        while (await hre.web3.eth.getBlockNumber() < currentBlock + options.extraBlocks) {
            await sleep(options.sleepMS);
        }
        // only end if the nonce didn't revert (and repeat up to 3 times)
        if (await hre.web3.eth.getTransactionCount(address) > nonce) break;
        console.warn(`Nonce reverted after ${i + 1} retries, retrying again...`);
    }
    return res;
}

export function truffleContractMetadata(contract: Truffle.Contract<any>): { contractName: string, abi: AbiItem[] } {
    return (contract as any)._json;
}

/**
 * Encode contract names in a way compatible with AddressUpdatable.updateContractAddresses.
 */
export function encodeContractNames(names: string[]): string[] {
    return names.map(name => encodeContractName(name));
}

/**
 * Encode contract name in a way compatible with AddressUpdatable.updateContractAddresses.
 */
export function encodeContractName(text: string): string {
    return web3.utils.keccak256(web3.eth.abi.encodeParameters(["string"], [text]));
}

/**
 * Run async main function and wait for exit.
 */
export function runAsyncMain(func: (args: string[]) => Promise<void>, errorExitCode: number = 123) {
    void func(process.argv.slice(2))
        .then(() => { process.exit(0); })
        .catch(e => { console.error(e); process.exit(errorExitCode); });
}
