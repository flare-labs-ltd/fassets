import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
import { erc165InterfaceId } from "../../../../lib/utils/helpers";
import { FAssetInstance, IERC165Contract, IERC20Contract, IICleanableContract, IIVPTokenContract, IVPTokenContract } from "../../../../typechain-truffle";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";

const FAsset = artifacts.require('FAsset');

contract(`FAsset.sol; ${getTestFile(__filename)}; FAsset basic tests`, async accounts => {
    let fAsset: FAssetInstance;
    const governance = accounts[10];
    const assetManager = accounts[11];

    async function initialize() {
        fAsset = await FAsset.new(governance, "Ethereum", "ETH", 18);
        return { fAsset };
    }

    beforeEach(async () => {
        ({ fAsset } = await loadFixtureCopyVars(initialize));
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

    describe("ERC-165 interface identification", () => {
        it("should properly respond to supportsInterface", async () => {
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as any) as any as IERC165Contract;
            const IERC20 = artifacts.require("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20" as any) as any as IERC20Contract;
            const IFasset = artifacts.require("IFAsset");
            const IVPToken = artifacts.require("flare-smart-contracts/contracts/userInterfaces/IVPToken.sol:IVPToken" as any) as any as IVPTokenContract;
            const IIVPToken = artifacts.require("flare-smart-contracts/contracts/token/interface/IIVPToken.sol:IIVPToken" as any) as any as IIVPTokenContract;
            const IICleanable = artifacts.require("flare-smart-contracts/contracts/token/interface/IICleanable.sol:IICleanable" as any) as any as IICleanableContract;
            const iERC165 = await IERC165.at(fAsset.address);
            const iERC20 = await IERC20.at(fAsset.address);
            const iFasset = await IFasset.at(fAsset.address);
            const iVPToken = await IVPToken.at(fAsset.address);
            const iiVPToken = await IIVPToken.at(fAsset.address);
            const iiCleanable = await IICleanable.at(fAsset.address);
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iERC20.abi)));
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iVPToken.abi, [iERC20.abi])));
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iFasset.abi)));
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iiCleanable.abi)));
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iiVPToken.abi, [iVPToken.abi, iiCleanable.abi])));
            assert.isFalse(await fAsset.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });
});
