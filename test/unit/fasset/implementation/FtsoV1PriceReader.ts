import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
import { erc165InterfaceId } from "../../../../lib/utils/helpers";
import { FtsoV1PriceReaderInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { TestFtsos, TestSettingsContracts, createTestContracts, createTestFtsos } from "../../../utils/test-settings";
import { assertWeb3Equal } from "../../../utils/web3assertions";

const FtsoV1PriceReader = artifacts.require('FtsoV1PriceReader');

contract(`FtsoV1PriceReader.sol; ${getTestFile(__filename)}; FtsoV1PriceReader basic tests`, async accounts => {
    let contracts: TestSettingsContracts;
    let ftsos: TestFtsos;
    let priceReader: FtsoV1PriceReaderInstance;
    const governance = accounts[10];

    async function initialize() {
        contracts = await createTestContracts(governance);
        priceReader = await FtsoV1PriceReader.new(contracts.addressUpdater.address, contracts.ftsoRegistry.address);
        ftsos = await createTestFtsos(contracts.ftsoRegistry, testChainInfo.xrp);
        return { contracts, priceReader, ftsos };
    }

    beforeEach(async () => {
        ({ contracts, priceReader, ftsos } = await loadFixtureCopyVars(initialize));
    });

    describe("method tests", () => {
        it("should require nonzero ftsoRegistry", async () => {
            const pr = FtsoV1PriceReader.new(contracts.addressUpdater.address, constants.ZERO_ADDRESS);
            await expectRevert(pr, "zero address");
        });

        it("should get price", async () => {
            await ftsos.usdc.setCurrentPrice(123456, 10);
            const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPrice("USDC");
            assertWeb3Equal(price, 123456);
            assertWeb3Equal(timestamp, (await time.latest()).subn(10));
            assertWeb3Equal(decimals, 5);
        });

        it("should get trusted price", async () => {
            await ftsos.usdc.setCurrentPriceFromTrustedProviders(123456, 10);
            const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPriceFromTrustedProviders("USDC");
            assertWeb3Equal(price, 123456);
            assertWeb3Equal(timestamp, (await time.latest()).subn(10));
            assertWeb3Equal(decimals, 5);
        });

        it("should update contract addresses", async () => {
            await contracts.addressUpdater.update(["AddressUpdater", "FtsoRegistry"],
                [accounts[79], accounts[80]],
                [priceReader.address],
                { from: governance });
            assert.equal(await priceReader.getAddressUpdater(), accounts[79]);
            assert.equal(await priceReader.ftsoRegistry(), accounts[80]);
        });
    });

    describe("ERC-165 interface identification", () => {
        it("should properly respond to supportsInterface", async () => {
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as 'IERC165');
            const IPriceReader = artifacts.require("IPriceReader");
            const iERC165 = await IERC165.at(priceReader.address);
            const iPriceReader = await IPriceReader.at(priceReader.address);
            assert.isTrue(await priceReader.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await priceReader.supportsInterface(erc165InterfaceId(iPriceReader.abi)));
            assert.isFalse(await priceReader.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });
});
