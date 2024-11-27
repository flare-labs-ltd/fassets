import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
import { erc165InterfaceId } from "../../../../lib/utils/helpers";
import { FtsoV2PriceStoreInstance, MockContractInstance } from "../../../../typechain-truffle";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { TestSettingsContracts, createTestContracts } from "../../../utils/test-settings";
import { assertWeb3Equal } from "../../../utils/web3assertions";

const FtsoV2PriceStore = artifacts.require('FtsoV2PriceStore');
const MockContract = artifacts.require('MockContract');

contract(`FtsoV2PriceStore.sol; ${getTestFile(__filename)}; FtsoV2PriceStore basic tests`, async accounts => {
    let contracts: TestSettingsContracts;
    let priceStore: FtsoV2PriceStoreInstance;
    let relayMock: MockContractInstance;
    const governance = accounts[10];
    const votingEpochDurationSeconds = 90;
    const ftsoScalingProtocolId = 100;
    let startTs: number;

    const trustedProviders = [accounts[1], accounts[2], accounts[3]];
    const feedIds = ["0x01464c522f55534400000000000000000000000000", "0x01555344432f555344000000000000000000000000"];
    const feedSymbols = ["FLR", "USDC"];
    const feedDecimals = [6, 5];

    async function initialize() {
        contracts = await createTestContracts(governance);
        startTs = (await time.latest()).toNumber() - votingEpochDurationSeconds;
        priceStore = await FtsoV2PriceStore.new(
            contracts.governanceSettings.address,
            governance,
            contracts.addressUpdater.address,
            startTs,
            votingEpochDurationSeconds,
            ftsoScalingProtocolId
        );
        relayMock = await MockContract.new();
        await priceStore.setTrustedProviders(trustedProviders, 1, { from: governance });
        await priceStore.updateSettings(feedIds, feedSymbols, feedDecimals, 50, { from: governance });
        await contracts.addressUpdater.update(["AddressUpdater", "Relay"],
            [contracts.addressUpdater.address, relayMock.address],
            [priceStore.address],
            { from: governance });
        return { contracts, priceStore };
    }

    beforeEach(async () => {
        ({ contracts, priceStore } = await loadFixtureCopyVars(initialize));
    });

    describe("method tests", () => {

        it("should revert if deploying contract with invalid start time", async () => {
            await expectRevert(FtsoV2PriceStore.new(
                contracts.governanceSettings.address,
                governance,
                contracts.addressUpdater.address,
                startTs + 10,
                votingEpochDurationSeconds,
                ftsoScalingProtocolId
            ), "invalid start time");
        });

        it("should revert if deploying contract with too short voting epoch duration", async () => {
            await expectRevert(FtsoV2PriceStore.new(
                contracts.governanceSettings.address,
                governance,
                contracts.addressUpdater.address,
                startTs,
                1,
                ftsoScalingProtocolId
            ), "voting epoch duration too short");
        });

        //// publishing prices
        it("should revert if wrong number of proofs is provided", async () => {
            // update settings
            const feedIds = ["0x01464c522f55534400000000000000000000000000", "0x01555344432f555344000000000000000000000000"];
            await priceStore.updateSettings(["0x01464c522f55534400000000000000000000000000"], ["FLR"], [6], 50, { from: governance });

            await expectRevert(publishPrices(), "wrong number of proofs");
        });

        it("should revert if (newer) prices already published", async () => {
            await publishPrices(true, 2, 2);

            // publish prices for voting round 1
            await expectRevert(publishPrices(false, 1), "(newer) prices already published");
        });

        it("should revert if submission window for trusted providers not yet closed", async () => {
            await expectRevert(publishPrices(false, 1), "submission window not closed yet");
        });

        it("should revert if voting round id mismatch", async () => {
            await expectRevert(publishPrices(true, 1, 2), "voting round id mismatch");
        });

        it("should revert if feed id mismatch", async () => {
            await expectRevert(publishPrices(true, 1, 1, feedIds[0], feedIds[0]), "feed id mismatch");
        });

        it("should revert if value is negative", async () => {
            await expectRevert(publishPrices(true, 1, 1, feedIds[0], feedIds[1], -1), "value must be non-negative");
        });

        it("should revert if Merkle proof is invalid", async () => {
            await expectRevert(publishPrices(true, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true), "merkle proof invalid");
        });

        //// submitting trusted prices
        it("should revert if submitter is not trusted provider", async () => {
            await expectRevert(priceStore.submitTrustedPrices(1, []), "only trusted provider");
        });

        it("should revert if all prices are not provided", async () => {
            const feeds0 = [];
            for (let i = 1; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: feedDecimals[i] });
            }
            const tx1 = priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });
            await expectRevert(tx1, "all prices must be provided");
        });

        it("should revert if submission windows is closed", async () => {
            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds + votingEpochDurationSeconds / 2 + 1); // one second after end of submission window
            const feeds0 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: feedDecimals[i] });
            }
            const tx1 = priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });
            await expectRevert(tx1, "submission window closed");
        });

        it("should revert if voting round id mismatch", async () => {
            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds); // start of voting round 2
            const feeds0 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: feedDecimals[i] });
            }
            const tx1 = priceStore.submitTrustedPrices(0, feeds0, { from: trustedProviders[0] });
            await expectRevert(tx1, "voting round id mismatch");
        });

        it("should revert if trying to submit twice", async () => {
            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds);
            const feeds0 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: feedDecimals[i] });
            }
            await priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });

            // try to submit again
            const tx1 = priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });
            await expectRevert(tx1, "already submitted");
        });

        it("should revert if feed id mismatch", async () => {
            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds);
            const feeds0 = [];
            for (let i = feedIds.length - 1; i >= 0; i--) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: feedDecimals[i] });
            }
            const tx1 = priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });
            await expectRevert(tx1, "feed id mismatch");
        });

        it("should revert if decimals mismatch", async () => {
            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds);
            const feeds0 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: feedDecimals[i] + 1 });
            }
            const tx1 = priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });
            await expectRevert(tx1, "decimals mismatch");
        });

        it("should calculate median price from 4 trusted prices", async () => {
            const newTrustedProviders = [accounts[1], accounts[2], accounts[3], accounts[4]];
            await priceStore.setTrustedProviders(newTrustedProviders, 2, { from: governance });

            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds); // start of voting round 2
            const feeds0 = [];
            const feeds1 = [];
            const feeds2 = [];
            const feeds3 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: feedDecimals[i] });
                feeds1.push({ id: feedIds[i], value: 123455, decimals: feedDecimals[i] });
                feeds2.push({ id: feedIds[i], value: 123456, decimals: feedDecimals[i] });
                feeds3.push({ id: feedIds[i], value: 123457, decimals: feedDecimals[i] });
            }
            await priceStore.submitTrustedPrices(1, feeds0, { from: newTrustedProviders[0] });
            await priceStore.submitTrustedPrices(1, feeds1, { from: newTrustedProviders[1] });
            await priceStore.submitTrustedPrices(1, feeds2, { from: newTrustedProviders[2] });
            await priceStore.submitTrustedPrices(1, feeds3, { from: newTrustedProviders[3] });

            await publishPrices();

            const { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPriceFromTrustedProviders("USDC");
            // price should be floor(123456 + 123457) / 2 = 123456
            assertWeb3Equal(price, 123456);
        });

        it("should calculate median price from 1 trusted price", async () => {
            const newTrustedProviders = [accounts[1]];
            await priceStore.setTrustedProviders(newTrustedProviders, 1, { from: governance });

            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds); // start of voting round 2
            const feeds0 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123462, decimals: feedDecimals[i] });
            }
            await priceStore.submitTrustedPrices(1, feeds0, { from: newTrustedProviders[0] });

            await publishPrices();

            const { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPriceFromTrustedProviders(feedSymbols[1]);
            assertWeb3Equal(price, 123462);

            await time.increaseTo(startTs + 3 * votingEpochDurationSeconds); // start of voting round 3
            feeds0[1].value = 50;
            await priceStore.submitTrustedPrices(2, feeds0, { from: newTrustedProviders[0] });

            await publishPrices(true, 2, 2);

            const { 0: price1, 1: timestamp1, 2: decimals1 } = await priceStore.getPriceFromTrustedProviders(feedSymbols[0]);
            assert(timestamp1.gt(timestamp)); // timestamp should be updated
            const { 0: price2, 1: timestamp2, 2: decimals2 } = await priceStore.getPriceFromTrustedProviders(feedSymbols[1]);
            // should change as spread is 0 (only one trusted provider)
            assert(!price.eq(price2));
            assert(timestamp2.gt(timestamp)); // timestamp should be updated
            assertWeb3Equal(decimals, decimals2);
        });

        it("should calculate median price from 3 trusted prices but not update it with new one if spread is too big", async () => {
            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds); // start of voting round 2
            const feeds0 = [];
            const feeds1 = [];
            const feeds2 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123462, decimals: feedDecimals[i] });
                feeds1.push({ id: feedIds[i], value: 123453, decimals: feedDecimals[i] });
                feeds2.push({ id: feedIds[i], value: 123456, decimals: feedDecimals[i] });
            }
            await priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });
            await priceStore.submitTrustedPrices(1, feeds1, { from: trustedProviders[1] });
            await priceStore.submitTrustedPrices(1, feeds2, { from: trustedProviders[2] });

            await publishPrices();

            const { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPriceFromTrustedProviders(feedSymbols[1]);
            assertWeb3Equal(price, 123456);

            await time.increaseTo(startTs + 3 * votingEpochDurationSeconds); // start of voting round 3
            feeds0[1].value = 50;
            feeds1[1].value = 7;
            feeds2[1].value = 5000;
            await priceStore.submitTrustedPrices(2, feeds0, { from: trustedProviders[0] });
            await priceStore.submitTrustedPrices(2, feeds1, { from: trustedProviders[1] });
            await priceStore.submitTrustedPrices(2, feeds2, { from: trustedProviders[2] });

            await publishPrices(true, 2, 2);

            const { 0: price1, 1: timestamp1, 2: decimals1 } = await priceStore.getPriceFromTrustedProviders(feedSymbols[0]);
            assert(timestamp1.gt(timestamp)); // timestamp should be updated
            const { 0: price2, 1: timestamp2, 2: decimals2 } = await priceStore.getPriceFromTrustedProviders(feedSymbols[1]);
            // nothing should change as spread is too big
            assertWeb3Equal(price, price2);
            assertWeb3Equal(timestamp, timestamp2);
            assertWeb3Equal(decimals, decimals2);
        });

        it("should calculate median price from 4 trusted prices but not update it with new one if spread is too big", async () => {
            const newTrustedProviders = [accounts[1], accounts[2], accounts[3], accounts[4]];
            await priceStore.setTrustedProviders(newTrustedProviders, 2, { from: governance });

            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds); // start of voting round 2
            const feeds0 = [];
            const feeds1 = [];
            const feeds2 = [];
            const feeds3 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123462, decimals: feedDecimals[i] });
                feeds1.push({ id: feedIds[i], value: 123453, decimals: feedDecimals[i] });
                feeds2.push({ id: feedIds[i], value: 123456, decimals: feedDecimals[i] });
                feeds3.push({ id: feedIds[i], value: 123459, decimals: feedDecimals[i] });
            }
            await priceStore.submitTrustedPrices(1, feeds0, { from: newTrustedProviders[0] });
            await priceStore.submitTrustedPrices(1, feeds1, { from: newTrustedProviders[1] });
            await priceStore.submitTrustedPrices(1, feeds2, { from: newTrustedProviders[2] });
            await priceStore.submitTrustedPrices(1, feeds3, { from: newTrustedProviders[3] });

            await publishPrices();

            const { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPriceFromTrustedProviders(feedSymbols[1]);
            // price should be floor(123456 + 123459) / 2 = 123457
            assertWeb3Equal(price, 123457);

            await time.increaseTo(startTs + 3 * votingEpochDurationSeconds); // start of voting round 3
            feeds0[1].value = 50;
            feeds1[1].value = 7;
            feeds2[1].value = 5000;
            feeds3[1].value = 6000;
            await priceStore.submitTrustedPrices(2, feeds0, { from: newTrustedProviders[0] });
            await priceStore.submitTrustedPrices(2, feeds1, { from: newTrustedProviders[1] });
            await priceStore.submitTrustedPrices(2, feeds2, { from: newTrustedProviders[2] });
            await priceStore.submitTrustedPrices(2, feeds3, { from: newTrustedProviders[3] });

            await publishPrices(true, 2, 2);

            const { 0: price1, 1: timestamp1, 2: decimals1 } = await priceStore.getPriceFromTrustedProviders(feedSymbols[0]);
            assert(timestamp1.gt(timestamp)); // timestamp should be updated
            const { 0: price2, 1: timestamp2, 2: decimals2 } = await priceStore.getPriceFromTrustedProviders(feedSymbols[1]);
            // nothing should change as spread is too big
            assertWeb3Equal(price, price2);
            assertWeb3Equal(timestamp, timestamp2);
            assertWeb3Equal(decimals, decimals2);
        });

        //// update settings
        it("should revert if not governance", async () => {
            await expectRevert(priceStore.updateSettings([], [], [], 50), "only governance");
        });

        it("should revert if lengths mismatch", async () => {
            await expectRevert(priceStore.updateSettings([], [], [6], 50, { from: governance }), "length mismatch");
        });

        it("should revert if max spread too big", async () => {
            await expectRevert(priceStore.updateSettings([], [], [], 10001, { from: governance }), "max spread too big");
        });

        it("should delete trusted price for a symbol if changing decimals", async () => {
            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds); // start of voting round 2
            const feeds0 = [];
            const feeds1 = [];
            const feeds2 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: feedDecimals[i] });
                feeds1.push({ id: feedIds[i], value: 123455, decimals: feedDecimals[i] });
                feeds2.push({ id: feedIds[i], value: 123456, decimals: feedDecimals[i] });
            }
            await priceStore.submitTrustedPrices(1, feeds1, { from: trustedProviders[1] });
            await priceStore.submitTrustedPrices(1, feeds2, { from: trustedProviders[2] });
            await priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });

            await publishPrices();

            var { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPriceFromTrustedProviders("USDC");
            assertWeb3Equal(price, 123456);
            assertWeb3Equal(timestamp, startTs + 2 * votingEpochDurationSeconds);
            assertWeb3Equal(decimals, 5);

            // update settings; change trusted decimals for USDC
            await priceStore.updateSettings(feedIds, feedSymbols, [6, 4], 50, { from: governance });
            var { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPriceFromTrustedProviders("USDC");
            assertWeb3Equal(price, 0);
            assertWeb3Equal(timestamp, startTs + 1 * votingEpochDurationSeconds);
            assertWeb3Equal(decimals, 4);
        });

        it("should delete submitted trusted prices and therefore not calculate median price", async () => {
            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds); // start of voting round 2
            const feeds0 = [];
            const feeds1 = [];
            const feeds2 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: feedDecimals[i] });
                feeds1.push({ id: feedIds[i], value: 123455, decimals: feedDecimals[i] });
                feeds2.push({ id: feedIds[i], value: 123456, decimals: feedDecimals[i] });
            }
            await priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });
            await priceStore.submitTrustedPrices(1, feeds1, { from: trustedProviders[1] });
            await priceStore.submitTrustedPrices(1, feeds2, { from: trustedProviders[2] });

            // go to voting round 3
            await time.increaseTo(startTs + 3 * votingEpochDurationSeconds);
            await priceStore.submitTrustedPrices(2, feeds0, { from: trustedProviders[0] });
            await priceStore.submitTrustedPrices(2, feeds1, { from: trustedProviders[1] });
            await priceStore.submitTrustedPrices(2, feeds2, { from: trustedProviders[2] });

            var { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPriceFromTrustedProviders("USDC");
            assertWeb3Equal(price, 0);
            assertWeb3Equal(timestamp, startTs + 1 * votingEpochDurationSeconds);
            assertWeb3Equal(decimals, 5);

            // update settings; change trusted decimals for USDC
            let newUSDCDecimals = 4;
            await priceStore.updateSettings(feedIds, feedSymbols, [feedDecimals[0], newUSDCDecimals], 50, { from: governance });
            var { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPriceFromTrustedProviders("USDC");
            assertWeb3Equal(price, 0);
            assertWeb3Equal(timestamp, startTs + 1 * votingEpochDurationSeconds);
            assertWeb3Equal(decimals, 4);

            var { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPrice("USDC");
            assertWeb3Equal(price, 0);
            assertWeb3Equal(timestamp, startTs + 1 * votingEpochDurationSeconds);
            assertWeb3Equal(decimals, 0);

            // publish prices for voting round 1
            await publishPrices(false, 1, 1, undefined, undefined, undefined, undefined, feedDecimals[0], newUSDCDecimals);

            var { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPriceFromTrustedProviders("USDC");
            assertWeb3Equal(price, 0);
            assertWeb3Equal(timestamp, startTs + 1 * votingEpochDurationSeconds);
            assertWeb3Equal(decimals, 4);

            var { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPrice("USDC");
            assertWeb3Equal(price, 123456);
            assertWeb3Equal(timestamp, startTs + 2 * votingEpochDurationSeconds);
            assertWeb3Equal(decimals, 4);
        });

        //// set trusted providers
        it ("should revert if not governance", async () => {
            await expectRevert(priceStore.setTrustedProviders([], 1), "only governance");
        });

        it("should revert if threshold is too high", async () => {
            await expectRevert(priceStore.setTrustedProviders(trustedProviders, 4, { from: governance }), "threshold too high");
        });

        it("should revert if too many trusted providers", async () => {
            await expectRevert(priceStore.setTrustedProviders(accounts, 2, { from: governance }), "too many trusted providers");
        });

        it("should change trusted providers", async () => {
            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds); // start of voting round 2
            const feeds0 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: feedDecimals[i] });
            }
            await priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });

            // remove trusted provider 0 and replace it
            await priceStore.setTrustedProviders([trustedProviders[1], trustedProviders[2], accounts[123]], 1, { from: governance });

            // go to voting round 3
            await time.increaseTo(startTs + 3 * votingEpochDurationSeconds);

            // trusted provider 0 should not be able to submit prices
            await expectRevert(priceStore.submitTrustedPrices(2, feeds0, { from: trustedProviders[0] }), "only trusted provider");

            // new trusted provider can submit prices
            await priceStore.submitTrustedPrices(2, feeds0, { from: accounts[123] });
        });

        //// get prices
        it("should get price", async () => {
            await publishPrices();

            const { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPrice("USDC");
            assertWeb3Equal(price, 123456);
            assertWeb3Equal(timestamp, startTs + 2 * votingEpochDurationSeconds);
            assertWeb3Equal(decimals, 5);
        });

        it("should revert if symbol is not supported", async () => {
            await expectRevert(priceStore.getPrice("USDT"), "symbol not supported");
        });

        it("should get price if decimals are negative", async () => {
            await publishPrices(true, undefined, undefined, undefined, undefined, undefined, undefined, undefined, -2);

            var { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPrice("FLR");
            assertWeb3Equal(price, 123123);
            assertWeb3Equal(decimals, feedDecimals[0]);

            // decimals are -2
            var { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPrice("USDC");
            assertWeb3Equal(price, 123456 * 10 ** 2);
            assertWeb3Equal(decimals, 0);
        });

        //// get trusted prices
        it("should get trusted price", async () => {
            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds); // start of voting round 2
            const feeds0 = [];
            const feeds1 = [];
            const feeds2 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: feedDecimals[i] });
                feeds1.push({ id: feedIds[i], value: 123455, decimals: feedDecimals[i] });
                feeds2.push({ id: feedIds[i], value: 123456, decimals: feedDecimals[i] });
            }
            const tx1 = await priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });
            console.log(`submitTrustedPrices1 gas used: ${tx1.receipt.gasUsed}`);
            const tx2 = await priceStore.submitTrustedPrices(1, feeds1, { from: trustedProviders[1] });
            console.log(`submitTrustedPrices2 gas used: ${tx2.receipt.gasUsed}`);
            const tx3 = await priceStore.submitTrustedPrices(1, feeds2, { from: trustedProviders[2] });
            console.log(`submitTrustedPrices3 gas used: ${tx3.receipt.gasUsed}`);

            await publishPrices(true, undefined, undefined, undefined, undefined, undefined, undefined, undefined, -2);

            const { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPriceFromTrustedProviders("USDC");
            assertWeb3Equal(price, 123456);
            assertWeb3Equal(timestamp, startTs + 2 * votingEpochDurationSeconds);
            assertWeb3Equal(decimals, 5);
        });

        it("should revert if symbol is not supported", async () => {
            await expectRevert(priceStore.getPriceFromTrustedProviders("USDT"), "symbol not supported");
        });

        it("should get trusted price if decimals are negative", async () => {
            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds); // start of voting round 2
            const feeds0 = [];
            const feeds1 = [];
            const feeds2 = [];
            const newFeedDecimals = [3, -4];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: newFeedDecimals[i] });
                feeds1.push({ id: feedIds[i], value: 123455, decimals: newFeedDecimals[i] });
                feeds2.push({ id: feedIds[i], value: 123456, decimals: newFeedDecimals[i] });
            }
            await priceStore.updateSettings(feedIds, feedSymbols, newFeedDecimals, 50, { from: governance });
            await priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });
            await priceStore.submitTrustedPrices(1, feeds1, { from: trustedProviders[1] });

            await publishPrices();


            const { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPriceFromTrustedProviders("FLR");
            assertWeb3Equal(price, 123456);
            assertWeb3Equal(decimals, newFeedDecimals[0]);

            const { 0: price1, 1: timestamp1, 2: decimals1 } = await priceStore.getPriceFromTrustedProviders("USDC");
            assertWeb3Equal(price1, 123456 * 10 ** 4);
            assertWeb3Equal(decimals1, 0);
        });

        ////
        it("should get feed ids", async () => {
            let feeds = await priceStore.getFeedIds();
            expect(feeds.toString()).to.eq(feedIds.toString());
        });

        it("should get feed ids and decimals", async () => {
            let {0: feeds, 1: decimals} = await priceStore.getFeedIdsWithDecimals();
            expect(feeds.toString()).to.eq(feedIds.toString());
            expect(decimals.toString()).to.eq(feedDecimals.toString());
        });

        it("should get supported symbols", async () => {
            let symbols = await priceStore.getSymbols();
            expect(symbols.toString()).to.eq(feedSymbols.toString());
        });

        it("should get feed id for symbol", async () => {
            let flrFeed = await priceStore.getFeedId("FLR");
            expect(flrFeed).to.eq(feedIds[0]);

            let usdcFeed = await priceStore.getFeedId("USDC");
            expect(usdcFeed).to.eq(feedIds[1]);

            let xdcFeed = await priceStore.getFeedId("SGB");
            expect(xdcFeed).to.eq("0x" + "00".repeat(21));

            // update settings
            await priceStore.updateSettings(["0x01464c522f55534400000000000000000000000000", "0x01555344432f555344000000000000000000000000", "0x015452582f55534400000000000000000000000000"], ["FLR", "USDC", "XDC"], [6, 7, 8], 50, { from: governance });

            xdcFeed = await priceStore.getFeedId("XDC");
            expect(xdcFeed).to.eq("0x015452582f55534400000000000000000000000000");
        });

        it("should get trusted providers", async () => {
            let trProviders = await priceStore.getTrustedProviders();
            expect(trProviders.toString()).to.eq(trustedProviders.toString());

            // update trusted providers
            const newTrustedProviders = [accounts[1], accounts[2], accounts[4], accounts[5]];
            await priceStore.setTrustedProviders(newTrustedProviders, 2, { from: governance });

            trProviders = await priceStore.getTrustedProviders();
            expect(trProviders.toString()).to.eq(newTrustedProviders.toString());
        });

        it("should update contract addresses", async () => {
            await contracts.addressUpdater.update(["AddressUpdater", "Relay"],
                [accounts[79], accounts[80]],
                [priceStore.address],
                { from: governance });
            assert.equal(await priceStore.getAddressUpdater(), accounts[79]);
            assert.equal(await priceStore.relay(), accounts[80]);
        });
    });

    describe("ERC-165 interface identification", () => {
        it("should properly respond to supportsInterface", async () => {
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as 'IERC165');
            const IPriceReader = artifacts.require("IPriceReader");
            const IPricePublisher = artifacts.require("IPricePublisher");
            const iERC165 = await IERC165.at(priceStore.address);
            const iPriceReader = await IPriceReader.at(priceStore.address);
            const iPricePublisher = await IPricePublisher.at(priceStore.address);
            assert.isTrue(await priceStore.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await priceStore.supportsInterface(erc165InterfaceId(iPriceReader.abi)));
            assert.isTrue(await priceStore.supportsInterface(erc165InterfaceId(iPricePublisher.abi)));
            assert.isFalse(await priceStore.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });

    async function publishPrices(increaseTime = true, votingRound1: number = 1, votingRound2: number = 1, feedId1: string = feedIds[0], feedId2: string = feedIds[1], value1: number = 123123, value2: number = 123456, decimals1: number = feedDecimals[0], decimals2: number = feedDecimals[1], zeroRoot: boolean = false) {
        if (increaseTime) {
            // increase time to the end of reveal time and submission window of voting round 1
            await time.increaseTo(startTs + (votingRound1 + 1) * votingEpochDurationSeconds + votingEpochDurationSeconds / 2);
        }
        const feed0 = { votingRoundId: votingRound1, id: feedId1, value: value1, turnoutBIPS: 10000, decimals: decimals1 };
        const feed1 = { votingRoundId: votingRound2, id: feedId2, value: value2, turnoutBIPS: 10000, decimals: decimals2 };

        const leaf0 = web3.utils.keccak256(web3.eth.abi.encodeParameters(
            ["tuple(uint32,bytes21,int32,uint16,int8)"], // IFtsoFeedPublisher.Feed (uint32 votingRoundId, bytes21 id, int32 value, uint16 turnoutBIPS, int8 decimals)
            [[feed0.votingRoundId, feed0.id, feed0.value, feed0.turnoutBIPS, feed0.decimals]]
        ));

        const leaf1 = web3.utils.keccak256(web3.eth.abi.encodeParameters(
            ["tuple(uint32,bytes21,int32,uint16,int8)"], // IFtsoFeedPublisher.Feed (uint32 votingRoundId, bytes21 id, int32 value, uint16 turnoutBIPS, int8 decimals)
            [[feed1.votingRoundId, feed1.id, feed1.value, feed1.turnoutBIPS, feed1.decimals]]
        ));

        const merkleRoot = web3.utils.keccak256(web3.eth.abi.encodeParameters(
            ["bytes32", "bytes32"],
            leaf0 < leaf1 ? [leaf0, leaf1] : [leaf1, leaf0]
        ));

        if (zeroRoot) {
            await relayMock.givenCalldataReturn(
                web3.eth.abi.encodeFunctionCall({ type: "function", name: "merkleRoots", inputs: [{ name: "_protocolId", type: "uint256" }, { name: "_votingRoundId", type: "uint256" }] } as AbiItem, [ftsoScalingProtocolId, votingRound1] as any[]),
                web3.eth.abi.encodeParameter("bytes32", "0x" + "00".repeat(32))
            );
        }
        else {
            await relayMock.givenCalldataReturn(
                web3.eth.abi.encodeFunctionCall({ type: "function", name: "merkleRoots", inputs: [{ name: "_protocolId", type: "uint256" }, { name: "_votingRoundId", type: "uint256" }] } as AbiItem, [ftsoScalingProtocolId, votingRound1] as any[]),
                web3.eth.abi.encodeParameter("bytes32", merkleRoot)
            );
        }

        let tx = await priceStore.publishPrices([{ proof: [leaf1], body: feed0 }, { proof: [leaf0], body: feed1 }]);
        console.log(`publishPrices gas used: ${tx.receipt.gasUsed}`);
    }

});
