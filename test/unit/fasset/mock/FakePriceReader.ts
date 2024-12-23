import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { erc165InterfaceId } from "../../../../lib/utils/helpers";
import { FakePriceReaderInstance } from "../../../../typechain-truffle";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { Web3EventDecoder } from "../../../utils/Web3EventDecoder";

const FakePriceReader = artifacts.require('FakePriceReader');

contract(`FakePriceReader.sol; ${getTestFile(__filename)}; FakePriceReader basic tests`, async accounts => {
    let priceReader: FakePriceReaderInstance;
    const provider = accounts[11];

    async function initialize() {
        priceReader = await FakePriceReader.new(provider);
        return { priceReader };
    }

    beforeEach(async () => {
        ({ priceReader } = await loadFixtureCopyVars(initialize));
    });

    describe("method tests", () => {
        it("should set and get price", async () => {
            await priceReader.setDecimals("USDC", 5, { from: provider });
            await priceReader.setPrice("USDC", 123456, { from: provider });
            const ts = await time.latest();
            const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPrice("USDC");
            assertWeb3Equal(price, 123456);
            assertWeb3Equal(timestamp, ts);
            assertWeb3Equal(decimals, 5);
        });

        it("should set and get two prices", async () => {
            await priceReader.setDecimals("USDC", 5, { from: provider });
            await priceReader.setDecimals("ETH", 6, { from: provider });
            await priceReader.setPrice("USDC", 123456, { from: provider });
            const ts = await time.latest();
            await priceReader.setPrice("ETH", 1234567890, { from: provider });
            const ts2 = await time.latest();
            const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPrice("USDC");
            assertWeb3Equal(price, 123456);
            assertWeb3Equal(timestamp, ts);
            assertWeb3Equal(decimals, 5);
            const { 0: price2, 1: timestamp2, 2: decimals2 } = await priceReader.getPrice("ETH");
            assertWeb3Equal(price2, 1234567890);
            assertWeb3Equal(timestamp2, ts2);
            assertWeb3Equal(decimals2, 6);
        });

        it("should set and get trusted price", async () => {
            await priceReader.setDecimals("USDC", 5, { from: provider });
            await priceReader.setPrice("USDC", 123456, { from: provider });
            const ts = await time.latest();
            await priceReader.setPriceFromTrustedProviders("USDC", 100000, { from: provider });
            const ts2 = await time.latest();
            const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPrice("USDC");
            assertWeb3Equal(price, 123456);
            assertWeb3Equal(timestamp, ts);
            assertWeb3Equal(decimals, 5);
            const { 0: price2, 1: timestamp2, 2: decimals2 } = await priceReader.getPriceFromTrustedProviders("USDC");
            assertWeb3Equal(price2, 100000);
            assertWeb3Equal(timestamp2, ts2);
            assertWeb3Equal(decimals2, 5);
            const { 0: price3, 1: timestamp3, 2: decimals3, 3: numberOfSubmits3 } = await priceReader.getPriceFromTrustedProvidersWithQuality("USDC");
            assertWeb3Equal(price3, 100000);
            assertWeb3Equal(timestamp3, ts2);
            assertWeb3Equal(decimals3, 5);
            assertWeb3Equal(numberOfSubmits3, 0);
        });

        it("only provider can set price or decimals", async () => {
            const pr1 = priceReader.setDecimals("USDC", 5);
            await expectRevert(pr1, "only provider");
            const pr2 = priceReader.setPrice("USDC", 123456);
            await expectRevert(pr2, "only provider");
            const pr3 = priceReader.setPriceFromTrustedProviders("USDC", 123456);
            await expectRevert(pr3, "only provider");
        });

        it("decimals have to be set to set or get prices", async () => {
            const pr1 = priceReader.setPrice("USDC", 123456, { from: provider });
            await expectRevert(pr1, "price not initialized");
            const pr2 = priceReader.setPriceFromTrustedProviders("USDC", 123456, { from: provider });
            await expectRevert(pr2, "price not initialized");
            const pr3 = priceReader.getPrice("USDC");
            await expectRevert(pr3, "price not initialized");
            const pr4 = priceReader.getPriceFromTrustedProviders("USDC");
            await expectRevert(pr4, "price not initialized");
        });

        it("should emit PriceEpochFinalized event", async () => {
            const res = await priceReader.finalizePrices({ from: provider });
            expectEvent(res, 'PriceEpochFinalized');
        });

        it("PriceEpochFinalized event in price reader should have the same signature as the one in FtsoManager", async () => {
            const res = await priceReader.finalizePrices({ from: provider });
            const FtsoManagerMock = artifacts.require('FtsoManagerMock');
            const fakeFtsoManager = await FtsoManagerMock.at(priceReader.address);
            const decoder = new Web3EventDecoder({ fakeFtsoManager });
            assert.isTrue(decoder.decodeEvents(res).find(ev => ev.event === 'PriceEpochFinalized') != null, "cannot find correct event signature");
        });
    });

    describe("ERC-165 interface identification", () => {
        it("should properly respond to supportsInterface", async () => {
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as 'IERC165');
            const IPriceReader = artifacts.require("IPriceReader");
            const IPriceChangeEmitter = artifacts.require("IPriceChangeEmitter");
            const iERC165 = await IERC165.at(priceReader.address);
            const iPriceReader = await IPriceReader.at(priceReader.address);
            const iPriceChangeEmitter = await IPriceChangeEmitter.at(priceReader.address);
            assert.isTrue(await priceReader.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await priceReader.supportsInterface(erc165InterfaceId(iPriceReader.abi)));
            assert.isTrue(await priceReader.supportsInterface(erc165InterfaceId(iPriceChangeEmitter.abi)));
            assert.isFalse(await priceReader.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });
});
