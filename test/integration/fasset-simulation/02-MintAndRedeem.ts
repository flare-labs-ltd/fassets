import { expectRevert, time } from "@openzeppelin/test-helpers";
import { MAX_BIPS, toBN, toWei } from "../../../lib/utils/helpers";
import { Approximation } from "../../utils/approximation";
import { MockChain } from "../../utils/fasset/MockChain";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo } from "../utils/TestChainInfo";
import { waitForTimelock } from "../../utils/fasset/CreateAssetManager";

contract(`AssetManagerSimulation.sol; ${getTestFile(__filename)}; Asset manager simulations`, async accounts => {
    const governance = accounts[10];
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[21];
    const minterAddress1 = accounts[30];
    const minterAddress2 = accounts[31];
    const redeemerAddress1 = accounts[40];
    const redeemerAddress2 = accounts[41];
    const challengerAddress1 = accounts[50];
    const challengerAddress2 = accounts[51];
    const liquidatorAddress1 = accounts[60];
    const liquidatorAddress2 = accounts[61];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
    const underlyingAgent2 = "Agent2";
    const underlyingMinter1 = "Minter1";
    const underlyingMinter2 = "Minter2";
    const underlyingRedeemer1 = "Redeemer1";
    const underlyingRedeemer2 = "Redeemer2";

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
                reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA)) });
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
                reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA)) });
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
                reservedUBA: lotsUBA.add(agent.poolFeeShare(crt2.feeUBA)) });
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
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots*2);
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
            await context.whitelist?.addAddressesToWhitelist([minter.address,redeemer.address], {from: governance});
            await context.agentWhitelist?.addAddressToWhitelist(agentOwner1, {from: governance});
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
                reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA)) });
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
                await waitForTimelock(res,context.whitelist, governance);
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
                reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA)) });
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
                reservedUBA: lotsUBA2.add(agent.poolFeeShare(crt2.feeUBA)) });
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
            await agent1.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted1.agentFeeUBA.add(request1.feeUBA),
                mintedUBA: minted1.poolFeeUBA,
                freeVaultCollateralWei: Approximation.absolute(fullAgentCollateral.sub(poolFeeCollateral), 10) });
            const request2 = redemptionRequests[1];
            assert.equal(request2.agentVault, agent2.vaultAddress);
            const tx4Hash = await agent2.performRedemptionPayment(request2);
            await agent2.confirmActiveRedemptionPayment(request2, tx4Hash);
            await agent2.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted2.agentFeeUBA.add(request2.feeUBA),
                mintedUBA: context.convertLotsToUBA(3).add(minted2.poolFeeUBA) });
            await expectRevert(agent2.announceVaultCollateralWithdrawal(fullAgentCollateral), "withdrawal: value too high");
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
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: crt.feeUBA.sub(minted.poolFeeUBA),
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA) });
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerWorkAddress, minted.mintedAmountUBA, { from: minter.address });
            // perform self close
            const [dustChanges, selfClosedUBA] = await agent.selfClose(minted.mintedAmountUBA);
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: crt.feeUBA.sub(minted.poolFeeUBA).add(crt.valueUBA),
                mintedUBA: minted.poolFeeUBA });
            assertWeb3Equal(selfClosedUBA, minted.mintedAmountUBA);
            assert.equal(dustChanges.length, 2);    // initially dust is cleared and then re-created
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });
    });
});
