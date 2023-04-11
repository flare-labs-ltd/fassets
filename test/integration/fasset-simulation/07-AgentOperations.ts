import { expectRevert, time } from "@openzeppelin/test-helpers";
import { DAYS, toBN, toWei } from "../../../lib/utils/helpers";
import { calcGasCost } from "../../utils/eth";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { Challenger } from "../utils/Challenger";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo, testNatInfo } from "../utils/TestChainInfo";

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
    let mockStateConnectorClient: MockStateConnectorClient;

    beforeEach(async () => {
        commonContext = await CommonContext.createTest(governance, testNatInfo);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
        mockChain = context.chain as MockChain;
        mockStateConnectorClient = context.stateConnectorClient as MockStateConnectorClient;
    });

    describe("simple scenarios - agent manipulating collateral and underlying address", () => {
        it("collateral withdrawal", async () => {
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
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: crt.feeUBA, mintedUBA: minted.mintedAmountUBA });
            // should not withdraw all but only free collateral
            await expectRevert(agent.announceClass1CollateralWithdrawal(fullAgentCollateral), "withdrawal: value too high");
            const agentMinCollateralRatioBIPS = (await context.assetManager.getAgentInfo(agent.agentVault.address)).agentMinCollateralRatioBIPS;
            const reservedCollateral = context.convertAmgToNATWei(
                await context.convertLotsToAMG(lots),
                await context.currentAmgToNATWeiPrice())
                .mul(toBN(agentMinCollateralRatioBIPS)).divn(10000);
            const withdrawalAmount = fullAgentCollateral.sub(reservedCollateral);
            await agent.announceClass1CollateralWithdrawal(withdrawalAmount);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: crt.feeUBA, mintedUBA: minted.mintedAmountUBA, reservedUBA: 0, redeemingUBA: 0, announcedClass1WithdrawalWei: withdrawalAmount });
            await expectRevert(agent.withdrawClass1Collateral(withdrawalAmount), "withdrawal: not allowed yet");
            await time.increase(300);
            const startBalance = toBN(await web3.eth.getBalance(agent.ownerHotAddress));
            const tx = await agent.withdrawClass1Collateral(withdrawalAmount);
            await agent.checkAgentInfo({ totalClass1CollateralWei: reservedCollateral, freeUnderlyingBalanceUBA: crt.feeUBA, mintedUBA: minted.mintedAmountUBA });
            const endBalance = toBN(await web3.eth.getBalance(agent.ownerHotAddress));
            assertWeb3Equal(endBalance.sub(startBalance).add(await calcGasCost(tx)), withdrawalAmount);
            await expectRevert(agent.announceClass1CollateralWithdrawal(1), "withdrawal: value too high");
        });

        it("topup payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: 0, mintedUBA: 0 });
            // topup payment
            const amount = 100;
            const txHash = await agent.performTopupPayment(amount);
            await agent.confirmTopupPayment(txHash);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: amount, mintedUBA: 0 });
            // check that confirming the same topup payment reverts
            await expectRevert(agent.confirmTopupPayment(txHash), "payment already confirmed");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("underlying withdrawal", async () => {
            const agent1 = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent1.depositCollateral(fullAgentCollateral);
            await agent1.makeAvailable(500, 2_2000);
            await agent2.depositCollateral(fullAgentCollateral);
            await agent2.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // topup payment
            const amount = 100;
            const tx1Hash = await agent1.performTopupPayment(amount);
            await agent1.confirmTopupPayment(tx1Hash);
            await agent1.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: amount, mintedUBA: 0 });
            const tx2Hash = await agent2.performTopupPayment(amount);
            await agent2.confirmTopupPayment(tx2Hash);
            await agent2.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: amount, mintedUBA: 0 });
            // underlying withdrawal
            const underlyingWithdrawal1 = await agent1.announceUnderlyingWithdrawal();
            const info1 = await agent1.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: amount, mintedUBA: 0 });
            assert.isAbove(Number(underlyingWithdrawal1.announcementId), 0);
            assertWeb3Equal(info1.announcedUnderlyingWithdrawalId, underlyingWithdrawal1.announcementId);
            const underlyingWithdrawal2 = await agent2.announceUnderlyingWithdrawal();
            const info2 = await agent2.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: amount, mintedUBA: 0 });
            assert.isAbove(Number(underlyingWithdrawal2.announcementId), Number(underlyingWithdrawal1.announcementId));
            assertWeb3Equal(info2.announcedUnderlyingWithdrawalId, underlyingWithdrawal2.announcementId);
            const tx3Hash = await agent1.performUnderlyingWithdrawal(underlyingWithdrawal1, amount);
            const res1 = await agent1.confirmUnderlyingWithdrawal(underlyingWithdrawal1, tx3Hash);
            await agent1.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: 0, mintedUBA: 0 });
            assertWeb3Equal(res1.spentUBA, amount);
            const tx4Hash = await agent2.performUnderlyingWithdrawal(underlyingWithdrawal2, amount);
            const res2 = await agent2.confirmUnderlyingWithdrawal(underlyingWithdrawal2, tx4Hash);
            await agent2.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: 0, mintedUBA: 0 });
            assertWeb3Equal(res2.spentUBA, amount);
            // agent can exit now
            await agent1.exitAndDestroy(fullAgentCollateral);
            await agent2.exitAndDestroy(fullAgentCollateral);
        });

        it("underlying withdrawal (others can confirm underlying withdrawal after some time)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const challenger = await Challenger.create(context, challengerAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // topup payment
            const amount = 100;
            const txHash = await agent.performTopupPayment(amount);
            await agent.confirmTopupPayment(txHash);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: amount, mintedUBA: 0 });
            // underlying withdrawal
            const underlyingWithdrawal = await agent.announceUnderlyingWithdrawal();
            const tx1Hash = await agent.performUnderlyingWithdrawal(underlyingWithdrawal, amount);
            const info = await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: amount, mintedUBA: 0 });
            assert.isAbove(Number(underlyingWithdrawal.announcementId), 0);
            assertWeb3Equal(info.announcedUnderlyingWithdrawalId, underlyingWithdrawal.announcementId);
            // others cannot confirm underlying withdrawal immediatelly or challenge it as illegal payment
            await expectRevert(challenger.confirmUnderlyingWithdrawal(underlyingWithdrawal, tx1Hash, agent), "only agent vault owner");
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "matching ongoing announced pmt");
            // others can confirm underlying withdrawal after some time
            await time.increase(context.settings.confirmationByOthersAfterSeconds);
            const startBalance = await context.wNat.balanceOf(challenger.address);
            const res = await challenger.confirmUnderlyingWithdrawal(underlyingWithdrawal, tx1Hash, agent);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)), freeUnderlyingBalanceUBA: 0, mintedUBA: 0 });
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            assertWeb3Equal(res.spentUBA, amount);
            const endBalance = await context.wNat.balanceOf(challenger.address);
            // test rewarding
            assertWeb3Equal(endBalance.sub(startBalance), context.settings.confirmationByOthersRewardNATWei);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)));
        });

        it("try to redeem after pause, terminate, buybackAgentCollateral", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter1 = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const minter2 = await Minter.createTest(context, minterAddress2, underlyingMinter2, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots1 = 3;
            const crt1 = await minter1.reserveCollateral(agent.vaultAddress, lots1);
            const tx1Hash = await minter1.performMintingPayment(crt1);
            const minted1 = await agent.executeMinting(crt1, tx1Hash);
            assertWeb3Equal(minted1.mintedAmountUBA, context.convertLotsToUBA(lots1));
            const lots2 = 6;
            const crt2 = await minter2.reserveCollateral(agent.vaultAddress, lots2);
            const tx2Hash = await minter2.performMintingPayment(crt2);
            // pause asset manager
            await context.assetManagerController.pause([context.assetManager.address], { from: governance });
            assert.isTrue(await context.assetManager.paused());
            // existing minting can be executed, new minting is not possible
            const minted2 = await agent.executeMinting(crt2, tx2Hash, minter2);
            await expectRevert(minter1.reserveCollateral(agent.vaultAddress, lots1), "minting paused");
            await expectRevert(agent.selfMint(context.convertLotsToUBA(lots1), lots1), "minting paused");
            // agent and redeemer "buys" f-assets
            await context.fAsset.transfer(agent.ownerHotAddress, minted1.mintedAmountUBA, { from: minter1.address });
            await context.fAsset.transfer(redeemer.address, minted2.mintedAmountUBA, { from: minter2.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots2 / 2);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const txHash = await agent.performRedemptionPayment(request);
            await agent.confirmActiveRedemptionPayment(request, txHash);
            // perform self close
            const [dustChanges1, selfClosedUBA] = await agent.selfClose(minted1.mintedAmountUBA);
            assertWeb3Equal(selfClosedUBA, minted1.mintedAmountUBA);
            assert.equal(dustChanges1.length, 0);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: crt1.feeUBA.add(crt2.feeUBA).add(request.feeUBA).add(selfClosedUBA), mintedUBA: minted2.mintedAmountUBA.sub(request.valueUBA) });
            // stop FAsset
            await expectRevert(agent.buybackAgentCollateral(), "f-asset not terminated");
            await expectRevert(context.assetManagerController.terminate([context.assetManager.address], { from: governance }), "asset manager not paused enough");
            await time.increase(30 * DAYS);
            mockChain.skipTime(30 * DAYS);
            const [redemptionRequests2, remainingLots2, dustChanges2] = await redeemer.requestRedemption(1);
            assertWeb3Equal(remainingLots2, 0);
            assert.equal(dustChanges2.length, 0);
            assert.equal(redemptionRequests2.length, 1);
            await context.assetManagerController.terminate([context.assetManager.address], { from: governance });
            // check that new redemption is not possible anymore, but started one can finish
            await expectRevert(redeemer.requestRedemption(lots2 / 3), "f-asset terminated");
            const request2 = redemptionRequests2[0];
            assert.equal(request2.agentVault, agent.vaultAddress);
            const tx3Hash = await agent.performRedemptionPayment(request2);
            await agent.confirmActiveRedemptionPayment(request2, tx3Hash);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: crt1.feeUBA.add(crt2.feeUBA).add(request.feeUBA).add(selfClosedUBA).add(request2.feeUBA), mintedUBA: minted2.mintedAmountUBA.sub(request.valueUBA).sub(request2.valueUBA) });
            // buybackAgentCollateral
            const burnAddress = (await context.assetManager.getSettings()).burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const startBalanceAgent = await context.wNat.balanceOf(agent.agentVault.address);
            await agent.buybackAgentCollateral();
            const endBalanceAgent = await context.wNat.balanceOf(agent.agentVault.address);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const buybackAgentCollateralValue = await agent.getBuybackAgentCollateralValue(minted2.mintedAmountUBA.divn(3));
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), buybackAgentCollateralValue);
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), buybackAgentCollateralValue);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral.sub(buybackAgentCollateralValue), freeUnderlyingBalanceUBA: crt1.feeUBA.add(crt2.feeUBA).add(request.feeUBA).add(selfClosedUBA).add(request2.feeUBA), mintedUBA: 0 });
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(buybackAgentCollateralValue));
        });
    });
});
