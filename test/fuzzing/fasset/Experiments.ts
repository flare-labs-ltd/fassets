import { Signer } from "@ethersproject/abstract-signer";
import { StaticJsonRpcProvider } from "@ethersproject/providers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { constants, time } from "@openzeppelin/test-helpers";
import { BaseContract, BigNumber, Contract, ContractFactory, ContractReceipt, ContractTransaction, Wallet } from "ethers";
import { ethers, network } from "hardhat";
import { HardhatNetworkAccountUserConfig } from "hardhat/types";
import hardhatConfig from "../../../hardhat.config";
import { VPContract__factory, VPToken, WNat, WNat__factory } from "../../../typechain";
import { WNatInstance } from "../../../typechain-truffle";
import { EthersEventDecoder } from "../../utils/EthersEventDecoder";
import { setDefaultVPContract, setDefaultVPContract_ethers } from "../../utils/token-test-helpers";
import { currentRealTime, elapsedTime, randomShuffled, range } from "../../utils/fuzzing-utils";
import { sleep, toBN, formatBN as formatBNOrig, toStringExp, toBNExp } from "../../../lib/utils/helpers";
import { getTestFile } from "../../utils/test-helpers";

const WNAT = artifacts.require("WNat");

let startTimestamp: BN;

interface TypedContractFactory<P extends any[], C extends Contract> extends ContractFactory {
    deploy(...args: P): Promise<C>;
}

interface TypedContractFactoryConstructor<P extends any[], C extends Contract> {
    new(signer?: Signer): TypedContractFactory<P, C>;
}

interface TypedContract extends BaseContract {
    connect(signer: Signer): this;
    attach(addressOrName: string): this;
    deployed(): Promise<this>;
}

const formatBN = formatBNOrig as (x: BN | BigNumber | string | number) => string;

async function timed<T>(call: () => Promise<T>): Promise<T> {
    const start = currentRealTime();
    const tx = await call();
    const end = currentRealTime();
    const timestamp = await time.latest();
    console.log(call.toString());
    console.log(`    duration: ${(end - start).toFixed(3)},  timestamp: ${timestamp.sub(startTimestamp)},  block: ${await time.latestBlock()}`);
    return tx;
}

function ethersNew<P extends any[], C extends TypedContract>(factoryClass: TypedContractFactoryConstructor<P, C>, ...args: P): Promise<C> {
    return ethersNewFrom(factoryClass, ethers.provider.getSigner(), ...args);
}

async function ethersNewFrom<P extends any[], C extends TypedContract>(factoryClass: TypedContractFactoryConstructor<P, C>, signer: Signer, ...args: P): Promise<C> {
    const factory = new factoryClass(signer);
    const contract = await factory.deploy(...args);
    return await contract.deployed();
}

async function waitFinalizeMulti(signer: SignerWithAddress, func: () => Promise<ContractTransaction>): Promise<ContractReceipt>;
async function waitFinalizeMulti(signer: SignerWithAddress, ...functions: Array<() => Promise<ContractTransaction>>): Promise<ContractReceipt[]>;
async function waitFinalizeMulti(signer: SignerWithAddress, ...functions: Array<() => Promise<ContractTransaction>>): Promise<ContractReceipt | ContractReceipt[]> {
    const results = await Promise.all(functions.map(async func => {
        const nonce = await ethers.provider.getTransactionCount(signer.address);
        const receipt = await func().then(f => f.wait());
        assert.equal(receipt.from, signer.address, "Transaction from and signer mismatch (did you forget connect()?)");
        return [nonce, receipt] as const;
    }));
    const nonce = Math.max(...results.map(t => t[0]));
    const receipts = results.map(t => t[1]);
    while ((await ethers.provider.getTransactionCount(signer.address)) <= nonce) {
        await sleep(100);
    }
    return receipts.length === 1 ? receipts[0] : receipts;
}

async function waitFinalizeFrom<T extends TypedContract>(signer: SignerWithAddress, contract: T, func: (c: T) => Promise<ContractTransaction>): Promise<ContractReceipt> {
    let nonce = await ethers.provider.getTransactionCount(signer.address);
    const tx = await func(contract.connect(signer));
    let receipt = await tx.wait();
    while ((await ethers.provider.getTransactionCount(signer.address)) == nonce) {
        await sleep(100);
    }
    return receipt;
}

function runThread(body: () => Promise<void>): void {
    void body();
}

const usedNonces: Record<string, number> = {};

// works fine on hardhat local but not on hardhat in-process
async function waitNewNonce(address: string) {
    const startTm = currentRealTime();
    while (true) {
        const nonce = await web3.eth.getTransactionCount(address, 'pending');
        if ((usedNonces[address] ?? -1) < nonce) {
            usedNonces[address] = nonce;
            return [nonce, currentRealTime() - startTm];
        }
    }
}

class Future<T> {
    resolve!: (value: T | PromiseLike<T>) => void;
    reject!: (error: any) => void;
    promise = new Promise<T>((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
    });
}

contract(`Experiments; ${getTestFile(__filename)}`, async accounts => {
    describe("web3 hardhat experiments", () => {
        // a fresh contract for each test
        let wNat: WNatInstance;

        // Do clean unit tests by spinning up a fresh contract for each test
        beforeEach(async () => {
            wNat = await WNAT.new(accounts[0], "Wrapped NAT", "WNAT");
            await setDefaultVPContract(wNat, accounts[0]);
            startTimestamp = await time.latest();
            // switch to manual mining
            await network.provider.send('evm_setAutomine', [false]);
            await network.provider.send("evm_setIntervalMining", [0]);
        });

        afterEach(async () => {
            await network.provider.send('evm_setAutomine', [true]);
        });

        it("try run network by auto mining", async () => {
            await network.provider.send('evm_setAutomine', [true]);
            for (let i = 0; i < 10; i++) {
                await timed(() => wNat.deposit({ from: accounts[1], value: toBN(10_000) }))
                    .then((receipt) => console.log("Minted 10_000", i));
                await sleep(10);
            }
        });
        
        it.only("try run network by manual mining", async () => {
            // console.log('defaultAccount', network.config.from);
            
            for (let i = 0; i < 50; i++) {
                const txHashF = new Future<string>();
                const receiptF = new Future<TransactionReceipt>();
                const startTm = currentRealTime();
                const account = accounts[i % 10 + 1];
                void wNat.contract.methods.deposit().send({ from: account, value: toBN(10_000), gas: 500_000 })
                    .once('transactionHash', (hash: string) => txHashF.resolve(hash))
                    .once('receipt', (receipt: TransactionReceipt) => receiptF.resolve(receipt));
                    // .on('confirmation', (confirmation: number, receipt: TransactionReceipt) => { console.log(`Confirmation ${confirmation} for tx ${receipt.transactionHash}`); });
                void receiptF.promise.then((receipt) => console.log("Minted 10_000", i, "block:", receipt.blockNumber, "time:", elapsedTime(startTm)));
                const txHash = await txHashF.promise;
                const nonce = await web3.eth.getTransactionCount(account);
                console.log("Sent deposit tx", txHash, "nonce:", nonce, "time:", elapsedTime(startTm));
                
                // void wNat.deposit({ from: accounts[i + 1], value: toBN(10_000), gas: 500_000 })
                //     .then((receipt) => console.log("Minted 10_000", i, "block:", receipt.receipt.blockNumber));
            }

            for (let i = 0; i < 10; i++) {
                await timed(() => network.provider.send('evm_mine'));
                await sleep(1000);
                console.log(`Balance: ${await wNat.balanceOf(accounts[1])}`);
            }

            void wNat.withdraw(15_000, { from: accounts[1] })
                .then(() => console.log("Withdrawn 15_000"));
            await sleep(10);
            await timed(() => network.provider.send('evm_mine'));
            console.log(`Balance: ${await wNat.balanceOf(accounts[1])}`);
            await timed(() => network.provider.send('evm_mine'));
            console.log(`Balance: ${await wNat.balanceOf(accounts[1])}`);
        });
    });

    describe("ethers hardhat experiments", async () => {

        // a fresh contract for each test
        let signers: Signer[];
        let wNat: WNat;

        // Do clean unit tests by spinning up a fresh contract for each test
        beforeEach(async () => {
            signers = await ethers.getSigners();
            //const signer = signers[0];
            startTimestamp = await time.latest();
            // deploy wNat 
            wNat = await timed(() => ethersNew(WNat__factory, accounts[0], "Wrapped NAT", "WNAT"));
            await setDefaultVPContract_ethers(wNat, accounts[0]);
            // switch to manual mining
            await network.provider.send('evm_setAutomine', [false]);
            await network.provider.send("evm_setIntervalMining", [0]);
        });

        afterEach(async () => {
            await network.provider.send('evm_setAutomine', [true]);
        });

        it("try run network by manual mining", async () => {
            await timed(() => wNat.connect(signers[1]).deposit({ value: 10_000 }));
            await timed(() => wNat.connect(signers[1]).deposit({ value: 20_000 }));
            await timed(() => network.provider.send('evm_mine'));
            // await timed(() => network.provider.send('evm_mine'));
            console.log(`Balance: ${await wNat.balanceOf(accounts[1])}`);

            await timed(() => wNat.connect(signers[1]).withdraw(15_000));
            await timed(() => network.provider.send('evm_mine'));
            console.log(`Balance: ${await wNat.balanceOf(accounts[1])}`);
        });
    });

    describe.skip("ethers scdev experiments", async () => {

        // a fresh contract for each test
        let signers: SignerWithAddress[];
        let wNat: WNat;

        // Do clean unit tests by spinning up a fresh contract for each test
        beforeEach(async () => {
            signers = await ethers.getSigners();
            //const signer = signers[0];
            startTimestamp = await time.latest();
            // deploy wNat 
            wNat = await timed(() => ethersNew(WNat__factory, accounts[0], "Wrapped NAT", "WNAT"));
            await setDefaultVPContract_ethers(wNat, accounts[0]);
            // wait finalize ...
        });

        it("try run network by manual mining", async () => {
            // await timed(() => waitFinalizeFrom(signers[1], wNat, w => w.deposit({ value: 10_000, gasLimit: 1_000_000 })));
            // await timed(() => waitFinalizeFrom(signers[1], wNat, w => w.deposit({ value: 20_000, gasLimit: 1_000_000 })));
            await timed(() => waitFinalizeMulti(signers[1],
                () => wNat.connect(signers[1]).deposit({ value: 10_000, gasLimit: 1_000_000 }),
                () => wNat.connect(signers[1]).deposit({ value: 20_000, gasLimit: 1_000_000 })
            ));

            // await timed(() => network.provider.send('evm_mine'));
            console.log(`Balance: ${await wNat.balanceOf(accounts[1])}`);

            await timed(() => waitFinalizeFrom(signers[1], wNat, w => w.withdraw(15_000, { gasLimit: 1_000_000 })));
            console.log(`Balance: ${await wNat.balanceOf(accounts[1])}`);
        });
    });

    describe.skip("ethers simple experiments", async () => {

        // a fresh contract for each test
        let signers: Signer[];
        let wNat: WNat;

        // Do clean unit tests by spinning up a fresh contract for each test
        beforeEach(async () => {
            signers = await ethers.getSigners();
            startTimestamp = await time.latest();
            // deploy wNat 
            wNat = await timed(() => ethersNew(WNat__factory, accounts[0], "Wrapped NAT", "WNAT"));
            await setDefaultVPContract_ethers(wNat, accounts[0]);
        });

        it.skip("test events", async () => {
            const vpContract = new VPContract__factory().attach(await wNat.readVotePowerContract());
            const decoder = new EthersEventDecoder({ wNat, vpContract });
            decoder.addAddresses({ ZERO: constants.ZERO_ADDRESS, A1: accounts[1], A2: accounts[2] });
            const res = await wNat.connect(signers[1]).deposit({ value: 10_000 }).then(t => t.wait());
            decoder.decodeEvents(res).forEach(ev => console.log(decoder.format(ev)));
            // console.log(JSON.stringify(decoder.decodeEvents(res1), null, 4));
            // for (const event of res.events ?? []) {
            //     console.log(JSON.stringify(event, null, 4));
            // }
            const res1 = await wNat.connect(signers[1]).delegate(accounts[2], 3000).then(t => t.wait());
            decoder.decodeEvents(res1).forEach(ev => console.log(decoder.format(ev)));
            // console.log(JSON.stringify(decoder.decodeEvents(res1), null, 4));
            // for (const event of res1.events ?? []) {
            //     const decoded = vpContract.interface.parseLog(event);
            //     // const decoded = vpContract.interface.decodeEventLog(event.topics[0], event.data, event.topics);
            //     console.log(JSON.stringify(event, null, 4));
            //     console.log(JSON.stringify(decoded, null, 4));
            // }
            const res2 = await wNat.connect(signers[1]).deposit({ value: 10_000 }).then(t => t.wait());
            decoder.decodeEvents(res2).forEach(ev => console.log(decoder.format(ev)));
        });

        it.skip("test error", async () => {
            await wNat.withdraw(1000, { gasLimit: 100_000 });
        });

        it("test new signer", async () => {
            // console.log(hardhatConfig.networks?.hardhat?.accounts);
            const account = (hardhatConfig.networks?.hardhat?.accounts as HardhatNetworkAccountUserConfig[])[0];
            const provider = new StaticJsonRpcProvider(`http://127.0.0.1:9650/ext/bc/C/rpc`);
            const wallet = new Wallet(account.privateKey, provider);
            const balance = await wallet.getBalance();
            console.log(formatBN(balance));
        });
    });

    describe("simple web3 experiments", () => {
        // a fresh contract for each test
        let wNat: WNatInstance;

        // Do clean unit tests by spinning up a fresh contract for each test
        beforeEach(async () => {
            wNat = await WNAT.new(accounts[0], "Wrapped NAT", "WNAT");
            await setDefaultVPContract(wNat, accounts[0]);
            startTimestamp = await time.latest();
        });

        it("test time skip", async () => {
            console.log(`Start time=${(await time.latest()).sub(startTimestamp)} block=${await time.latestBlock()}`);
            await wNat.deposit({ from: accounts[1], value: toBN(10_000) });
            console.log(`After deposit time=${(await time.latest()).sub(startTimestamp)} block=${await time.latestBlock()}`);
            await time.increase(0);
            console.log(`After skip(0) time=${(await time.latest()).sub(startTimestamp)} block=${await time.latestBlock()}`);
            await time.increase(1);
            console.log(`After skip(1) time=${(await time.latest()).sub(startTimestamp)} block=${await time.latestBlock()}`);
            await time.increase(10);
            console.log(`After skip(10) time=${(await time.latest()).sub(startTimestamp)} block=${await time.latestBlock()}`);
            await sleep(5000);
            console.log(`After sleep(5s) time=${(await time.latest()).sub(startTimestamp)} block=${await time.latestBlock()}`);
            await time.advanceBlock();
            console.log(`After sleep(5s) and mine time=${(await time.latest()).sub(startTimestamp)} block=${await time.latestBlock()}`);
            await sleep(5000);
            await time.increase(3);
            console.log(`After sleep(5s) and skip(2) time=${(await time.latest()).sub(startTimestamp)} block=${await time.latestBlock()}`);
            await sleep(5000);
            await time.advanceBlock();
            console.log(`After only sleep(5s) time=${(await time.latest()).sub(startTimestamp)} block=${await time.latestBlock()}`);
        });

        it.skip("test error", async () => {
            await wNat.withdraw(1000);
        });

        it("test toStringFixed", async () => {
            const x = 2353.498 / 1000;
            for (const dec of [5, 10, 12, 16, 18, 20, 22, 24]) {
                const s1 = String(Math.round(x * 10 ** dec));
                const s2 = toStringExp(x, dec);
                console.log(`Math: ${s1} [len=${s1.length}],  Manual: ${s2} [len=${s2.length}]`);
            }
        });

        it("test formatBN", async () => {
            const x = 2353.498 / 1000;
            for (const dec of [5, 10, 12, 16, 18, 20, 22, 24]) {
                const s1 = String(Math.round(x * 10 ** dec));
                const xb = toBNExp(x, dec);
                const s2 = formatBN(xb);
                console.log(`Math: ${s1} [len=${s1.length}],  Manual: ${s2} [len=${s2.length}]`);
            }
        });
    });

});
