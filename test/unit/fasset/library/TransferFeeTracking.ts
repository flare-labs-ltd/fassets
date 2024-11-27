import { time } from "@nomicfoundation/hardhat-network-helpers";
import { BN_ZERO, maxBN, minBN, toBN, WEEKS } from "../../../../lib/utils/helpers";
import { TransferFeeTrackingMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";
import { coinFlip, randomBN, randomChoice } from "../../../utils/fuzzing-utils";
import { SparseArray } from "../../../utils/SparseMatrix";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { expectRevert } from "@openzeppelin/test-helpers";

const TransferFeeTrackingMock = artifacts.require("TransferFeeTrackingMock");

contract(`TransferFeeTracking.sol; ${getTestFile(__filename)};  Transfer fee unit tests`, async accounts => {
    let agents = accounts.slice(10, 20);
    let tracking: TransferFeeTrackingMockInstance;
    let agentMinted: SparseArray;

    beforeEach(async () => {
        const firstEpochStartTs = await time.latest() - 5 * WEEKS;
        const epochDuration = 1 * WEEKS;
        const maxUnexpiredEpochs = 10;
        tracking = await TransferFeeTrackingMock.new(firstEpochStartTs, epochDuration, maxUnexpiredEpochs);
        agentMinted = new SparseArray();
    });

    async function mintAndTrack(agent: string, amount: BN) {
        const newMinted = agentMinted.get(agent).add(amount);
        agentMinted.set(agent, newMinted);
        await tracking.updateMintingHistory(agent, newMinted);
    }

    async function redeemAndTrack(agent: string, amount: BN) {
        const newMinted = maxBN(agentMinted.get(agent).sub(amount), BN_ZERO);
        agentMinted.set(agent, newMinted);
        await tracking.updateMintingHistory(agent, newMinted);
    }

    describe("tracking minted amount", () => {
        it("should correctly track minted value and total", async () => {
            for (let i = 0; i < 100; i++) {
                const agent = randomChoice(agents);
                const amount = randomBN(toBN(10), toBN(1000));
                await mintAndTrack(agent, amount);
            }
            assertWeb3Equal(await tracking.totalMinted(), agentMinted.total());
            for (const agent of agents) {
                assertWeb3Equal(await tracking.agentMinted(agent), agentMinted.get(agent));
            }
        });

        it("should correctly track mints and redeems", async () => {
            for (let i = 0; i < 100; i++) {
                const agent = randomChoice(agents);
                const amount = randomBN(toBN(10), toBN(1000));
                if (coinFlip()) {
                    await mintAndTrack(agent, amount);
                } else {
                    await redeemAndTrack(agent, amount);
                }
            }
            assertWeb3Equal(await tracking.totalMinted(), agentMinted.total());
            for (const agent of agents) {
                assertWeb3Equal(await tracking.agentMinted(agent), agentMinted.get(agent));
            }
        });

        it("should correctly track mints and redeems", async () => {
            for (let i = 0; i < 100; i++) {
                const agent = randomChoice(agents);
                const amount = randomBN(toBN(10), toBN(1000));
                if (coinFlip()) {
                    await mintAndTrack(agent, amount);
                } else {
                    await redeemAndTrack(agent, amount);
                }
            }
            assertWeb3Equal(await tracking.totalMinted(), agentMinted.total());
            for (const agent of agents) {
                assertWeb3Equal(await tracking.agentMinted(agent), agentMinted.get(agent));
            }
        });

        it("can initialize agents when they already have some minting", async () => {
            for (let i = 0; i < agents.length; i++) {
                agentMinted.set(agents[i], toBN(i * 10));
            }
            // tracked should differ now (except for agent 0 with 0 minting)
            assert.equal(Number(agentMinted.get(agents[0])), Number(await tracking.agentMinted(agents[0])));
            for (let i = 1; i < agents.length; i++) {
                assert.notEqual(Number(agentMinted.get(agents[i])), Number(await tracking.agentMinted(agents[i])));
            }
            // can do some minting and redeeming
            await mintAndTrack(agents[1], toBN(25));
            await mintAndTrack(agents[2], toBN(55));
            await redeemAndTrack(agents[2], toBN(30));
            await redeemAndTrack(agents[3], toBN(15));
            // the updated agents already have correct tracking
            for (let i = 1; i <= 3; i++) {
                assert.equal(Number(agentMinted.get(agents[i])), Number(await tracking.agentMinted(agents[i])));
            }
            // now initialize tracking for all agents - in two steps
            for (let i = 0; i < agents.length; i++) {
                await tracking.initMintingHistory(agents[i], agentMinted.get(agents[i]));
            }
            // now all should be correct and the total also
            assertWeb3Equal(await tracking.totalMinted(), agentMinted.total());
            for (const agent of agents) {
                assertWeb3Equal(await tracking.agentMinted(agent), agentMinted.get(agent));
            }
        });
    });

    describe("tracking fees", () => {
        it("should not expire epochs until fee is added to current", async () => {
            const FEE = 1000;
            const settings = await tracking.transferFeeSettings();
            const M = Number(settings.maxUnexpiredEpochs);
            const firstEpoch = await tracking.currentEpoch();
            for (let i = 0; i < M; i++) {
                await tracking.addFees(FEE);
                await time.increase(toBN(settings.epochDuration));
            }
            await time.increase(toBN(settings.epochDuration).muln(M));
            // check previous epochs
            for (let i = 0; i < 2 * M; i++) {
                const data = await tracking.transferFeeEpochData(firstEpoch.addn(i));
                assert.isFalse(data.expired);
                assert.isTrue(data.claimable);
                assertWeb3Equal(data.totalFees, i < M ? FEE : 0)
            }
            // current epoch
            const currentEpoch = await tracking.currentEpoch();
            assertWeb3Equal(currentEpoch, firstEpoch.addn(2 * M));
            const dataCur = await tracking.transferFeeEpochData(currentEpoch);
            assert.isFalse(dataCur.expired);
            assert.isFalse(dataCur.claimable);
            assertWeb3Equal(dataCur.totalFees, 0)
        });

        it("should expire one epoch each time fee is added", async () => {
            const FEE = 1000;
            const settings = await tracking.transferFeeSettings();
            const M = Number(settings.maxUnexpiredEpochs);
            const firstEpoch = await tracking.currentEpoch();
            for (let i = 0; i < M; i++) {
                await tracking.addFees(FEE);
                await time.increase(toBN(settings.epochDuration));
            }
            await time.increase(toBN(settings.epochDuration).muln(M));
            // add fee M times to current epoch
            const currentEpoch = await tracking.currentEpoch();
            assertWeb3Equal(currentEpoch, firstEpoch.addn(2 * M));
            for (let i = 0; i < M; i++) {
                await tracking.addFees(1);
                const dataExp = await tracking.transferFeeEpochData(firstEpoch.addn(i));
                assert.isTrue(dataExp.expired);
                assertWeb3Equal(dataExp.totalFees, 0)
                const dataNextExp = await tracking.transferFeeEpochData(firstEpoch.addn(i + 1));
                assert.isFalse(dataNextExp.expired);
                const dataCur = await tracking.transferFeeEpochData(currentEpoch);
                assert.isFalse(dataCur.expired);
                assertWeb3Equal(dataCur.totalFees, (i + 1) * (FEE + 1)) // 1 added, 1 * FEE expired to current per each loop
            }
        });
    });

    describe("basic tests", () => {
        it("should not deploy if epoch duration is zero", async () => {
            await expectRevert(TransferFeeTrackingMock.new(0, 0, 0), "epoch duration must be nonzero");
        });

        it("should not reinitialize", async () => {
            await expectRevert(tracking.reinitialize(0, 2, 5), "already initialized");
        });
    });
});
