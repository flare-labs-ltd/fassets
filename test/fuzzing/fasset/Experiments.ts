import { time } from "@openzeppelin/test-helpers";
import { network } from "hardhat";
import { Future, formatBN, sleep, toBN, toBNExp, toStringExp } from "../../../lib/utils/helpers";
import { WNatInstance } from "../../../typechain-truffle";
import { currentRealTime, elapsedTime } from "../../utils/fuzzing-utils";
import { getTestFile } from "../../utils/test-helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";

const WNAT = artifacts.require("WNat");

let startTimestamp: BN;

async function timed<T>(call: () => Promise<T>): Promise<T> {
    const start = currentRealTime();
    const tx = await call();
    const end = currentRealTime();
    const timestamp = await time.latest();
    console.log(call.toString());
    console.log(`    duration: ${(end - start).toFixed(3)},  timestamp: ${timestamp.sub(startTimestamp)},  block: ${await time.latestBlock()}`);
    return tx;
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

contract(`Experiments; ${getTestFile(__filename)}`, async accounts => {
    it("try load new account", async () => {
        const privateKey = '0x3c5237a289ca14d74a34778d757a437821dde826593cefcbab5d8bf23b8932c1';
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        web3.eth.accounts.wallet.add(account);
        console.log(web3.eth.accounts.currentProvider);
        console.log(WNAT);
        const wNat = await WNAT.new(account.address, "Wrapped NAT", "WNAT");
        await setDefaultVPContract(wNat, account.address);
    });

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
