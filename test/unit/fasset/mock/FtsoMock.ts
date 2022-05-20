import { FtsoMockInstance } from "../../../../typechain-truffle";
import { getTestFile, toBNExp } from "../../../utils/helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";

const FtsoMock = artifacts.require('FtsoMock');

contract(`FtsoMock.sol; ${getTestFile(__filename)}; Ftso mock basic tests`, async accounts => {
    let natFtso: FtsoMockInstance;

    describe("create and set", () => {
        it("should create", async () => {
            natFtso = await FtsoMock.new("NAT");
        });
        it("should set price", async () => {
            natFtso = await FtsoMock.new("NAT");
            let priceSet = toBNExp(1.12, 5);
            await natFtso.setCurrentPrice(priceSet, 0);
            const {0: natPrice, } = await natFtso.getCurrentPrice();
            assertWeb3Equal(priceSet, natPrice);
        });
        it("should set price - trusted provider", async () => {
            natFtso = await FtsoMock.new("NAT");
            const {0: natPriceBefore, } = await natFtso.getCurrentPriceFromTrustedProviders();
            let priceSet = toBNExp(1.12, 5);
            await natFtso.setCurrentPriceFromTrustedProviders(priceSet, 0);
            const {0: natPrice, } = await natFtso.getCurrentPriceFromTrustedProviders();
            assertWeb3Equal(priceSet, natPrice);
            expect(priceSet).to.not.eql(natPriceBefore);
        });
    });
});