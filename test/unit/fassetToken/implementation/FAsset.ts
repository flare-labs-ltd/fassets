import { stopImpersonatingAccount } from "@nomicfoundation/hardhat-network-helpers";
import { expectRevert, time } from "@openzeppelin/test-helpers";
import { abiEncodeCall, erc165InterfaceId, toBNExp, ZERO_ADDRESS } from "../../../../lib/utils/helpers";
import { FAssetInstance } from "../../../../typechain-truffle";
import { impersonateContract } from "../../../utils/contract-test-helpers";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";

const FAsset = artifacts.require('FAsset');
const FAssetProxy = artifacts.require('FAssetProxy');
const MockContract = artifacts.require('MockContract');

contract(`FAsset.sol; ${getTestFile(__filename)}; FAsset basic tests`, async accounts => {
    const governance = accounts[10];
    let fAsset: FAssetInstance;
    let assetManager: string;

    async function initialize() {
        const fAssetImpl = await FAsset.new();
        const fAssetProxy = await FAssetProxy.new(fAssetImpl.address, "FEthereum", "FETH", "Ethereum", "ETH", 18, { from: governance });
        const assetManagerMock = await MockContract.new();
        await assetManagerMock.givenMethodReturnUint(web3.eth.abi.encodeFunctionSignature("fassetFeeForTransfer(uint256)"), 0);
        await assetManagerMock.givenMethodReturn(web3.eth.abi.encodeFunctionSignature("fassetTransferFeePaid(uint256)"), "0x");
        assetManager = assetManagerMock.address;
        await impersonateContract(assetManager, toBNExp(1000, 18), accounts[0]);
        fAsset = await FAsset.at(fAssetProxy.address);
        return { fAsset, assetManager };
    }

    beforeEach(async () => {
        ({ fAsset, assetManager } = await loadFixtureCopyVars(initialize));
    });

    after(async () => {
        await stopImpersonatingAccount(assetManager);
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
            const promise = fAsset.setAssetManager(ZERO_ADDRESS, { from: governance });
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

        it('should not transfer FAsset to self', async function () {
            await fAsset.setAssetManager(assetManager, { from: governance });
            const amount = 100;
            await fAsset.mint(accounts[1], amount, { from: assetManager });
            await expectRevert(fAsset.transfer(accounts[1], amount, { from: accounts[1] }), "Cannot transfer to self");
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

    describe("history cleanup", async function() {
        beforeEach(async () => {
            await fAsset.setAssetManager(assetManager, { from: governance });
            await fAsset.setCleanupBlockNumberManager(accounts[8], { from: assetManager });
        });

        it("some methods may only be cleaned by asset manager", async () => {
            await expectRevert(fAsset.setCleanerContract(accounts[8]), "only asset manager");
            await expectRevert(fAsset.setCleanupBlockNumberManager(accounts[8]), "only asset manager");
        });

        it("cleanup block number may only be called by the cleanup block number manager", async () => {
            await expectRevert(fAsset.setCleanupBlockNumber(5), "only cleanup block manager");
        });

        it("calling history cleanup methods directly is forbidden", async () => {
            // Assemble
            await fAsset.mint(accounts[1], 100, { from: assetManager });
            await fAsset.mint(accounts[2], 100, { from: assetManager });
            const blk1 = await web3.eth.getBlockNumber();
            const blk2 = await web3.eth.getBlockNumber();
            // Act
            await fAsset.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // Assert
            await expectRevert(fAsset.totalSupplyHistoryCleanup(1), "Only cleaner contract");
            await expectRevert(fAsset.balanceHistoryCleanup(accounts[1], 1), "Only cleaner contract");
        });

        it("cleaning empty history is a no-op", async () => {
            // Assemble
            const blk1 = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            const blk2 = await web3.eth.getBlockNumber();
            await fAsset.setCleanerContract(accounts[5], { from: assetManager });
            await fAsset.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // Act
            await fAsset.totalSupplyHistoryCleanup(1, { from: accounts[5] });
            await fAsset.balanceHistoryCleanup(accounts[1], 1, { from: accounts[5] });
            // Assert
            assertWeb3Equal(await fAsset.totalSupply(), 0);
            assertWeb3Equal(await fAsset.totalSupplyAt(blk2), 0);
            assertWeb3Equal(await fAsset.balanceOf(accounts[1]), 0);
            assertWeb3Equal(await fAsset.balanceOf(accounts[2]), 0);
            assertWeb3Equal(await fAsset.totalSupplyHistoryCleanup.call(1, { from: accounts[5] }), 0);
            assertWeb3Equal(await fAsset.balanceHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
        });

        it("cleaning history enough times cleans everything available", async () => {
            // Assemble
            await fAsset.mint(accounts[1], 100, { from: assetManager });
            await fAsset.mint(accounts[2], 100, { from: assetManager });
            const blk1 = await web3.eth.getBlockNumber();
            await fAsset.mint(accounts[1], 100, { from: assetManager });
            await fAsset.transfer(accounts[2], 50, { from: accounts[1] });
            await fAsset.burn(accounts[2], 50, { from: assetManager });
            const blk2 = await web3.eth.getBlockNumber();
            await fAsset.setCleanerContract(accounts[5], { from: assetManager });
            await fAsset.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // verify initial
            assertWeb3Equal(await fAsset.cleanupBlockNumber(), blk2);
            assertWeb3Equal(await fAsset.totalSupplyHistoryCleanup.call(10, { from: accounts[5] }), 3);
            assertWeb3Equal(await fAsset.balanceHistoryCleanup.call(accounts[1], 10, { from: accounts[5] }), 2);
            // Act
            for (let i = 0; i < 3; i++) {
                await fAsset.totalSupplyHistoryCleanup(1, { from: accounts[5] });
                await fAsset.balanceHistoryCleanup(accounts[1], 1, { from: accounts[5] });
            }
            // Assert
            assertWeb3Equal(await fAsset.totalSupplyHistoryCleanup.call(1, { from: accounts[5] }), 0);
            assertWeb3Equal(await fAsset.balanceHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
        });

        it("reading before cleanup block number is forbidden", async () => {
            // Assemble
            await fAsset.mint(accounts[1], 150, { from: assetManager });
            await fAsset.mint(accounts[2], 150, { from: assetManager });
            const blk1 = await web3.eth.getBlockNumber();
            await fAsset.transfer(accounts[2], 50, { from: accounts[1] });
            await fAsset.burn(accounts[2], 50, { from: assetManager });
            const blk2 = await web3.eth.getBlockNumber();
            await fAsset.setCleanerContract(accounts[5], { from: assetManager });
            await fAsset.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // Assert
            await expectRevert(fAsset.totalSupplyAt(blk1), "CheckPointable: reading from cleaned-up block");
            await expectRevert(fAsset.balanceOfAt(accounts[1], blk1), "CheckPointable: reading from cleaned-up block");
        });

        it("cleanup block number must be in correct range", async () => {
            // Assemble
            await fAsset.mint(accounts[1], 150, { from: assetManager });
            await fAsset.mint(accounts[2], 150, { from: assetManager });
            const blk1 = await web3.eth.getBlockNumber();
            await fAsset.transfer(accounts[2], 50, { from: accounts[1] });
            await fAsset.burn(accounts[2], 50, { from: assetManager });
            const blk2 = await web3.eth.getBlockNumber();
            await fAsset.setCleanerContract(accounts[5], { from: assetManager });
            await fAsset.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // Assert
            await expectRevert(fAsset.setCleanupBlockNumber(blk1, { from: accounts[8] }), "Cleanup block number must never decrease");
            const lastBlock = await time.latestBlock();
            await expectRevert(fAsset.setCleanupBlockNumber(lastBlock.addn(1), { from: accounts[8] }), "Cleanup block must be in the past");
        });

        it("values at cleanup block are still available after cleanup", async () => {
            // Assemble
            await fAsset.mint(accounts[1], 150, { from: assetManager });
            await fAsset.mint(accounts[2], 150, { from: assetManager });
            await fAsset.transfer(accounts[2], 50, { from: accounts[1] });
            await fAsset.burn(accounts[2], 50, { from: assetManager });
            const blk2 = await web3.eth.getBlockNumber();
            await fAsset.setCleanerContract(accounts[5], { from: assetManager });
            await fAsset.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // Assert
            assertWeb3Equal(await fAsset.cleanupBlockNumber(), blk2);
            // there should be opportunities to clean
            assertWeb3Equal(await fAsset.totalSupplyHistoryCleanup.call(1, { from: accounts[5] }), 1);
            assertWeb3Equal(await fAsset.balanceHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 1);
            assertWeb3Equal(await fAsset.balanceHistoryCleanup.call(accounts[2], 1, { from: accounts[5] }), 1);
            // Act
            for (let i = 0; i < 5; i++) {
                await fAsset.totalSupplyHistoryCleanup(1, { from: accounts[5] });
                await fAsset.balanceHistoryCleanup(accounts[1], 1, { from: accounts[5] });
                await fAsset.balanceHistoryCleanup(accounts[2], 1, { from: accounts[5] });
            }
            // Assert
            // everything should be cleaned before cleanup block
            assertWeb3Equal(await fAsset.totalSupplyHistoryCleanup.call(1, { from: accounts[5] }), 0);
            assertWeb3Equal(await fAsset.balanceHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
            assertWeb3Equal(await fAsset.balanceHistoryCleanup.call(accounts[2], 1, { from: accounts[5] }), 0);
            // the state at blk2 should still be ok
            // wNat.delegatesOfAt
            assertWeb3Equal(await fAsset.totalSupplyAt(blk2), 250);
            assertWeb3Equal(await fAsset.balanceOfAt(accounts[1], blk2), 100);
            assertWeb3Equal(await fAsset.balanceOfAt(accounts[2], blk2), 150);
        });

        it("cleaning history twice when is allowed and is a no-op if everything was emptied the first time", async () => {
            // Assemble
            await fAsset.mint(accounts[1], 100, { from: assetManager });
            await fAsset.mint(accounts[2], 100, { from: assetManager });
            const blk1 = await web3.eth.getBlockNumber();
            await fAsset.mint(accounts[1], 100, { from: assetManager });
            const blk2 = await web3.eth.getBlockNumber();
            await fAsset.setCleanerContract(accounts[5], { from: assetManager });
            await fAsset.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // verify initial
            assertWeb3Equal(await fAsset.totalSupplyHistoryCleanup.call(10, { from: accounts[5] }), 2);
            assertWeb3Equal(await fAsset.balanceHistoryCleanup.call(accounts[1], 10, { from: accounts[5] }), 1);
            // Act
            for (let i = 0; i < 2; i++) {
                await fAsset.totalSupplyHistoryCleanup(10, { from: accounts[5] });
                await fAsset.balanceHistoryCleanup(accounts[1], 10, { from: accounts[5] });
                // Assert
                assertWeb3Equal(await fAsset.totalSupplyHistoryCleanup.call(1, { from: accounts[5] }), 0);
                assertWeb3Equal(await fAsset.balanceHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
            }
        });
    });

    describe("fasset proxy upgrade", () => {
        beforeEach(async () => {
            await fAsset.setAssetManager(assetManager, { from: governance });
        });

        it("should upgrade via upgradeTo", async () => {
            const proxyAddress = fAsset.address;
            const fAssetProxy = await FAsset.at(proxyAddress);
            assertWeb3Equal(await fAsset.symbol(), "FETH");
            // upgrade
            const newFAssetImpl = await FAsset.new();
            await fAssetProxy.upgradeTo(newFAssetImpl.address, { from: assetManager });
            // check
            assertWeb3Equal(fAsset.address, proxyAddress);
            assertWeb3Equal(await fAssetProxy.implementation(), newFAssetImpl.address);
            assertWeb3Equal(await fAsset.name(), "FEthereum");
            assertWeb3Equal(await fAsset.symbol(), "FETH");
            assertWeb3Equal(await fAsset.decimals(), 18);
        });

        it("should upgrade via upgradeToAndCall", async () => {
            const proxyAddress = fAsset.address;
            const fAssetProxy = await FAsset.at(proxyAddress);
            assertWeb3Equal(await fAsset.symbol(), "FETH");
            // upgrade
            const newFAssetImpl = await FAsset.new();
            const callData = abiEncodeCall(fAsset, f => f.mint(accounts[18], 1234));
            await fAssetProxy.upgradeToAndCall(newFAssetImpl.address, callData, { from: assetManager });
            // check
            assertWeb3Equal(fAsset.address, proxyAddress);
            assertWeb3Equal(await fAssetProxy.implementation(), newFAssetImpl.address);
            assertWeb3Equal(await fAsset.name(), "FEthereum");
            assertWeb3Equal(await fAsset.symbol(), "FETH");
            assertWeb3Equal(await fAsset.decimals(), 18);
            // fake init call should mint (allowed because the sender is assetManager)
            assertWeb3Equal(await fAsset.balanceOf(accounts[18]), 1234);
        });

        it("calling initialize in upgradeToAndCall should fail and pass the revert message to outside", async () => {
            const proxyAddress = fAsset.address;
            const fAssetProxy = await FAsset.at(proxyAddress);
            assertWeb3Equal(await fAsset.symbol(), "FETH");
            // upgrade
            const newFAssetImpl = await FAsset.new();
            const callData = abiEncodeCall(fAsset, f => f.initialize("FXRP", "FXRP", "XRP", "XRP", 6));
            await expectRevert(fAssetProxy.upgradeToAndCall(newFAssetImpl.address, callData, { from: assetManager }),
                "already initialized");
        });

        it("only asset manager can upgrade", async () => {
            const fAssetProxy = await FAsset.at(fAsset.address);
            // upgrade
            const newFAssetImpl = await FAsset.new();
            await expectRevert(fAssetProxy.upgradeTo(newFAssetImpl.address), "only asset manager");
            const callData = abiEncodeCall(fAsset, f => f.mint(accounts[18], 1234));
            await expectRevert(fAssetProxy.upgradeToAndCall(newFAssetImpl.address, callData), "only asset manager");
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
