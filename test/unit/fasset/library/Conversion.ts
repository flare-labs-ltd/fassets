import { toBN, toStringExp } from "../../../../lib/utils/helpers";
import { ConversionMockContract, ConversionMockInstance } from "../../../../typechain-truffle/ConversionMock";
import { getTestFile } from "../../../utils/test-helpers";

const Conversion = artifacts.require("ConversionMock") as ConversionMockContract;

contract(`Conversion.sol; ${getTestFile(__filename)};  Conversion unit tests`, async accounts => {
    let conversion: ConversionMockInstance;
    let amgToNATWeiPrice = 2;

    before(async() => {
        conversion = await Conversion.new();
    });

    it("should convert correctly", async () => {
        let amgValue = toStringExp(1, 9);
        let res = await conversion.convertAmgToTokenWei(amgValue, amgToNATWeiPrice);
        let expected = 2;
        expect(res).to.eql(toBN(expected));
    });

    it("should convert correctly - 2", async () => {
        let natWeiValue = toStringExp(1, 18);
        let res = await conversion.convertTokenWeiToAMG(natWeiValue, amgToNATWeiPrice);
        let expected = toStringExp(5, 26);
        expect(res).to.eql(toBN(expected));
    });

    it("should calculate correct AMG to Wei price", async () => {
        const AMG_TOKENWEI_PRICE_SCALE = 1e9;
        await conversion.setAssetDecimals(18, 9);
        const price1 = await conversion.calcAmgToTokenWeiPrice(18, 1e5, 5, 1621e5, 5);
        assert.equal(Number(price1), 1621e9 * AMG_TOKENWEI_PRICE_SCALE);
        const wei1 = await conversion.convertAmgToTokenWei(1, price1);
        assert.equal(Number(wei1), 1621e9);
        const wei1_5 = await conversion.convertAmgToTokenWei(5, price1);
        assert.equal(Number(wei1_5), 5 * 1621e9);
    });
});
