import { time } from "@openzeppelin/test-helpers";
import { network } from "hardhat";
import * as rlp from "rlp";
import { toBN, ZERO_BYTES32 } from "../../lib/utils/helpers";
import { AllEvents as IGovernedEvents } from "../../typechain-truffle/IGoverned";
import { Web3EventDecoder } from "./Web3EventDecoder";

const SuicidalMock = artifacts.require("SuicidalMock");
const GovernanceSettings = artifacts.require("GovernanceSettings");
const GovernedBase = artifacts.require("contracts/governance/implementation/GovernedBase.sol:GovernedBase" as "GovernedBase");

export function precomputeContractAddress(deployer: string, nonce: number) {
    const rlpEnc = '0x' + rlp.encode([deployer, nonce]).toString('hex');
    const hash = web3.utils.keccak256(rlpEnc);
    const address = '0x' + hash.slice(hash.length - 40);
    return web3.utils.toChecksumAddress(address);
}

export async function transferWithSuicide(amount: BN, from: string, to: string) {
    if (amount.lten(0)) throw new Error("Amount must be positive");
    const suicidalMock = await SuicidalMock.new(to);
    await web3.eth.sendTransaction({ from: from, to: suicidalMock.address, value: amount });
    await suicidalMock.die();
}

export async function impersonateContract(contractAddress: string, gasBalance: BN, gasSource: string) {
    // allow us to impersonate calls from contract address
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [contractAddress] });
    // provide some balance for gas
    await transferWithSuicide(gasBalance, gasSource, contractAddress);
}

export async function stopImpersonatingContract(contractAddress: string) {
    await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [contractAddress] });
}

export async function emptyAddressBalance(address: string, toAccount: string) {
    const gasPrice = toBN(100_000_000_000);
    const gasAmount = 21000;
    await impersonateContract(address, gasPrice.muln(gasAmount), toAccount);
    const addressBalance = toBN(await web3.eth.getBalance(address));
    const amount = addressBalance.sub(gasPrice.muln(gasAmount));
    await web3.eth.sendTransaction({ from: address, to: toAccount, value: amount, gas: gasAmount, gasPrice: gasPrice });
    await stopImpersonatingContract(address);
}

export async function executeTimelockedGovernanceCall(contract: Truffle.ContractInstance, methodCall: (governance: string) => Promise<Truffle.TransactionResponse<any>>) {
    const contractGoverned = await GovernedBase.at(contract.address);           // hack because when contract is an instance of interface, it doesn't expose methods of GovernedBase
    const eventDecoder = new Web3EventDecoder({ contract, contractGoverned });  // also needed to decode events from GovernedBase artifact
    const governanceSettings = await GovernanceSettings.at(await contractGoverned.governanceSettings());
    const governance = await governanceSettings.getGovernanceAddress();
    const response = await methodCall(governance) as Truffle.TransactionResponse<IGovernedEvents>;
    const timelockEvent = eventDecoder.findEvent(response, 'GovernanceCallTimelocked');
    if (timelockEvent) {
        const executor = (await governanceSettings.getExecutors())[0];
        const timelock = timelockEvent.args;
        await time.increaseTo(timelock.allowedAfterTimestamp.toNumber() + 1);
        await contractGoverned.executeGovernanceCall(timelock.encodedCall, { from: executor });
    }
}

const GOVERNANCE_SETTINGS_ADDRESS = "0x1000000000000000000000000000000000000007";
const GENESIS_GOVERNANCE_ADDRESS = "0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7";

export async function testDeployGovernanceSettings(governance: string, timelock: number, executors: string[]) {
    const tempGovSettings = await GovernanceSettings.new();
    const governanceSettingsCode = await web3.eth.getCode(tempGovSettings.address);   // get deployed code
    await network.provider.send("hardhat_setCode", [GOVERNANCE_SETTINGS_ADDRESS, governanceSettingsCode]);
    await network.provider.send("hardhat_setStorageAt", [GOVERNANCE_SETTINGS_ADDRESS, "0x0", ZERO_BYTES32]);  // clear initialisation
    const governanceSettings = await GovernanceSettings.at(GOVERNANCE_SETTINGS_ADDRESS);
    await governanceSettings.initialise(governance, timelock, executors, { from: GENESIS_GOVERNANCE_ADDRESS });
    return governanceSettings;
}
