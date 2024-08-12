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
        fAsset = await FAsset.new("FEthereum", "FETH", "Ethereum", "ETH", 18, { from: governance });
        return { fAsset };
    }

    beforeEach(async () => {
        ({ fAsset } = await loadFixtureCopyVars(initialize));
    });

    describe("basic tests", () => {
        it("metadata should match", async function () {
            assert.equal(await fAsset.name(), "FEthereum");
            assert.equal(await fAsset.symbol(), "FETH");
            assert.equal(await fAsset.assetName(), "Ethereum");
            assert.equal(await fAsset.assetSymbol(), "ETH");
            assert.equal(String(await fAsset.decimals()), "18");
        });

        it('should not set asset manager if not governance', async function () {
            const promise = fAsset.setAssetManager(assetManager);
            await expectRevert(promise, "only deployer")
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

        it('only asset manager should be able to mint FAssets', async function () {
            await fAsset.setAssetManager(assetManager, { from: governance });
            const amount = 100;
            let res = fAsset.mint(accounts[1], amount,{ from: accounts[5] });
            await expectRevert(res, "only asset manager");
        });

        it('only asset manager should be able to burn FAssets', async function () {
            await fAsset.setAssetManager(assetManager, { from: governance });
            const mint_amount = 100;
            const burn_amount = 20;
            await fAsset.mint(accounts[1], mint_amount,{ from: assetManager });
            let res = fAsset.burn(accounts[1], burn_amount,{ from: accounts[5] } );
            await expectRevert(res, "only asset manager");
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
            const res = fAsset.burn(accounts[1], burn_amount,{ from: assetManager } );
            await expectRevert(res, "f-asset balance too low");
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
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as "IERC165");
            const IERC20 = artifacts.require("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20" as "IERC20");
            const IERC20Metadata = artifacts.require("@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol:IERC20Metadata" as "IERC20Metadata");
            const IICleanable = artifacts.require("flare-smart-contracts/contracts/token/interface/IICleanable.sol:IICleanable" as "IICleanable");
            const ICheckPointable = artifacts.require("ICheckPointable");
            const IFasset = artifacts.require("IFAsset");
            const IIFasset = artifacts.require("IIFAsset");
            //
            const iERC165 = await IERC165.at(fAsset.address);
            const iERC20 = await IERC20.at(fAsset.address);
            const iERC20Metadata = await IERC20Metadata.at(fAsset.address);
            const iFasset = await IFasset.at(fAsset.address);
            const iiFasset = await IIFasset.at(fAsset.address);
            const iCheckPointable = await ICheckPointable.at(fAsset.address);
            const iiCleanable = await IICleanable.at(fAsset.address);
            //
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iERC20.abi)));
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iERC20Metadata.abi, [iERC20.abi])));
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iCheckPointable.abi)));
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iFasset.abi, [iERC20.abi, iERC20Metadata.abi])));
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iiCleanable.abi)));
            assert.isTrue(await fAsset.supportsInterface(erc165InterfaceId(iiFasset.abi, [iFasset.abi, iCheckPointable.abi, iiCleanable.abi])));
            assert.isFalse(await fAsset.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });
});
