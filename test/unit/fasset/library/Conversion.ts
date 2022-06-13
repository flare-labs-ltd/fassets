import { ConversionMockContract, ConversionMockInstance } from "../../../../typechain-truffle/ConversionMock";
import { getTestFile, toBN, toStringExp } from "../../../utils/helpers";

const Conversion = artifacts.require("ConversionMock") as ConversionMockContract;

contract(`Conversion.sol; ${getTestFile(__filename)};  Conversion unit tests`, async accounts => {
    let conversion: ConversionMockInstance;
    let amgToNATWeiPrice = 2;

    before(async() => {
        conversion = await Conversion.new();
    });

    it("should convert correctly", async () => {
        let amgValue = toStringExp(1, 9);
        let res = await conversion.convertAmgToNATWei(amgValue, amgToNATWeiPrice);
        let expected = 2;
        expect(res).to.eql(toBN(expected));
    });
    it("should convert correctly - 2", async () => {
        let natWeiValue = toStringExp(1, 18);
        let res = await conversion.convertNATWeiToAMG(natWeiValue, amgToNATWeiPrice);
        let expected = toStringExp(5, 26);
        expect(res).to.eql(toBN(expected));
    });
});