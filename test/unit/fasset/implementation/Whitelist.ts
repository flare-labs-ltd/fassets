import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { erc165InterfaceId, ZERO_ADDRESS } from "../../../../lib/utils/helpers";
import { IERC165Contract, WhitelistInstance } from "../../../../typechain-truffle";
import { GENESIS_GOVERNANCE_ADDRESS } from "../../../utils/constants";
import { waitForTimelock } from "../../../utils/fasset/CreateAssetManager";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";

const Whitelist = artifacts.require('Whitelist');
const GovernanceSettings = artifacts.require('GovernanceSettings');

contract(`Whitelist.sol; ${getTestFile(__filename)}; Whitelist basic tests`, async accounts => {
    let whitelist: WhitelistInstance;
    const governance = accounts[10];
    const whitelistedAddresses = [accounts[0], accounts[1]];

    async function initialize() {
        // create governance settings
        const governanceSettings = await GovernanceSettings.new();
        await governanceSettings.initialise(governance, 60, [governance], { from: GENESIS_GOVERNANCE_ADDRESS });
        // create whitelist
        whitelist = await Whitelist.new(governanceSettings.address, governance, true);
        await whitelist.switchToProductionMode({ from: governance });
        return { whitelist };
    }

    beforeEach(async () => {
        ({ whitelist } = await loadFixtureCopyVars(initialize));
    });

    describe("whitelist functions", () => {

        it('should not add addresses if not governance or manager', async function () {
            let res = whitelist.addAddressesToWhitelist(whitelistedAddresses);
            await expectRevert(res, "only governance or manager");
        });

        it('should not add address if not governance or manager', async function () {
            let res = whitelist.addAddressToWhitelist(accounts[5]);
            await expectRevert(res, "only governance or manager");
        });

        it('should not add address 0', async function () {
            let res = whitelist.addAddressToWhitelist(ZERO_ADDRESS, {from: governance});
            await expectRevert(res, "address zero");
        });

        it('should add addresses to the whitelist', async function () {
            let res = await whitelist.addAddressesToWhitelist(whitelistedAddresses, {from: governance});
            expectEvent(res, "Whitelisted");
            const isWhitelisted0 = await whitelist.isWhitelisted(whitelistedAddresses[0]);
            const isWhitelisted1 = await whitelist.isWhitelisted(whitelistedAddresses[1]);

            assert.equal(isWhitelisted0, true);
            assert.equal(isWhitelisted1, true);
        });

        it('should not add addresses to the whitelist twice', async function () {
            let res = await whitelist.addAddressesToWhitelist(whitelistedAddresses, { from: governance });
            expectEvent(res, "Whitelisted");
            let res2 = await whitelist.addAddressesToWhitelist(whitelistedAddresses, { from: governance });
            expectEvent.notEmitted(res2, "Whitelisted");
            let res3 = await whitelist.addAddressToWhitelist(whitelistedAddresses[0], { from: governance });
            expectEvent.notEmitted(res3, "Whitelisted");
        });

        it('should revoke addresses from the whitelist', async function () {
            let res_1 = await whitelist.addAddressToWhitelist(whitelistedAddresses[0], {from: governance});
            let res_2 = await whitelist.addAddressToWhitelist(whitelistedAddresses[1], {from: governance});
            const isWhitelisted0 = await whitelist.isWhitelisted(whitelistedAddresses[0]);
            const isWhitelisted1 = await whitelist.isWhitelisted(whitelistedAddresses[1]);

            assert.equal(isWhitelisted0, true);
            assert.equal(isWhitelisted1, true);

            await whitelist.revokeAddress(whitelistedAddresses[0], {from: governance});
            const isRevoked = await whitelist.isWhitelisted(whitelistedAddresses[0]);
            assert.equal(isRevoked, false);
        });

        it("should not revoke address from the whitelist if not governance or manager", async () => {
            await whitelist.addAddressToWhitelist(whitelistedAddresses[0], {from: governance});
            await expectRevert(whitelist.revokeAddress(whitelistedAddresses[0], {from: accounts[5]}), "only governance or manager");
        });

        it('should not revoke addresses from the whitelist twice', async function () {
            let res = await whitelist.addAddressesToWhitelist(whitelistedAddresses, { from: governance });
            expectEvent(res, "Whitelisted");
            let res2w = await whitelist.revokeAddress(whitelistedAddresses[0], { from: governance });
            expectEvent(res2w, "WhitelistingRevoked");
            let res3w = await whitelist.revokeAddress(whitelistedAddresses[0], { from: governance });
            expectEvent.notEmitted(res3w, "WhitelistingRevoked");
            let res4w = await whitelist.revokeAddress(accounts[5], { from: governance });
            expectEvent.notEmitted(res4w, "WhitelistingRevoked");
        });

        it('should not revoke address from the whitelist if revoke is not supported', async function () {
            let whitelist2: WhitelistInstance;
            const governanceSettings = await GovernanceSettings.new();
            await governanceSettings.initialise(governance, 60, [governance], { from: GENESIS_GOVERNANCE_ADDRESS });
            whitelist2 = await Whitelist.new(governanceSettings.address, governance, false);
            await whitelist2.switchToProductionMode({ from: governance });
            await whitelist2.addAddressToWhitelist(whitelistedAddresses[0], {from: governance});
            await expectRevert(whitelist2.revokeAddress(whitelistedAddresses[0], {from: governance}), "revoke not supported");
        });

        it("should set allowAll", async () => {
            assert.isFalse(await whitelist.allowAll());
            await waitForTimelock(whitelist.setAllowAll(true, { from: governance }), whitelist, governance);
            assert.isTrue(await whitelist.allowAll());
        });

        it("should allow any address when allowAll is true", async () => {
            assert.isFalse(await whitelist.isWhitelisted("0x5c0cA8E3e3168e56615B69De71ED6BB113822BE2"));
            await waitForTimelock(whitelist.setAllowAll(true, { from: governance }), whitelist, governance);
            assert.isTrue(await whitelist.isWhitelisted("0x5c0cA8E3e3168e56615B69De71ED6BB113822BE2"));
        });

        it("only governance can set allowAll", async () => {
            await expectRevert(whitelist.setAllowAll(true, { from: accounts[1] }), "only governance");
        });

        it("governance can assign manager", async () => {
            const manager = accounts[15];
            const res = await waitForTimelock(whitelist.setManager(manager, { from: governance }), whitelist, governance);
            expectEvent(res, "ManagerChanged", { manager });
        });

        it("manager can perform whitelisting operations", async () => {
            const manager = accounts[15];
            // cannot whitelist before being set
            await expectRevert(whitelist.addAddressToWhitelist(accounts[5], { from: manager }), "only governance or manager");
            //
            await waitForTimelock(whitelist.setManager(manager, { from: governance }), whitelist, governance);
            // single
            await whitelist.addAddressToWhitelist(accounts[5], { from: manager });
            assert.isTrue(await whitelist.isWhitelisted(accounts[5]));
            // multiple
            await whitelist.addAddressesToWhitelist(whitelistedAddresses, { from: manager });
            for (const address of whitelistedAddresses) {
                assert.isTrue(await whitelist.isWhitelisted(address));
            }
            // revoke
            await whitelist.revokeAddress(accounts[5], { from: manager });
            assert.isFalse(await whitelist.isWhitelisted(accounts[5]));
        });
    });

    describe("ERC-165 interface identification for Agent Vault", () => {
        it("should properly respond to supportsInterface", async () => {
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as any) as any as IERC165Contract;
            const IWhitelist = artifacts.require("IWhitelist");
            const iERC165 = await IERC165.at(whitelist.address);
            const iWhitelist = await IWhitelist.at(whitelist.address);
            assert.isTrue(await whitelist.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await whitelist.supportsInterface(erc165InterfaceId(iWhitelist.abi)));
            assert.isFalse(await whitelist.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });
});
