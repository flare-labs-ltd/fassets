import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { BN_ZERO, deepFormat, MAX_BIPS, sumBN, toBN, toBNExp, toWei, ZERO_ADDRESS } from "../../../lib/utils/helpers";
import { Approximation } from "../../utils/approximation";
import { MockChain } from "../../utils/fasset/MockChain";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3DeepEqual, assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo } from "../utils/TestChainInfo";
import { ERC20MockInstance } from "../../../typechain-truffle";
import { impersonateContract, stopImpersonatingContract } from "../../utils/contract-test-helpers";
import { waitForTimelock } from "../../utils/fasset/CreateAssetManager";
import common from "mocha/lib/interfaces/common";
import { requiredEventArgs } from "../../../lib/utils/events/truffle";

contract(`AssetManagerSimulation.sol; ${getTestFile(__filename)}; Asset manager simulations`, async accounts => {
    const governance = accounts[10];
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[21];
    const agentOwner3 = accounts[22];
    const minterAddress1 = accounts[30];
    const minterAddress2 = accounts[31];
    const minterAddress3 = accounts[32];
    const redeemerAddress1 = accounts[40];
    const redeemerAddress2 = accounts[41];
    const redeemerAddress3 = accounts[42];
    const challengerAddress1 = accounts[50];
    const challengerAddress2 = accounts[51];
    const liquidatorAddress1 = accounts[60];
    const liquidatorAddress2 = accounts[61];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
    const underlyingAgent2 = "Agent2";
    const underlyingAgent3 = "Agent3";
    const underlyingMinter1 = "Minter1";
    const underlyingMinter2 = "Minter2";
    const underlyingMinter3 = "Minter3";
    const underlyingRedeemer1 = "Redeemer1";
    const underlyingRedeemer2 = "Redeemer2";
    const underlyingRedeemer3 = "Redeemer3";

    let commonContext: CommonContext;
    let context: AssetContext;
    let mockChain: MockChain;

    async function initialize() {
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.btc);
        return { commonContext, context };
    }

    beforeEach(async () => {
        ({ commonContext, context } = await loadFixtureCopyVars(initialize));
        mockChain = context.chain as MockChain;
    });

    describe("simple scenarios - successful minting and redeeming", () => {
        it("mint and redeem f-assets", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // mine some blocks to skip the agent creation time
            mockChain.mine(5);
            // update block
            const blockNumber = await context.updateUnderlyingBlock();
            const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
            assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
            assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);
            // perform minting
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const lotsUBA = context.convertLotsToUBA(lots);
            await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA))
            });
            const burnAddress = context.settings.burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const minted = await minter.executeMinting(crt, txHash);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted.mintedAmountUBA, lotsUBA);
            const poolFeeShare = crt.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare, minted.poolFeeUBA);
            const agentFeeShare = crt.feeUBA.sub(poolFeeShare);
            assertWeb3Equal(agentFeeShare, minted.agentFeeUBA);
            const mintedUBA = crt.valueUBA.add(poolFeeShare);
            await agent.checkAgentInfo({ mintedUBA: mintedUBA, reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare, mintedUBA: poolFeeShare, redeemingUBA: lotsUBA });
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const tx1Hash = await agent.performRedemptionPayment(request);
            await agent.confirmActiveRedemptionPayment(request, tx1Hash);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request.feeUBA), redeemingUBA: 0 });
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets (updating redemption fee and collateral reservation fee)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // mine some blocks to skip the agent creation time
            mockChain.mine(5);
            // update block
            const blockNumber = await context.updateUnderlyingBlock();
            const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
            assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
            assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);
            // perform minting
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const lotsUBA = context.convertLotsToUBA(lots);
            await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA))
            });
            const burnAddress = context.settings.burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const minted = await minter.executeMinting(crt, txHash);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted.mintedAmountUBA, lotsUBA);
            const poolFeeShare = crt.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare, minted.poolFeeUBA);
            const agentFeeShare = crt.feeUBA.sub(poolFeeShare);
            assertWeb3Equal(agentFeeShare, minted.agentFeeUBA);
            const mintedUBA = crt.valueUBA.add(poolFeeShare);
            await agent.checkAgentInfo({ mintedUBA: mintedUBA, reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee);
            // change Collateral reservation fee bips
            const currentSettings = await context.assetManager.getSettings();
            await context.setCollateralReservationFeeBips(toBN(currentSettings.collateralReservationFeeBIPS).muln(2));
            // perform minting again
            const crFee2 = await minter.getCollateralReservationFee(lots);
            const crt2 = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash2 = await minter.performMintingPayment(crt2);
            await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA.add(agent.poolFeeShare(crt2.feeUBA))
            });
            const startBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
            const minted2 = await minter.executeMinting(crt2, txHash2);
            const endBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted2.mintedAmountUBA, lotsUBA);
            const poolFeeShare2 = crt2.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare2, minted2.poolFeeUBA);
            const agentFeeShare2 = crt2.feeUBA.sub(poolFeeShare);
            assertWeb3Equal(agentFeeShare2, minted2.agentFeeUBA);
            const mintedUBA2 = crt2.valueUBA.add(poolFeeShare2);
            await agent.checkAgentInfo({ mintedUBA: mintedUBA.add(mintedUBA2), reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress2.sub(startBalanceBurnAddress2), crFee2);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA.add(minted2.mintedAmountUBA), { from: minter.address });
            // wait until another setting update is possible
            await time.increase(currentSettings.minUpdateRepeatTimeSeconds);
            // change redemption fee bips
            await context.setCollateralReservationFeeBips(toBN(currentSettings.redemptionFeeBIPS).muln(2));
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots * 2);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(agentFeeShare2), mintedUBA: poolFeeShare.add(poolFeeShare2), redeemingUBA: lotsUBA.muln(2) });
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const tx1Hash = await agent.performRedemptionPayment(request);
            await agent.confirmActiveRedemptionPayment(request, tx1Hash);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(agentFeeShare2).add(request.feeUBA), redeemingUBA: 0 });
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets with whitelisting", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            await context.createWhitelists();
            await context.whitelist?.addAddressesToWhitelist([minter.address, redeemer.address], { from: governance });
            await context.agentOwnerRegistry?.addAddressToWhitelist(agentOwner1, { from: governance });
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // mine some blocks to skip the agent creation time
            mockChain.mine(5);
            // update block
            const blockNumber = await context.updateUnderlyingBlock();
            const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
            assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
            assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);
            // perform minting
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const lotsUBA = context.convertLotsToUBA(lots);
            await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA))
            });
            const burnAddress = context.settings.burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const minted = await minter.executeMinting(crt, txHash);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted.mintedAmountUBA, lotsUBA);
            const poolFeeShare = crt.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare, minted.poolFeeUBA);
            const agentFeeShare = crt.feeUBA.sub(poolFeeShare);
            assertWeb3Equal(agentFeeShare, minted.agentFeeUBA);
            const mintedUBA = crt.valueUBA.add(poolFeeShare);
            await agent.checkAgentInfo({ mintedUBA: mintedUBA, reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare, mintedUBA: poolFeeShare, redeemingUBA: lotsUBA });
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const tx1Hash = await agent.performRedemptionPayment(request);
            await agent.confirmActiveRedemptionPayment(request, tx1Hash);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request.feeUBA), redeemingUBA: 0 });
            //Minter gets delisted from whitelist
            let res = await context.whitelist?.revokeAddress(minter.address, { from: governance });
            //Wait for timelock
            if (res != undefined && context.whitelist != undefined) {
                await waitForTimelock(res, context.whitelist, governance);
            }
            //Minter tries to mint again by reserving collateral
            let tx = minter.reserveCollateral(agent.vaultAddress, lots);
            await expectRevert(tx, "not whitelisted");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets when minting cap is enabled", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // mine some blocks to skip the agent creation time
            mockChain.mine(5);
            // update block
            const blockNumber = await context.updateUnderlyingBlock();
            const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
            assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
            assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);
            //Set a small minting cap
            await context.assetManagerController.setMintingCapAmg([context.assetManager.address], context.convertLotsToAMG(10), { from: governance });
            // perform minting
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            //Try minting more lots than minting cap
            const res = minter.reserveCollateral(agent.vaultAddress, 15);
            await expectRevert(res, "minting cap exceeded");
            //Try minting less lots
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            //Try to mint again
            const res2 = minter.reserveCollateral(agent.vaultAddress, 8);
            await expectRevert(res2, "minting cap exceeded");
            const txHash = await minter.performMintingPayment(crt);
            const lotsUBA = context.convertLotsToUBA(lots);
            await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA))
            });
            const burnAddress = context.settings.burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const minted = await minter.executeMinting(crt, txHash);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted.mintedAmountUBA, lotsUBA);
            const poolFeeShare = crt.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare, minted.poolFeeUBA);
            const agentFeeShare = crt.feeUBA.sub(poolFeeShare);
            assertWeb3Equal(agentFeeShare, minted.agentFeeUBA);
            const mintedUBA = crt.valueUBA.add(poolFeeShare);
            await agent.checkAgentInfo({ mintedUBA: mintedUBA, reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare, mintedUBA: poolFeeShare, redeemingUBA: lotsUBA });
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const tx1Hash = await agent.performRedemptionPayment(request);
            await agent.confirmActiveRedemptionPayment(request, tx1Hash);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request.feeUBA), redeemingUBA: 0 });
            // perform minting
            const lots2 = 9;
            const crt2 = await minter.reserveCollateral(agent.vaultAddress, lots2);
            const txHash2 = await minter.performMintingPayment(crt2);
            const lotsUBA2 = context.convertLotsToUBA(lots2);
            await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA2.add(agent.poolFeeShare(crt2.feeUBA))
            });
            const minted2 = await minter.executeMinting(crt2, txHash2);
            assertWeb3Equal(minted2.mintedAmountUBA, lotsUBA2);
            const poolFeeShare2 = crt2.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare2, minted2.poolFeeUBA);
            const agentFeeShare2 = crt2.feeUBA.sub(poolFeeShare2);
            assertWeb3Equal(agentFeeShare2, minted2.agentFeeUBA);
            const mintedUBA2 = crt2.valueUBA.add(poolFeeShare2);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2.add(agentFeeShare).add(request.feeUBA), mintedUBA: poolFeeShare.add(mintedUBA2), reservedUBA: 0 });
            await context.fAsset.transfer(redeemer.address, minted2.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests2, remainingLots2, dustChanges2] = await redeemer.requestRedemption(lots2);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2.add(agentFeeShare).add(request.feeUBA), mintedUBA: poolFeeShare2.add(poolFeeShare), redeemingUBA: lotsUBA2 });
            assertWeb3Equal(remainingLots2, 0);
            assert.equal(dustChanges2.length, 0);
            assert.equal(redemptionRequests2.length, 1);
            const request2 = redemptionRequests2[0];
            assert.equal(request2.agentVault, agent.vaultAddress);
            const tx1Hash2 = await agent.performRedemptionPayment(request2);
            await agent.confirmActiveRedemptionPayment(request2, tx1Hash2);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2.add(request2.feeUBA).add(agentFeeShare).add(request.feeUBA), redeemingUBA: 0 });
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets (two redemption tickets - same agent) + agent can confirm mintings", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter1 = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const minter2 = await Minter.createTest(context, minterAddress2, underlyingMinter2, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            let underlyingBalance = await context.chain.getBalance(agent.underlyingAddress);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots1 = 3;
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral, totalPoolCollateralNATWei: fullAgentCollateral });
            const crt1 = await minter1.reserveCollateral(agent.vaultAddress, lots1);
            await agent.checkAgentInfo({ reservedUBA: crt1.valueUBA.add(agent.poolFeeShare(crt1.feeUBA)) });
            const tx1Hash = await minter1.performMintingPayment(crt1);
            underlyingBalance = underlyingBalance.add(crt1.valueUBA).add(crt1.feeUBA);
            await agent.checkAgentInfo({ actualUnderlyingBalance: underlyingBalance }); // only change on other chain
            const minted1 = await agent.executeMinting(crt1, tx1Hash);
            assertWeb3Equal(minted1.mintedAmountUBA, context.convertLotsToUBA(lots1));
            const totalMinted1 = minted1.mintedAmountUBA.add(minted1.poolFeeUBA);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: minted1.agentFeeUBA, mintedUBA: totalMinted1, reservedUBA: 0 });
            const lots2 = 6;
            const crt2 = await minter2.reserveCollateral(agent.vaultAddress, lots2);
            await agent.checkAgentInfo({ reservedUBA: crt2.valueUBA.add(agent.poolFeeShare(crt2.feeUBA)) });
            const tx2Hash = await minter2.performMintingPayment(crt2);
            underlyingBalance = underlyingBalance.add(crt2.valueUBA).add(crt2.feeUBA);
            await agent.checkAgentInfo({ actualUnderlyingBalance: underlyingBalance });
            const minted2 = await agent.executeMinting(crt2, tx2Hash, minter2);
            assertWeb3Equal(minted2.mintedAmountUBA, context.convertLotsToUBA(lots2));
            const totalMinted2 = totalMinted1.add(minted2.mintedAmountUBA).add(minted2.poolFeeUBA);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: minted1.agentFeeUBA.add(minted2.agentFeeUBA), mintedUBA: totalMinted2, reservedUBA: 0 });
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted2.mintedAmountUBA, { from: minter2.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots2);
            const request = redemptionRequests[0];
            assertWeb3Equal(remainingLots, 0);
            assertWeb3Equal(request.valueUBA, context.convertLotsToUBA(lots2));
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            assert.equal(request.agentVault, agent.vaultAddress);
            const totalMinted3 = totalMinted2.sub(request.valueUBA);
            await agent.checkAgentInfo({ mintedUBA: totalMinted3, redeemingUBA: request.valueUBA });
            const txHash = await agent.performRedemptionPayment(request);
            underlyingBalance = underlyingBalance.sub(request.valueUBA).add(request.feeUBA);
            await agent.checkAgentInfo({ actualUnderlyingBalance: underlyingBalance });
            await agent.confirmActiveRedemptionPayment(request, txHash);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: minted1.agentFeeUBA.add(minted2.agentFeeUBA).add(request.feeUBA), redeemingUBA: 0 });
            await expectRevert(agent.announceVaultCollateralWithdrawal(fullAgentCollateral), "withdrawal: value too high");
        });

        it("mint and redeem f-assets (two redemption tickets - different agents)", async () => {
            const agent1 = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent1.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots1 = 3;
            const crt1 = await minter.reserveCollateral(agent1.vaultAddress, lots1);
            const tx1Hash = await minter.performMintingPayment(crt1);
            const minted1 = await minter.executeMinting(crt1, tx1Hash);
            assertWeb3Equal(minted1.mintedAmountUBA, context.convertLotsToUBA(lots1));
            const lots2 = 6;
            const crt2 = await minter.reserveCollateral(agent2.vaultAddress, lots2);
            const tx2Hash = await minter.performMintingPayment(crt2);
            const minted2 = await minter.executeMinting(crt2, tx2Hash);
            assertWeb3Equal(minted2.mintedAmountUBA, context.convertLotsToUBA(lots2));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted2.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots2);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 2);
            const request1 = redemptionRequests[0];
            assert.equal(request1.agentVault, agent1.vaultAddress);
            const tx3Hash = await agent1.performRedemptionPayment(request1);
            await agent1.confirmActiveRedemptionPayment(request1, tx3Hash);
            const cc = await agent1.getAgentCollateral();
            // do full calculation once, normally just need to calculate `poolFeeCollateral = cc.lockedCollateralWei(minted1.poolFeeUBA, cc.vaultCollateral)`
            const poolFeeCollateral = cc.vault.convertUBAToTokenWei(minted1.poolFeeUBA.mul(toBN(agent1.settings.mintingVaultCollateralRatioBIPS)).divn(MAX_BIPS));
            await agent1.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted1.agentFeeUBA.add(request1.feeUBA),
                mintedUBA: minted1.poolFeeUBA,
                freeVaultCollateralWei: Approximation.absolute(fullAgentCollateral.sub(poolFeeCollateral), 10)
            });
            const request2 = redemptionRequests[1];
            assert.equal(request2.agentVault, agent2.vaultAddress);
            const tx4Hash = await agent2.performRedemptionPayment(request2);
            await agent2.confirmActiveRedemptionPayment(request2, tx4Hash);
            await agent2.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted2.agentFeeUBA.add(request2.feeUBA),
                mintedUBA: context.convertLotsToUBA(3).add(minted2.poolFeeUBA)
            });
            await expectRevert(agent2.announceVaultCollateralWithdrawal(fullAgentCollateral), "withdrawal: value too high");
        });

        it("mint and redeem f-assets (many redemption tickets, get RedemptionRequestIncomplete)", async () => {
            const N = 25;
            const MT = 20;  // max tickets redeemed
            const fullAgentCollateral = toWei(3e8);
            const agents: Agent[] = [];
            const underlyingAddress = (i: number) => `${underlyingAgent1}_vault_${i}`;
            for (let i = 0; i < N; i++) {
                const agent = await Agent.createTest(context, agentOwner1, underlyingAddress(i));
                await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
                agents.push(agent);
            }
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // perform minting
            let totalMinted = BN_ZERO;
            for (const agent of agents) {
                await context.updateUnderlyingBlock();
                const crt = await minter.reserveCollateral(agent.vaultAddress, 1);
                const txHash = await minter.performMintingPayment(crt);
                const minted = await minter.executeMinting(crt, txHash);
                assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(1));
                totalMinted = totalMinted.add(toBN(minted.mintedAmountUBA));
            }
            // check redemption tickets
            const allTickets = await context.getRedemptionQueue(10);
            assertWeb3Equal(allTickets.length, N);
            for (let i = 0; i < N; i++) {
                const agentTickets = await agents[i].getRedemptionQueue(10);
                assertWeb3Equal(agentTickets.length, 1);
                assertWeb3DeepEqual(agentTickets[0], allTickets[i]);
                // check data
                assertWeb3Equal(allTickets[i].ticketValueUBA, context.lotSize());
                assertWeb3Equal(allTickets[i].agentVault, agents[i].vaultAddress);
            }
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, totalMinted, { from: minter.address });
            // request redemption
            const executorFee = toBNExp(N + 0.5, 9);  // 25.5 gwei, 0.5 gwei should be lost
            const executor = accounts[88];
            await context.updateUnderlyingBlock();
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(N, executor, executorFee);
            // validate redemption requests
            assertWeb3Equal(remainingLots, N - MT);  // should only redeem 20 tickets out of 25
            assert.equal(redemptionRequests.length, MT);
            const totalExecutorFee = sumBN(redemptionRequests, rq => toBN(rq.executorFeeNatWei));
            assertWeb3Equal(totalExecutorFee, toBNExp(N, 9));
            assert.equal(dustChanges.length, 0);
            // pay for all requests
            const mockChain = context.chain as MockChain;
            mockChain.automine = false;
            const rdTxHashes: string[] = [];
            for (let i = 0; i < redemptionRequests.length; i++) {
                const request = redemptionRequests[i];
                const agent = agents[i];
                assert.equal(request.agentVault, agent.vaultAddress);
                const txHash = await agent.performRedemptionPayment(request);
                rdTxHashes.push(txHash);
            }
            mockChain.mine();
            mockChain.automine = true;
            // confirm all requests
            for (let i = 0; i < rdTxHashes.length; i++) {
                const request = redemptionRequests[i];
                const agent = agents[i];
                await agent.confirmActiveRedemptionPayment(request, rdTxHashes[i]);
            }
        });

        it("mint and redeem f-assets (many redemption tickets to the same agent are merged at minting, so can be redeemed at once)", async () => {
            const N = 25;
            const MT = 20;  // max tickets redeemed
            const lotSize = context.lotSize();
            const fullAgentCollateral = toWei(3e8);
            const underlyingAddress = (i: number) => `${underlyingAgent1}_vault_${i}`;
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // perform minting
            let totalMinted = BN_ZERO;
            let totalPoolFee = BN_ZERO;
            for (let i = 0; i < N; i++) {
                await context.updateUnderlyingBlock();
                const [minted] = await minter.performMinting(agent.vaultAddress, 1);
                assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(1));
                totalMinted = totalMinted.add(toBN(minted.mintedAmountUBA));
                totalPoolFee = totalPoolFee.add(toBN(minted.poolFeeUBA));
            }
            assertWeb3Equal(totalMinted, lotSize.muln(N));
            // check redemption tickets (there should be only 1)
            const totalTicketAmount = totalMinted.add(totalPoolFee.div(lotSize).mul(lotSize));  // whole lots of pool fee get added to ticket
            const allTickets = await context.getRedemptionQueue(10);
            assertWeb3Equal(allTickets.length, 1);
            assertWeb3Equal(allTickets[0].ticketValueUBA, totalTicketAmount);
            assertWeb3Equal(allTickets[0].agentVault, agent.vaultAddress);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, totalMinted, { from: minter.address });
            // request redemption
            const executorFee = toBNExp(N + 0.5, 9);  // 25.5 gwei, 0.5 gwei should be lost
            const executor = accounts[88];
            await context.updateUnderlyingBlock();
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(N, executor, executorFee);
            // validate redemption requests
            assertWeb3Equal(remainingLots, 0);  // should only redeem 20 tickets out of 25
            assert.equal(redemptionRequests.length, 1);
            const totalExecutorFee = sumBN(redemptionRequests, rq => toBN(rq.executorFeeNatWei));
            assertWeb3Equal(totalExecutorFee, toBNExp(N, 9));
            assert.equal(dustChanges.length, 0);
            // perform redemptions
            await agent.performRedemptions(redemptionRequests);
        });

        it("mint and redeem f-assets (one redemption ticket - two redeemers)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer1 = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const redeemer2 = await Redeemer.create(context, redeemerAddress2, underlyingRedeemer2);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            // redeemers "buy" f-assets
            await context.fAsset.transfer(redeemer1.address, minted.mintedAmountUBA.divn(2), { from: minter.address });
            await context.fAsset.transfer(redeemer2.address, minted.mintedAmountUBA.divn(2), { from: minter.address });
            // perform redemptions
            const [redemptionRequests1, remainingLots1, dustChangesUBA1] = await redeemer1.requestRedemption(lots / 2);
            assertWeb3Equal(remainingLots1, 0);
            assert.equal(dustChangesUBA1.length, 0);
            assert.equal(redemptionRequests1.length, 1);
            const [redemptionRequests2, remainingLots2, dustChangesUBA2] = await redeemer2.requestRedemption(lots / 2);
            assertWeb3Equal(remainingLots2, 0);
            assert.equal(dustChangesUBA2.length, 0);
            assert.equal(redemptionRequests2.length, 1);
            const request1 = redemptionRequests1[0];
            assert.equal(request1.agentVault, agent.vaultAddress);
            const tx3Hash = await agent.performRedemptionPayment(request1);
            await agent.confirmActiveRedemptionPayment(request1, tx3Hash);
            await expectRevert(agent.announceVaultCollateralWithdrawal(fullAgentCollateral), "withdrawal: value too high");
            const request2 = redemptionRequests2[0];
            assert.equal(request2.agentVault, agent.vaultAddress);
            const tx4Hash = await agent.performRedemptionPayment(request2);
            await agent.confirmActiveRedemptionPayment(request2, tx4Hash);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets (self-mint)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform self-minting
            const lots = 3;
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: 0, mintedUBA: 0 });
            const minted = await agent.selfMint(context.convertLotsToUBA(lots), lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA) });
            // perform self close
            const [dustChanges, selfClosedUBA] = await agent.selfClose(minted.mintedAmountUBA);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: minted.mintedAmountUBA, mintedUBA: minted.poolFeeUBA });
            assertWeb3Equal(selfClosedUBA, minted.mintedAmountUBA);
            assert.equal(dustChanges.length, 2);    // initially dust is cleared and then re-created
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets (mint from free underlying)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform self-minting
            const lots = 3;
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: 0, mintedUBA: 0 });
            // topup enough to mint later
            const mintAmountUBA = context.convertLotsToUBA(lots);
            const mintPoolFeeUBA = toBN(mintAmountUBA).mul(toBN(agent.settings.feeBIPS)).divn(MAX_BIPS).mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            const topupUBA = toBN(mintAmountUBA).add(mintPoolFeeUBA.muln(2));   // add pool fee for 2 mintings
            const topupTx = await agent.performTopupPayment(topupUBA);
            await agent.confirmTopupPayment(topupTx);
            // now teh agent can mint from free inderlying
            const minted = await agent.mintFromFreeUnderlying(lots);
            assertWeb3Equal(minted.mintedAmountUBA, mintAmountUBA);
            assertWeb3Equal(minted.poolFeeUBA, mintPoolFeeUBA);
            await agent.checkAgentInfo({ mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA), freeUnderlyingBalanceUBA: mintPoolFeeUBA });
            // perform self close
            const [dustChanges, selfClosedUBA] = await agent.selfClose(minted.mintedAmountUBA);
            await agent.checkAgentInfo({ mintedUBA: minted.poolFeeUBA, freeUnderlyingBalanceUBA: mintAmountUBA.add(mintPoolFeeUBA) });
            assertWeb3Equal(selfClosedUBA, minted.mintedAmountUBA);
            assert.equal(dustChanges.length, 2);    // initially dust is cleared and then re-created
            // now the underlying is free again, so agent can re-mint
            const minted2 = await agent.mintFromFreeUnderlying(lots);
            assertWeb3Equal(minted2.mintedAmountUBA, mintAmountUBA);
            assertWeb3Equal(minted2.poolFeeUBA, mintPoolFeeUBA);
            await agent.checkAgentInfo({ mintedUBA: minted2.mintedAmountUBA.add(minted.poolFeeUBA).add(minted2.poolFeeUBA), freeUnderlyingBalanceUBA: 0 });
            // self close again
            await agent.selfClose(minted.mintedAmountUBA);
            await agent.checkAgentInfo({ mintedUBA: mintPoolFeeUBA.muln(2), freeUnderlyingBalanceUBA: mintAmountUBA });
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets (self-close)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: crt.feeUBA.sub(minted.poolFeeUBA),
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA)
            });
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerWorkAddress, minted.mintedAmountUBA, { from: minter.address });
            // perform self close
            const [dustChanges, selfClosedUBA] = await agent.selfClose(minted.mintedAmountUBA);
            await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: crt.feeUBA.sub(minted.poolFeeUBA).add(crt.valueUBA),
                mintedUBA: minted.poolFeeUBA
            });
            assertWeb3Equal(selfClosedUBA, minted.mintedAmountUBA);
            assert.equal(dustChanges.length, 2);    // initially dust is cleared and then re-created
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("change wnat contract and try redeeming collateral pool tokens", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // wait for token timelock
            await time.increase(await context.assetManager.getCollateralPoolTokenTimelockSeconds());
            // mine some blocks to skip the agent creation time
            mockChain.mine(5);
            // Upgrade wNat contract
            const ERC20Mock = artifacts.require("ERC20Mock");
            const newWNat: ERC20MockInstance = await ERC20Mock.new("new wnat", "WNat");
            await impersonateContract(context.assetManager.address, toBN(512526332000000000), accounts[0]);
            await agent.collateralPool.upgradeWNatContract(newWNat.address, { from: context.assetManager.address });
            await stopImpersonatingContract(context.assetManager.address);
            const agentInfo = await context.assetManager.getAgentInfo(agent.agentVault.address);
            const tokens = agentInfo.totalAgentPoolTokensWei;
            await context.assetManager.announceAgentPoolTokenRedemption(agent.agentVault.address, tokens, { from: agentOwner1 });
            await time.increase((await context.assetManager.getSettings()).withdrawalWaitMinSeconds);
            const poolTokensBefore = await agent.collateralPoolToken.totalSupply();
            //Redeem collateral pool tokens
            await agent.agentVault.redeemCollateralPoolTokens(tokens, agentOwner1, { from: agentOwner1 });
            const poolTokensAfter = await agent.collateralPoolToken.totalSupply();
            assertWeb3Equal(poolTokensBefore.sub(poolTokensAfter), tokens);
        });

        it("should approve collateral reservation, mint and redeem f-assets", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1, { handshakeType: 1 });
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // mine some blocks to skip the agent creation time
            mockChain.mine(5);
            // update block
            const blockNumber = await context.updateUnderlyingBlock();
            const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
            assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
            assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);
            // perform minting (hand-shake is required)
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crtHs = await minter.reserveCollateralHSRequired(agent.vaultAddress, lots,  [minter.underlyingAddress]);
            // approve collateral reservation
            const tx1 = await context.assetManager.approveCollateralReservation(crtHs.collateralReservationId, { from: agentOwner1 });
            const crt = requiredEventArgs(tx1, "CollateralReserved");
            const txHash = await minter.performMintingPayment(crt);
            const lotsUBA = context.convertLotsToUBA(lots);
            await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA))
            });
            const burnAddress = context.settings.burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const minted = await minter.executeMinting(crt, txHash);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted.mintedAmountUBA, lotsUBA);
            const poolFeeShare = crt.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare, minted.poolFeeUBA);
            const agentFeeShare = crt.feeUBA.sub(poolFeeShare);
            assertWeb3Equal(agentFeeShare, minted.agentFeeUBA);
            const mintedUBA = crt.valueUBA.add(poolFeeShare);
            await agent.checkAgentInfo({ mintedUBA: mintedUBA, reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare, mintedUBA: poolFeeShare, redeemingUBA: lotsUBA });
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const tx1Hash = await agent.performRedemptionPayment(request);
            await agent.confirmActiveRedemptionPayment(request, tx1Hash);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request.feeUBA), redeemingUBA: 0 });
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("should approve collateral reservation, mint, reject redemption request, take over and redeem f-assets", async () => {
            // create users
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1, { handshakeType: 1 });
            const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2, { handshakeType: 0 });
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const minter2 = await Minter.createTest(context, minterAddress2, underlyingMinter2, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const redeemer2 = await Redeemer.create(context, redeemerAddress2, underlyingRedeemer2);
            // make agents available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // mine some blocks to skip the agent creation time
            mockChain.mine(5);
            // update block
            const blockNumber = await context.updateUnderlyingBlock();
            const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
            assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
            assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);

            //// perform minting for minter1 (hand-shake is required)
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crtHs = await minter.reserveCollateralHSRequired(agent.vaultAddress, lots, [minter.underlyingAddress]);
            // approve collateral reservation
            const tx1 = await context.assetManager.approveCollateralReservation(crtHs.collateralReservationId, { from: agentOwner1 });
            const crt = requiredEventArgs(tx1, "CollateralReserved");
            const txHash = await minter.performMintingPayment(crt);
            const lotsUBA = context.convertLotsToUBA(lots);
            await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA))
            });
            const burnAddress = context.settings.burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const minted = await minter.executeMinting(crt, txHash);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted.mintedAmountUBA, lotsUBA);
            const poolFeeShare = crt.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare, minted.poolFeeUBA);
            const agentFeeShare = crt.feeUBA.sub(poolFeeShare);
            assertWeb3Equal(agentFeeShare, minted.agentFeeUBA);
            const mintedUBA = crt.valueUBA.add(poolFeeShare);
            await agent.checkAgentInfo({ mintedUBA: mintedUBA, reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });

            //// perform minting for minter2 (hand-shake is not required)
            const crt2 = await minter2.reserveCollateral(agent2.vaultAddress, lots);
            const txHash2 = await minter2.performMintingPayment(crt2);
            await agent2.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA.add(agent2.poolFeeShare(crt2.feeUBA))
            });
            const startBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
            const minted2 = await minter2.executeMinting(crt2, txHash2);
            const endBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted2.mintedAmountUBA, lotsUBA);
            const poolFeeShare2 = crt2.feeUBA.mul(toBN(agent2.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare2, minted2.poolFeeUBA);
            const agentFeeShare2 = crt2.feeUBA.sub(poolFeeShare2);
            assertWeb3Equal(agentFeeShare2, minted2.agentFeeUBA);
            const mintedUBA2 = crt2.valueUBA.add(poolFeeShare2);
            await agent2.checkAgentInfo({ mintedUBA: mintedUBA2, reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress2.sub(startBalanceBurnAddress2), crFee);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer2.address, minted2.mintedAmountUBA, { from: minter2.address });

            // redeemer1 requests redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            const request = redemptionRequests[0];
            // agent rejects redemption request
            const resRejected = await context.assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
            requiredEventArgs(resRejected, 'RedemptionRequestRejected');

            // agent2 takes over the redemption request
            const resTakeOver = await context.assetManager.takeOverRedemptionRequest(agent2.agentVault.address, request.requestId, { from: agentOwner2 });
            const newRequest = requiredEventArgs(resTakeOver, 'RedemptionRequested');

            await agent2.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2, mintedUBA: poolFeeShare2, redeemingUBA: lotsUBA });
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            assert.equal(request.agentVault, agent.vaultAddress);
            assert.equal(newRequest.agentVault, agent2.vaultAddress);
            // agent2 performs redemption payment
            const tx1Hash = await agent2.performRedemptionPayment(newRequest);
            // redemption for old request can't be confirmed because it was rejected and deleted
            await expectRevert(agent2.confirmActiveRedemptionPayment(request, tx1Hash), "invalid request id");
            // agent2 confirms redemption
            await agent2.confirmActiveRedemptionPayment(newRequest, tx1Hash);
            await agent2.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2.add(newRequest.feeUBA), redeemingUBA: 0 });
            // agent can exit now
            await agent2.exitAndDestroy(fullAgentCollateral);

            // redeemer2 requests redemption
            const [redemptionRequests2, remainingLots2, dustChanges2] = await redeemer2.requestRedemption(lots);
            const request2 = redemptionRequests2[0];
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare, mintedUBA: poolFeeShare, redeemingUBA: lotsUBA });
            assertWeb3Equal(remainingLots2, 0);
            assert.equal(dustChanges2.length, 0);
            assert.equal(redemptionRequests2.length, 1);
            assert.equal(request2.agentVault, agent.vaultAddress);
            const tx2Hash = await agent.performRedemptionPayment(request2);
            await agent.confirmActiveRedemptionPayment(request2, tx2Hash);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request2.feeUBA), redeemingUBA: 0 });
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

         it("should approve collateral reservation, mint, reject redemption request, partially take over and default for the remaining", async () => {
            // create users
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1, { handshakeType: 1 });
            const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2, { handshakeType: 0 });
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const minter2 = await Minter.createTest(context, minterAddress2, underlyingMinter2, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const redeemer2 = await Redeemer.create(context, redeemerAddress2, underlyingRedeemer2);
            // make agents available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // mine some blocks to skip the agent creation time
            mockChain.mine(5);
            // update block
            const blockNumber = await context.updateUnderlyingBlock();
            const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
            assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
            assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);

            //// perform minting for minter1 (hand-shake is required)
            const lots1 = 3;
            const crFee1 = await minter.getCollateralReservationFee(lots1);
            const crtHs = await minter.reserveCollateralHSRequired(agent.vaultAddress, lots1, [minter.underlyingAddress]);
            // approve collateral reservation
            const tx1 = await context.assetManager.approveCollateralReservation(crtHs.collateralReservationId, { from: agentOwner1 });
            const crt = requiredEventArgs(tx1, "CollateralReserved");
            const txHash = await minter.performMintingPayment(crt);
            const lotsUBA1 = context.convertLotsToUBA(lots1);
            await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA1.add(agent.poolFeeShare(crt.feeUBA))
            });
            const burnAddress = context.settings.burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const minted = await minter.executeMinting(crt, txHash);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted.mintedAmountUBA, lotsUBA1);
            const poolFeeShare = crt.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare, minted.poolFeeUBA);
            const agentFeeShare = crt.feeUBA.sub(poolFeeShare);
            assertWeb3Equal(agentFeeShare, minted.agentFeeUBA);
            const mintedUBA = crt.valueUBA.add(poolFeeShare);
            await agent.checkAgentInfo({ mintedUBA: mintedUBA, reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee1);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });

            //// perform minting for minter2 (hand-shake is not required)
            const lots2 = 2;
            const lotsUBA2 = context.convertLotsToUBA(lots2);
            const crFee2 = await minter2.getCollateralReservationFee(lots2);
            const crt2 = await minter2.reserveCollateral(agent2.vaultAddress, lots2);
            const txHash2 = await minter2.performMintingPayment(crt2);
            await agent2.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA2.add(agent2.poolFeeShare(crt2.feeUBA))
            });
            const startBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
            const minted2 = await minter2.executeMinting(crt2, txHash2);
            const endBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted2.mintedAmountUBA, lotsUBA2);
            const poolFeeShare2 = crt2.feeUBA.mul(toBN(agent2.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare2, minted2.poolFeeUBA);
            const agentFeeShare2 = crt2.feeUBA.sub(poolFeeShare2);
            assertWeb3Equal(agentFeeShare2, minted2.agentFeeUBA);
            const mintedUBA2 = crt2.valueUBA.add(poolFeeShare2);
            await agent2.checkAgentInfo({ mintedUBA: mintedUBA2, reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress2.sub(startBalanceBurnAddress2), crFee2);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer2.address, minted2.mintedAmountUBA, { from: minter2.address });

            // redeemer1 requests redemption (3 lots)
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots1);
            const request = redemptionRequests[0];
            // agent rejects redemption request
            const resRejected = await context.assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
            requiredEventArgs(resRejected, 'RedemptionRequestRejected');

            // agent2 takes over the redemption request
            // agent2 minted only 2 lots, so it can't fulfill the request entirely
            const resTakeOver = await context.assetManager.takeOverRedemptionRequest(agent2.agentVault.address, request.requestId, { from: agentOwner2 });
            const newRequest = requiredEventArgs(resTakeOver, 'RedemptionRequested');
            const newRedemptionTicket = requiredEventArgs(resTakeOver, 'RedemptionTicketCreated');
            const requestTakenOver = requiredEventArgs(resTakeOver, 'RedemptionRequestTakenOver');
            assertWeb3Equal(newRedemptionTicket.agentVault, agent.vaultAddress);
            // agent2 closed 2 lots
            assertWeb3Equal(newRedemptionTicket.ticketValueUBA, requestTakenOver.valueTakenOverUBA);

            await agent2.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2, mintedUBA: poolFeeShare2, redeemingUBA: lotsUBA2 });
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            assert.equal(request.agentVault, agent.vaultAddress);
            assert.equal(newRequest.agentVault, agent2.vaultAddress);
            // agent2 performs redemption payment
            const tx1Hash = await agent2.performRedemptionPayment(newRequest);
            // agent2 confirms redemption
            await agent2.confirmActiveRedemptionPayment(newRequest, tx1Hash);
            await agent2.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2.add(newRequest.feeUBA), redeemingUBA: 0 });
            // agent can exit now
            await agent2.exitAndDestroy(fullAgentCollateral);

            // redeemer2 requests redemption (2 lots)
            const [redemptionRequests2, remainingLots2, dustChanges2] = await redeemer2.requestRedemption(lots2);
            const request2 = redemptionRequests2[0];

            const lots1UBA = context.convertLotsToUBA(1);
            // redeemingUBA = 2 lots + 1 remaining lot from the previous request which was not taken over entirely
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare, mintedUBA: poolFeeShare, redeemingUBA: lotsUBA2.add(lots1UBA) });
            assertWeb3Equal(remainingLots2, 0);
            assert.equal(dustChanges2.length, 0);
            assert.equal(redemptionRequests2.length, 1);
            assert.equal(request2.agentVault, agent.vaultAddress);
            const tx2Hash = await agent.performRedemptionPayment(request2);
            await agent.confirmActiveRedemptionPayment(request2, tx2Hash);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request2.feeUBA), redeemingUBA: lots1UBA });

            // agent can't exit yet because it has 1 lot remaining
            // it can either wait that another agent takes over the remaining lot or until it calls rejectedRedemptionPaymentDefault
            const defaultsRes = await context.assetManager.rejectedRedemptionPaymentDefault(request.requestId, { from: agentOwner1 });
            const defaultArgs = requiredEventArgs(defaultsRes, 'RedemptionDefault')
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request2.feeUBA).add(lots1UBA), redeemingUBA: 0, totalVaultCollateralWei: fullAgentCollateral.sub(defaultArgs.redeemedVaultCollateralWei) });

            await agent.exitAndDestroy(fullAgentCollateral.sub(defaultArgs.redeemedVaultCollateralWei));
        });

        it("should approve collateral reservation, mint, reject redemption request, partially take over and another agent take over the remaining", async () => {
            // create users
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1, { handshakeType: 1 });
            const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2, { handshakeType: 0 });
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const minter2 = await Minter.createTest(context, minterAddress2, underlyingMinter2, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const redeemer2 = await Redeemer.create(context, redeemerAddress2, underlyingRedeemer2);
            const agent3 = await Agent.createTest(context, agentOwner3, underlyingAgent3, { handshakeType: 0 });
            const minter3 = await Minter.createTest(context, minterAddress3, underlyingMinter3, context.underlyingAmount(10000));
            const redeemer3 = await Redeemer.create(context, redeemerAddress3, underlyingRedeemer3);

            // make agents available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            await agent3.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // mine some blocks to skip the agent creation time
            mockChain.mine(5);
            // update block
            const blockNumber = await context.updateUnderlyingBlock();
            const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
            assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
            assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);

            //// perform minting for minter1 (hand-shake is required)
            const lots1 = 3;
            const crFee1 = await minter.getCollateralReservationFee(lots1);
            const crtHs = await minter.reserveCollateralHSRequired(agent.vaultAddress, lots1, [minter.underlyingAddress]);
            // approve collateral reservation
            const tx1 = await context.assetManager.approveCollateralReservation(crtHs.collateralReservationId, { from: agentOwner1 });
            const crt = requiredEventArgs(tx1, "CollateralReserved");
            const txHash = await minter.performMintingPayment(crt);
            const lotsUBA1 = context.convertLotsToUBA(lots1);
            await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA1.add(agent.poolFeeShare(crt.feeUBA))
            });
            const burnAddress = context.settings.burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const minted = await minter.executeMinting(crt, txHash);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted.mintedAmountUBA, lotsUBA1);
            const poolFeeShare = crt.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare, minted.poolFeeUBA);
            const agentFeeShare = crt.feeUBA.sub(poolFeeShare);
            assertWeb3Equal(agentFeeShare, minted.agentFeeUBA);
            const mintedUBA = crt.valueUBA.add(poolFeeShare);
            await agent.checkAgentInfo({ mintedUBA: mintedUBA, reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee1);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });

            //// perform minting for minter2 (hand-shake is not required)
            const lots2 = 2;
            const lotsUBA2 = context.convertLotsToUBA(lots2);
            const crFee2 = await minter2.getCollateralReservationFee(lots2);
            const crt2 = await minter2.reserveCollateral(agent2.vaultAddress, lots2);
            const txHash2 = await minter2.performMintingPayment(crt2);
            await agent2.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA2.add(agent2.poolFeeShare(crt2.feeUBA))
            });
            const startBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
            const minted2 = await minter2.executeMinting(crt2, txHash2);
            const endBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted2.mintedAmountUBA, lotsUBA2);
            const poolFeeShare2 = crt2.feeUBA.mul(toBN(agent2.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare2, minted2.poolFeeUBA);
            const agentFeeShare2 = crt2.feeUBA.sub(poolFeeShare2);
            assertWeb3Equal(agentFeeShare2, minted2.agentFeeUBA);
            const mintedUBA2 = crt2.valueUBA.add(poolFeeShare2);
            await agent2.checkAgentInfo({ mintedUBA: mintedUBA2, reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress2.sub(startBalanceBurnAddress2), crFee2);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer2.address, minted2.mintedAmountUBA, { from: minter2.address });

            // perform minting for minter3 (hand-shake is not required)
            const lots3 = 1;
            const lotsUBA3 = context.convertLotsToUBA(lots3);
            const crFee3 = await minter3.getCollateralReservationFee(lots3);
            const crt3 = await minter3.reserveCollateral(agent3.vaultAddress, lots3);
            const txHash3 = await minter3.performMintingPayment(crt3);
            await agent3.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                reservedUBA: lotsUBA3.add(agent3.poolFeeShare(crt3.feeUBA))
            });
            const startBalanceBurnAddress3 = toBN(await web3.eth.getBalance(burnAddress));
            const minted3 = await minter3.executeMinting(crt3, txHash3);
            const endBalanceBurnAddress3 = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted3.mintedAmountUBA, lotsUBA3);
            const poolFeeShare3 = crt3.feeUBA.mul(toBN(agent3.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(poolFeeShare3, minted3.poolFeeUBA);
            const agentFeeShare3 = crt3.feeUBA.sub(poolFeeShare3);
            assertWeb3Equal(agentFeeShare3, minted3.agentFeeUBA);
            const mintedUBA3 = crt3.valueUBA.add(poolFeeShare3);
            await agent3.checkAgentInfo({ mintedUBA: mintedUBA3, reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress3.sub(startBalanceBurnAddress3), crFee3);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer3.address, minted3.mintedAmountUBA, { from: minter3.address });

            // redeemer1 requests redemption (3 lots)
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots1);
            const request = redemptionRequests[0];
            // agent rejects redemption request
            const resRejected = await context.assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
            requiredEventArgs(resRejected, 'RedemptionRequestRejected');


            await agent.checkAgentInfo({ mintedUBA: poolFeeShare, redeemingUBA: lotsUBA1 });
            // agent2 takes over the redemption request
            // agent2 minted only 2 lots, so it can't fulfill the request entirely
            const resTakeOver = await context.assetManager.takeOverRedemptionRequest(agent2.agentVault.address, request.requestId, { from: agentOwner2 });
            await agent.checkAgentInfo({ mintedUBA: poolFeeShare.add(lotsUBA2), redeemingUBA: lotsUBA1.sub(lotsUBA2) });
            // agent3 takes over the remaining redemption request (1 lot)
            const takeOverLots3 = context.convertLotsToUBA(1);
            const resTakeOver3 = await context.assetManager.takeOverRedemptionRequest(agent3.agentVault.address, request.requestId, { from: agentOwner3 });
            await agent.checkAgentInfo({ mintedUBA: poolFeeShare.add(lotsUBA2).add(takeOverLots3), redeemingUBA: lotsUBA1.sub(lotsUBA2).sub(takeOverLots3) });
            const newRequest = requiredEventArgs(resTakeOver, 'RedemptionRequested');
            const newRedemptionTicket = requiredEventArgs(resTakeOver, 'RedemptionTicketCreated');
            const requestTakenOver = requiredEventArgs(resTakeOver, 'RedemptionRequestTakenOver');
            assertWeb3Equal(newRedemptionTicket.agentVault, agent.vaultAddress);
            // agent2 closed 2 lots
            assertWeb3Equal(newRedemptionTicket.ticketValueUBA, requestTakenOver.valueTakenOverUBA);

            await agent2.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2, mintedUBA: poolFeeShare2, redeemingUBA: lotsUBA2 });
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            assert.equal(request.agentVault, agent.vaultAddress);
            assert.equal(newRequest.agentVault, agent2.vaultAddress);
            // agent2 performs redemption payment
            const tx1Hash = await agent2.performRedemptionPayment(newRequest);
            // agent2 confirms redemption
            await agent2.confirmActiveRedemptionPayment(newRequest, tx1Hash);
            await agent2.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2.add(newRequest.feeUBA), redeemingUBA: 0 });
            // agent2 can exit now
            await agent2.exitAndDestroy(fullAgentCollateral);

            const newRequest1 = requiredEventArgs(resTakeOver3, 'RedemptionRequested');
            const newRedemptionTicket1 = requiredEventArgs(resTakeOver3, 'RedemptionTicketUpdated');
            const requestTakenOver1 = requiredEventArgs(resTakeOver3, 'RedemptionRequestTakenOver');
            assertWeb3Equal(newRedemptionTicket1.agentVault, agent.vaultAddress);
            // agent2 closed 2 lots
            // ticket from second take-over was merged with ticket from first take-over
            assertWeb3Equal(newRedemptionTicket1.ticketValueUBA, toBN(requestTakenOver.valueTakenOverUBA).add(requestTakenOver1.valueTakenOverUBA));
            assertWeb3Equal(newRedemptionTicket1.redemptionTicketId, newRedemptionTicket.redemptionTicketId);

            await agent3.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare3, mintedUBA: poolFeeShare3, redeemingUBA: lotsUBA3 });
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            assert.equal(request.agentVault, agent.vaultAddress);
            assert.equal(newRequest.agentVault, agent2.vaultAddress);
            // agent2 performs redemption payment
            const tx3Hash = await agent3.performRedemptionPayment(newRequest1);
            // agent2 confirms redemption
            await agent3.confirmActiveRedemptionPayment(newRequest1, tx3Hash);
            await agent3.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare3.add(newRequest1.feeUBA), redeemingUBA: 0 });
            // agent3 can exit now
            await agent3.exitAndDestroy(fullAgentCollateral);

            // redeemer2 requests redemption (2 lots)
            // agent1 will send 2 lots to redeemer2
            const [redemptionRequests2, remainingLots2, dustChanges2] = await redeemer2.requestRedemption(lots2);
            const request2 = redemptionRequests2[0];
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare, mintedUBA: poolFeeShare.add(lotsUBA3), redeemingUBA: lotsUBA2 });
            assertWeb3Equal(remainingLots2, 0);
            assert.equal(dustChanges2.length, 0);
            assert.equal(redemptionRequests2.length, 1);
            assert.equal(request2.agentVault, agent.vaultAddress);
            const tx2Hash = await agent.performRedemptionPayment(request2);
            await agent.confirmActiveRedemptionPayment(request2, tx2Hash);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request2.feeUBA), redeemingUBA: 0 });

            // redeemer 3 requests redemption (1 lot)
            // agent1 will send 1 lot to redeemer3
            const [redemptionRequests3, remainingLots3, dustChanges3] = await redeemer3.requestRedemption(lots3);
            const request3 = redemptionRequests3[0];
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request2.feeUBA), mintedUBA: poolFeeShare, redeemingUBA: lotsUBA3 });
            assertWeb3Equal(remainingLots3, 0);
            assert.equal(dustChanges3.length, 0);
            assert.equal(redemptionRequests2.length, 1);
            assert.equal(request3.agentVault, agent.vaultAddress);
            const tx4Hash = await agent.performRedemptionPayment(request3);
            await agent.confirmActiveRedemptionPayment(request3, tx4Hash);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request2.feeUBA).add(request3.feeUBA), redeemingUBA: 0 });

            // agent1 can now exit
            await agent.exitAndDestroy(fullAgentCollateral);
        });
    });
});
