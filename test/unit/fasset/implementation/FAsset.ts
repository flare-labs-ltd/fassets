import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
import { FAssetInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/test-helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";

const FAsset = artifacts.require('FAsset');

contract(`FAsset.sol; ${getTestFile(__filename)}; FAsset basic tests`, async accounts => {
    let fAsset: FAssetInstance;
    const governance = accounts[10];
    const assetManager = accounts[11];

    beforeEach(async () => {
        fAsset = await FAsset.new(governance, "Ethereum", "ETH", 18);
    });

    describe("basic tests", () => {

        it('should not set asset manager if not governance', async function () {
            const promise = fAsset.setAssetManager(assetManager);
            await expectRevert(promise, "only governance")
        });

        it('should not set asset manager to zero address', async function () {
            const promise = fAsset.setAssetManager(constants.ZERO_ADDRESS, { from: governance });
            await expectRevert(promise, "zero asset manager")
        });

        it('should not replace asset manager', async function () {
            await fAsset.setAssetManager(assetManager, { from: governance });
            const promise = fAsset.setAssetManager(assetManager, { from: governance });
            await expectRevert(promise, "cannot replace asset manager")
        });

        it('should only be terminated by asset manager', async function () {
            await fAsset.setAssetManager(assetManager, { from: governance });
            const promise = fAsset.terminate({ from: governance });
            await expectRevert(promise, "only asset manager");
            assert.isFalse(await fAsset.terminated());
            await fAsset.terminate({ from: assetManager });
            assert.isTrue(await fAsset.terminated());
            const terminatedAt = await fAsset.terminatedAt();
            await time.increase(100);
            await fAsset.terminate({ from: assetManager });
            const terminatedAt2 = await fAsset.terminatedAt();
            assertWeb3Equal(terminatedAt, terminatedAt2);
        });

        it('should mint FAsset', async function () {
            await fAsset.setAssetManager(assetManager, { from: governance });
            const amount = 100;
            await fAsset.mint(accounts[1], amount,{ from: assetManager });
            const balance = await fAsset.balanceOf(accounts[1]);
            assertWeb3Equal(balance.toNumber(), amount);
        });

        it('should burn FAsset', async function () {
            await fAsset.setAssetManager(assetManager, { from: governance });
            const mint_amount = 100;
            const burn_amount = 20;
            await fAsset.mint(accounts[1], mint_amount,{ from: assetManager });
            await fAsset.burn(accounts[1], burn_amount,{ from: assetManager } )
            const balance = await fAsset.balanceOf(accounts[1]);
            assertWeb3Equal(balance.toNumber(), mint_amount-burn_amount);
        });

        it('should not burn FAsset', async function () {
            await fAsset.setAssetManager(assetManager, { from: governance });
            const mint_amount = 10;
            const burn_amount = 20;
            await fAsset.mint(accounts[1], mint_amount,{ from: assetManager });
            const res = fAsset.burn(accounts[1], burn_amount,{ from: assetManager } )
            await expectRevert(res, "Burn too big for owner");
        });

        it('should not be able to transfer if terminated', async function () {
            await fAsset.setAssetManager(assetManager, { from: governance });
            const mint_amount = 100;
            await fAsset.mint(accounts[1], mint_amount,{ from: assetManager });
            await fAsset.terminate({ from: assetManager });
            const res = fAsset.transfer(accounts[2], 50, { from: accounts[1]});
            await expectRevert(res, "f-asset terminated");
        });
    });
});
