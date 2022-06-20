import { expectRevert } from "@openzeppelin/test-helpers";
import { WhitelistInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";

const Whitelist = artifacts.require('Whitelist');

contract(`Whitelist.sol; ${getTestFile(__filename)}; Whitelist basic tests`, async accounts => {
    let whitelist: WhitelistInstance;
    const governance = accounts[10];
    const whitelistedAddresses = [accounts[0], accounts[1]];

    beforeEach(async () => {
        whitelist = await Whitelist.new(governance);
    });

    describe("whitelist functions", () => {
        
        it('should not add addresses if not governance', async function () {
            let res = whitelist.addAddressesToWhitelist(whitelistedAddresses);
            await expectRevert(res, "only governance")
          });

        it('should add addresses to the whitelist', async function () {
            let res = await whitelist.addAddressesToWhitelist(whitelistedAddresses, {from: governance});
            const isWhitelisted0 = await whitelist.isWhitelisted(whitelistedAddresses[0]);
            const isWhitelisted1 = await whitelist.isWhitelisted(whitelistedAddresses[1]);
            
            assert.equal(isWhitelisted0, true);
            assert.equal(isWhitelisted1, true);
          });
    });
});
