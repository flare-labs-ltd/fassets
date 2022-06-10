import { expectRevert, time } from "@openzeppelin/test-helpers";
import { findRequiredEvent, requiredEventArgs } from "../../utils/events";
import { TX_BLOCKED, TX_FAILED } from "../../utils/fasset/ChainInterfaces";
import { MockChain } from "../../utils/fasset/MockChain";
import { PaymentReference } from "../../utils/fasset/PaymentReference";
import { BN_ZERO, DAYS, getTestFile, toBN, toBNExp, toWei } from "../../utils/helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext, CommonContext } from "../utils/AssetContext";
import { testChainInfo, testNatInfo } from "../utils/ChainInfo";
import { Challenger } from "../utils/Challenger";
import { Liquidator } from "../utils/Liquidator";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";

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
    
    beforeEach(async () => {
        commonContext = await CommonContext.createTest(governance, testNatInfo);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
    });
    
    describe("simple scenarios", () => {
        it("create agent", async () => {
            await Agent.createTest(context, agentOwner1, underlyingAgent1);
        });

        it("get agent info", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            // before making agent public available
            const info = await agent.checkAgentInfo(0, 0, 0, 0);
            assert.isFalse(info.publiclyAvailable);
            assertWeb3Equal(info.dustUBA, 0);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, 0);
            assertWeb3Equal(info.feeBIPS, 0);
            assertWeb3Equal(info.announcedUnderlyingWithdrawalId, 0);
            assertWeb3Equal(info.agentMinCollateralRatioBIPS, context.settings.minCollateralRatioBIPS);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 5_2000);
            const info2 = await agent.checkAgentInfo(fullAgentCollateral, 0, 0, 0);
            assert.isTrue(info2.publiclyAvailable);
            assertWeb3Equal(info2.dustUBA, 0);
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            assertWeb3Equal(info2.feeBIPS, 500);
            assertWeb3Equal(info2.announcedUnderlyingWithdrawalId, 0);
            assertWeb3Equal(info2.agentMinCollateralRatioBIPS, 5_2000);
            // make agent unavailable
            await agent.exitAvailable();
            const info3 = await agent.checkAgentInfo(fullAgentCollateral, 0, 0, 0);
            assert.isFalse(info3.publiclyAvailable);
            assertWeb3Equal(info3.dustUBA, 0);
            assertWeb3Equal(info3.ccbStartTimestamp, 0);
            assertWeb3Equal(info3.liquidationStartTimestamp, 0);
            assertWeb3Equal(info3.feeBIPS, 500);
            assertWeb3Equal(info3.announcedUnderlyingWithdrawalId, 0);
            assertWeb3Equal(info3.agentMinCollateralRatioBIPS, 5_2000);
        });

        it("get available agents", async () => {
            const agent1 = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
            const availableAgents1 = await context.assetManager.getAvailableAgentsList(0, 10);
            assert.equal(availableAgents1[0].length, 0);
            assertWeb3Equal(availableAgents1[1], 0);
            const fullAgentCollateral = toWei(3e8);
            await agent1.depositCollateral(fullAgentCollateral);
            await agent1.makeAvailable(500, 2_2000);
            const availableAgents2 = await context.assetManager.getAvailableAgentsList(0, 10);
            assert.equal(availableAgents2[0].length, 1);
            assert.equal(availableAgents2[0][0], agent1.agentVault.address);
            assertWeb3Equal(availableAgents2[1], 1);
            await agent2.depositCollateral(fullAgentCollateral);
            await agent2.makeAvailable(600, 3_2000);
            const availableAgents3 = await context.assetManager.getAvailableAgentsList(0, 10);
            assert.equal(availableAgents3[0].length, 2);
            assert.equal(availableAgents3[0][0], agent1.agentVault.address);
            assert.equal(availableAgents3[0][1], agent2.agentVault.address);
            assertWeb3Equal(availableAgents3[1], 2);
            const availableAgents4 = await context.assetManager.getAvailableAgentsList(0, 1);
            assert.equal(availableAgents4[0].length, 1);
            assert.equal(availableAgents4[0][0], agent1.agentVault.address);
            assertWeb3Equal(availableAgents4[1], 2);
            await agent1.exitAvailable();
            const availableAgents5 = await context.assetManager.getAvailableAgentsList(0, 10);
            assert.equal(availableAgents5[0].length, 1);
            assert.equal(availableAgents5[0][0], agent2.agentVault.address);
            assertWeb3Equal(availableAgents5[1], 1);
            await agent1.makeAvailable(800, 2_5000);
            const availableAgents6 = await context.assetManager.getAvailableAgentsList(0, 10);
            assert.equal(availableAgents6[0].length, 2);
            assert.equal(availableAgents6[0][0], agent2.agentVault.address);
            assert.equal(availableAgents6[0][1], agent1.agentVault.address);
            assertWeb3Equal(availableAgents6[1], 2);
        });

        it("get available agents details", async () => {
            const agent1 = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
            const availableAgents1 = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(availableAgents1[0].length, 0);
            assertWeb3Equal(availableAgents1[1], 0);
            const fullAgentCollateral = toWei(3e8);
            await agent1.depositCollateral(fullAgentCollateral);
            await agent1.makeAvailable(500, 2_2000);
            const availableAgents2 = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(availableAgents2[0].length, 1);
            assert.equal(availableAgents2[0][0].agentVault, agent1.agentVault.address);
            assertWeb3Equal(availableAgents2[0][0].feeBIPS, 500);
            assertWeb3Equal(availableAgents2[0][0].agentMinCollateralRatioBIPS, 2_2000);
            assertWeb3Equal(availableAgents2[0][0].freeCollateralLots, await agent1.calculateFreeCollateralLots(fullAgentCollateral));
            assertWeb3Equal(availableAgents2[1], 1);
            await agent2.depositCollateral(fullAgentCollateral);
            await agent2.makeAvailable(600, 3_2000);
            const availableAgents3 = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(availableAgents3[0].length, 2);
            assert.equal(availableAgents3[0][0].agentVault, agent1.agentVault.address);
            assertWeb3Equal(availableAgents3[0][0].feeBIPS, 500);
            assertWeb3Equal(availableAgents3[0][0].agentMinCollateralRatioBIPS, 2_2000);
            assertWeb3Equal(availableAgents3[0][0].freeCollateralLots, await agent1.calculateFreeCollateralLots(fullAgentCollateral));
            assert.equal(availableAgents3[0][1].agentVault, agent2.agentVault.address);
            assertWeb3Equal(availableAgents3[0][1].feeBIPS, 600);
            assertWeb3Equal(availableAgents3[0][1].agentMinCollateralRatioBIPS, 3_2000);
            assertWeb3Equal(availableAgents3[0][1].freeCollateralLots, await agent2.calculateFreeCollateralLots(fullAgentCollateral));
            assertWeb3Equal(availableAgents3[1], 2);
            const availableAgents4 = await context.assetManager.getAvailableAgentsDetailedList(0, 1);
            assert.equal(availableAgents4[0].length, 1);
            assert.equal(availableAgents4[0][0].agentVault, agent1.agentVault.address);
            assertWeb3Equal(availableAgents4[0][0].feeBIPS, 500);
            assertWeb3Equal(availableAgents4[0][0].agentMinCollateralRatioBIPS, 2_2000);
            assertWeb3Equal(availableAgents4[0][0].freeCollateralLots, await agent1.calculateFreeCollateralLots(fullAgentCollateral));
            assertWeb3Equal(availableAgents4[1], 2);
            await agent1.exitAvailable();
            const availableAgents5 = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(availableAgents5[0].length, 1);
            assert.equal(availableAgents5[0][0].agentVault, agent2.agentVault.address);
            assertWeb3Equal(availableAgents5[0][0].feeBIPS, 600);
            assertWeb3Equal(availableAgents5[0][0].agentMinCollateralRatioBIPS, 3_2000);
            assertWeb3Equal(availableAgents5[0][0].freeCollateralLots, await agent2.calculateFreeCollateralLots(fullAgentCollateral));
            assertWeb3Equal(availableAgents5[1], 1);
            await agent1.makeAvailable(800, 2_5000);
            const availableAgents6 = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(availableAgents6[0].length, 2);
            assert.equal(availableAgents6[0][0].agentVault, agent2.agentVault.address);
            assertWeb3Equal(availableAgents6[0][0].feeBIPS, 600);
            assertWeb3Equal(availableAgents6[0][0].agentMinCollateralRatioBIPS, 3_2000);
            assertWeb3Equal(availableAgents6[0][0].freeCollateralLots, await agent2.calculateFreeCollateralLots(fullAgentCollateral));
            assert.equal(availableAgents6[0][1].agentVault, agent1.agentVault.address);
            assertWeb3Equal(availableAgents6[0][1].feeBIPS, 800);
            assertWeb3Equal(availableAgents6[0][1].agentMinCollateralRatioBIPS, 2_5000);
            assertWeb3Equal(availableAgents6[0][1].freeCollateralLots, await agent1.calculateFreeCollateralLots(fullAgentCollateral));
            assertWeb3Equal(availableAgents6[1], 2);
        });

        it("mint and redeem f-assets", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
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
            const lotsUBA = await context.convertLotsToUBA(lots);
            await agent.checkAgentInfo(fullAgentCollateral, 0, 0, 0, lotsUBA);
            const burnAddress = (await context.assetManager.getSettings()).burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const minted = await minter.executeMinting(crt, txHash);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted.mintedAmountUBA, lotsUBA);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, lotsUBA);
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, lotsUBA);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const tx1Hash = await agent.performRedemptionPayment(request);
            await agent.confirmActiveRedemptionPayment(request, tx1Hash);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(request.feeUBA), 0, 0);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets - payment blocked", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
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
            const lotsUBA = await context.convertLotsToUBA(lots);
            await agent.checkAgentInfo(fullAgentCollateral, 0, 0, 0, lotsUBA);
            const burnAddress = (await context.assetManager.getSettings()).burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const minted = await minter.executeMinting(crt, txHash);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted.mintedAmountUBA, lotsUBA);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, lotsUBA);
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, lotsUBA);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const tx1Hash = await agent.performRedemptionPayment(request, {status: TX_BLOCKED});
            await agent.confirmBlockedRedemptionPayment(request, tx1Hash);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(request.valueUBA), 0, 0);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets (two redemption tickets - same agent) + agent can confirm mintings", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter1 = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const minter2 = await Minter.createTest(context, minterAddress2, underlyingMinter2, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots1 = 3;
            await agent.checkAgentInfo(fullAgentCollateral, 0, 0, 0);
            const crt1 = await minter1.reserveCollateral(agent.vaultAddress, lots1);
            await agent.checkAgentInfo(fullAgentCollateral, 0, 0, 0, crt1.valueUBA);
            const tx1Hash = await minter1.performMintingPayment(crt1);
            await agent.checkAgentInfo(fullAgentCollateral, 0, 0, 0, crt1.valueUBA);
            const minted1 = await agent.executeMinting(crt1, tx1Hash);
            assertWeb3Equal(minted1.mintedAmountUBA, await context.convertLotsToUBA(lots1));
            await agent.checkAgentInfo(fullAgentCollateral, crt1.feeUBA, minted1.mintedAmountUBA, await context.convertLotsToUBA(lots1));
            const lots2 = 6;
            const crt2 = await minter2.reserveCollateral(agent.vaultAddress, lots2);
            await agent.checkAgentInfo(fullAgentCollateral, crt1.feeUBA, minted1.mintedAmountUBA, await context.convertLotsToUBA(lots1), crt2.valueUBA);
            const tx2Hash = await minter2.performMintingPayment(crt2);
            await agent.checkAgentInfo(fullAgentCollateral, crt1.feeUBA, minted1.mintedAmountUBA, await context.convertLotsToUBA(lots1), crt2.valueUBA);
            const minted2 = await agent.executeMinting(crt2, tx2Hash, minter2);
            assertWeb3Equal(minted2.mintedAmountUBA, await context.convertLotsToUBA(lots2));
            await agent.checkAgentInfo(fullAgentCollateral, crt1.feeUBA.add(crt2.feeUBA), minted1.mintedAmountUBA.add(minted2.mintedAmountUBA), await context.convertLotsToUBA(lots1 + lots2));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted2.mintedAmountUBA, { from: minter2.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots2);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const txHash = await agent.performRedemptionPayment(request);
            await agent.checkAgentInfo(fullAgentCollateral, crt1.feeUBA.add(crt2.feeUBA), minted1.mintedAmountUBA, await context.convertLotsToUBA(lots1), 0, await context.convertLotsToUBA(lots2));
            await agent.confirmActiveRedemptionPayment(request, txHash);
            await agent.checkAgentInfo(fullAgentCollateral, crt1.feeUBA.add(crt2.feeUBA).add(request.feeUBA), minted1.mintedAmountUBA, await context.convertLotsToUBA(lots1));
            await expectRevert(agent.announceCollateralWithdrawal(fullAgentCollateral), "withdrawal: value too high");
        });

        it("mint and redeem f-assets (two redemption tickets - different agents)", async () => {
            const agent1 = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent1.depositCollateral(fullAgentCollateral);
            await agent1.makeAvailable(500, 2_2000);
            await agent2.depositCollateral(fullAgentCollateral);
            await agent2.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots1 = 3;
            const crt1 = await minter.reserveCollateral(agent1.vaultAddress, lots1);
            const tx1Hash = await minter.performMintingPayment(crt1);
            const minted1 = await minter.executeMinting(crt1, tx1Hash);
            assertWeb3Equal(minted1.mintedAmountUBA, await context.convertLotsToUBA(lots1));
            const lots2 = 6;
            const crt2 = await minter.reserveCollateral(agent2.vaultAddress, lots2);
            const tx2Hash = await minter.performMintingPayment(crt2);
            const minted2 = await minter.executeMinting(crt2, tx2Hash);
            assertWeb3Equal(minted2.mintedAmountUBA, await context.convertLotsToUBA(lots2));
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
            await agent1.announceCollateralWithdrawal(fullAgentCollateral);
            await agent1.checkAgentInfo(fullAgentCollateral, crt1.feeUBA.add(request1.feeUBA), 0, 0, 0, 0, fullAgentCollateral);
            const request2 = redemptionRequests[1];
            assert.equal(request2.agentVault, agent2.vaultAddress);
            const tx4Hash = await agent2.performRedemptionPayment(request2);
            await agent2.confirmActiveRedemptionPayment(request2, tx4Hash);
            await agent2.checkAgentInfo(fullAgentCollateral, crt2.feeUBA.add(request2.feeUBA), minted1.mintedAmountUBA, await context.convertLotsToUBA(lots1));
            await expectRevert(agent2.announceCollateralWithdrawal(fullAgentCollateral), "withdrawal: value too high");
        });

        it("mint and redeem f-assets (one redemption ticket - two redeemers)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer1 = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const redeemer2 = await Redeemer.create(context, redeemerAddress2, underlyingRedeemer2);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
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
            await expectRevert(agent.announceCollateralWithdrawal(fullAgentCollateral), "withdrawal: value too high");
            const request2 = redemptionRequests2[0];
            assert.equal(request2.agentVault, agent.vaultAddress);
            const tx4Hash = await agent.performRedemptionPayment(request2);
            await agent.confirmActiveRedemptionPayment(request2, tx4Hash);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint defaults - no underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform collateral
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // test rewarding for mint default
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            await agent.mintingPaymentDefault(crt);
            await agent.checkAgentInfo(fullAgentCollateral.add(crFee), 0, 0, 0);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            assertWeb3Equal(endBalanceAgent.sub(startBalanceAgent), crFee);
            // check that executing minting after calling mintingPaymentDefault will revert
            const txHash = await minter.performMintingPayment(crt);
            await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.add(crFee));
        });

        it("mint defaults - failed underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform collateral
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            // perform some payment with correct minting reference and wrong amount
            await minter.performPayment(crt.paymentAddress, 100, crt.paymentReference);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // test rewarding for mint default
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            await agent.mintingPaymentDefault(crt);
            await agent.checkAgentInfo(fullAgentCollateral.add(crFee), 0, 0, 0);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            assertWeb3Equal(endBalanceAgent.sub(startBalanceAgent), crFee);
            // check that executing minting after calling mintingPaymentDefault will revert
            const txHash = await minter.performMintingPayment(crt);
            await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.add(crFee));
        });
        
        it("mint unstick - no underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform collateral
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling unstickMinting after no payment will revert if called too soon
            await expectRevert(agent.unstickMinting(crt), "cannot unstick minting yet");
            await time.increase(DAYS);
            await agent.checkAgentInfo(fullAgentCollateral, 0, 0, 0, await context.convertLotsToUBA(lots));
            // test rewarding for unstick default
            const burnAddress = (await context.assetManager.getSettings()).burnAddress;
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            await agent.unstickMinting(crt);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const reservedCollateral = context.convertAmgToNATWei(
                await context.convertLotsToAMG(lots),
                await context.currentAmgToNATWeiPrice());
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), reservedCollateral);
            assert(reservedCollateral.gt(BN_ZERO));
            // check that fee and collateral was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee.add(reservedCollateral));
            await agent.checkAgentInfo(fullAgentCollateral.sub(reservedCollateral), 0, 0, 0);
            // check that executing minting after calling unstickMinting will revert
            const txHash = await minter.performMintingPayment(crt);
            await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(reservedCollateral));
        });

        it("mint unstick - failed underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform collateral
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            // perform some payment with correct minting reference and wrong amount
            await minter.performPayment(crt.paymentAddress, 100, crt.paymentReference);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling unstickMinting after failed minting payment will revert if called too soon
            await expectRevert(agent.unstickMinting(crt), "cannot unstick minting yet");
            await time.increase(DAYS);
            // test rewarding for unstick default
            const burnAddress = (await context.assetManager.getSettings()).burnAddress;
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            await agent.unstickMinting(crt);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const reservedCollateral = context.convertAmgToNATWei(
                await context.convertLotsToAMG(lots),
                await context.currentAmgToNATWeiPrice());
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), reservedCollateral);
            assert(reservedCollateral.gt(BN_ZERO));
            // check that fee and collateral was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee.add(reservedCollateral));
            // check that executing minting after calling unstickMinting will revert
            const txHash = await minter.performMintingPayment(crt);
            await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(reservedCollateral));
        });

        it("mint unstick - unconfirmed underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform collateral
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            // perform minting payment without sending proof
            const txHash = await minter.performMintingPayment(crt);
            await context.attestationProvider.provePayment(txHash, minter.underlyingAddress, crt.paymentAddress);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling unstickMinting after unconfirmed payment will revert if called too soon
            await expectRevert(agent.unstickMinting(crt), "cannot unstick minting yet");
            await time.increase(DAYS);
            // test rewarding for unstick default
            const burnAddress = (await context.assetManager.getSettings()).burnAddress;
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            await agent.unstickMinting(crt);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const reservedCollateral = context.convertAmgToNATWei(
                await context.convertLotsToAMG(lots),
                await context.currentAmgToNATWeiPrice());
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), reservedCollateral);
            assert(reservedCollateral.gt(BN_ZERO));
            // check that fee and collateral was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee.add(reservedCollateral));
            // check that executing minting after calling unstickMinting will revert
            await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(reservedCollateral));
        });

        it("mint and redeem defaults (agent) - no underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            assertWeb3Equal(minted.mintedAmountUBA, crt.valueUBA);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            // test rewarding for redemption payment default
            const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const res = await agent.redemptionPaymentDefault(request);
            await agent.checkAgentInfo(fullAgentCollateral.sub(res.redeemedCollateralWei), crt.feeUBA, 0, 0);
            const [redFin, redDef] = await agent.finishRedemptionWithoutPayment(request);
            await agent.checkAgentInfo(fullAgentCollateral.sub(res.redeemedCollateralWei), crt.feeUBA.add(crt.valueUBA), 0, 0);
            const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            assertWeb3Equal(redFin.requestId, request.requestId);
            assert.isUndefined(redDef);
            assertWeb3Equal(res.redeemedCollateralWei, await agent.getRedemptionPaymentDefaultValue(lots));
            assertWeb3Equal(endBalanceRedeemer.sub(startBalanceRedeemer), res.redeemedCollateralWei);
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), res.redeemedCollateralWei);
            // check that confirming redemption payment after calling finishRedemptionWithoutPayment will revert
            const tx1Hash = await agent.performRedemptionPayment(request);
            await expectRevert(agent.confirmDefaultedRedemptionPayment(request, tx1Hash), "invalid request id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res.redeemedCollateralWei));
        });

        it("mint and redeem defaults (redeemer) - failed underlying payment (failed transaction)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            // perform some (failed) payment with correct redemption reference
            const tx1Hash = await agent.performRedemptionPayment(request, {status: TX_FAILED, gasLimit: 10, gasPrice: 10});
            const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const res = await agent.confirmFailedRedemptionPayment(request, tx1Hash);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling finishRedemptionWithoutPayment after failed redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // test rewarding for redemption payment default
            await agent.checkAgentInfo(fullAgentCollateral.sub(res[1].redeemedCollateralWei), crt.feeUBA.add(request.valueUBA).subn(100), 0, 0);
            const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            assertWeb3Equal(res[0].failureReason, "transaction failed");
            assertWeb3Equal(res[1].redeemedCollateralWei, await agent.getRedemptionPaymentDefaultValue(lots));
            assertWeb3Equal(endBalanceRedeemer.sub(startBalanceRedeemer), res[1].redeemedCollateralWei);
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), res[1].redeemedCollateralWei);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res[1].redeemedCollateralWei));
        });

        it("mint and redeem defaults (redeemer) - failed underlying payment (not redeemer's address)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            // perform some (failed) payment with correct redemption reference
            const tx1Hash = await agent.performPayment(minter.underlyingAddress, request.valueUBA, request.paymentReference);
            const proof = await context.attestationProvider.provePayment(tx1Hash, agent.underlyingAddress, minter.underlyingAddress);
            const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const res = await context.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: agent.ownerAddress })
            findRequiredEvent(res, 'RedemptionFinished');
            const resFailed = requiredEventArgs(res, 'RedemptionPaymentFailed');
            const resDefault = requiredEventArgs(res, 'RedemptionDefault');
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling finishRedemptionWithoutPayment after failed redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // test rewarding for redemption payment default
            await agent.checkAgentInfo(fullAgentCollateral.sub(resDefault.redeemedCollateralWei), crt.feeUBA, 0, 0);
            const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            assertWeb3Equal(resFailed.failureReason, "not redeemer's address");
            assertWeb3Equal(resDefault.redeemedCollateralWei, await agent.getRedemptionPaymentDefaultValue(lots));
            assertWeb3Equal(endBalanceRedeemer.sub(startBalanceRedeemer), resDefault.redeemedCollateralWei);
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), resDefault.redeemedCollateralWei);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(resDefault.redeemedCollateralWei));
        });

        it("mint and redeem defaults (redeemer) - failed underlying payment (redemption payment too small)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            // perform some (failed) payment with correct redemption reference
            const tx1Hash = await agent.performPayment(request.paymentAddress, 100, request.paymentReference);
            const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const res = await agent.confirmFailedRedemptionPayment(request, tx1Hash);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling finishRedemptionWithoutPayment after failed redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // test rewarding for redemption payment default
            await agent.checkAgentInfo(fullAgentCollateral.sub(res[1].redeemedCollateralWei), crt.feeUBA.add(request.valueUBA).subn(100), 0, 0);
            const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            assertWeb3Equal(res[0].failureReason, "redemption payment too small");
            assertWeb3Equal(res[1].redeemedCollateralWei, await agent.getRedemptionPaymentDefaultValue(lots));
            assertWeb3Equal(endBalanceRedeemer.sub(startBalanceRedeemer), res[1].redeemedCollateralWei);
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), res[1].redeemedCollateralWei);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res[1].redeemedCollateralWei));
        });

        it("mint and redeem defaults (redeemer) - wrong underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            // perform some (failed) payment with correct redemption reference
            const tx1Hash = await agent.wallet.addTransaction(minter.underlyingAddress, request.paymentAddress, 1, request.paymentReference);
            const proof = await context.attestationProvider.provePayment(tx1Hash, minter.underlyingAddress, request.paymentAddress);
            await expectRevert(context.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: agent.ownerAddress }), "confirm failed payment only from agent's address");
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling finishRedemptionWithoutPayment after failed redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "should default first");
            // test rewarding for redemption payment default
            const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const res = await redeemer.redemptionPaymentDefault(request);
            await agent.checkAgentInfo(fullAgentCollateral.sub(res.redeemedCollateralWei), crt.feeUBA, 0, 0);
            const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            assertWeb3Equal(res.redeemedCollateralWei, await agent.getRedemptionPaymentDefaultValue(lots));
            assertWeb3Equal(endBalanceRedeemer.sub(startBalanceRedeemer), res.redeemedCollateralWei);
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), res.redeemedCollateralWei);
            const [redFin, redDef] = await agent.finishRedemptionWithoutPayment(request);
            await agent.checkAgentInfo(fullAgentCollateral.sub(res.redeemedCollateralWei), crt.feeUBA.add(crt.valueUBA), 0, 0);
            assertWeb3Equal(redFin.requestId, request.requestId);
            assert.isUndefined(redDef);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res.redeemedCollateralWei));
        });

        it("mint and redeem defaults (after a day) - no underlying payment (default not needed after a day)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling finishRedemptionWithoutPayment after no redemption payment will revert if called too soon
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "should default first");
            await time.increase(DAYS);
            // test rewarding for redemption payment default
            const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const [redFin, redDef] = await agent.finishRedemptionWithoutPayment(request);
            await agent.checkAgentInfo(fullAgentCollateral.sub(redDef.redeemedCollateralWei), crt.feeUBA.add(request.valueUBA), 0, 0);
            const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            assertWeb3Equal(redFin.requestId, request.requestId);
            assertWeb3Equal(redDef.redeemedCollateralWei, await agent.getRedemptionPaymentDefaultValue(lots));
            assertWeb3Equal(endBalanceRedeemer.sub(startBalanceRedeemer), redDef.redeemedCollateralWei);
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), redDef.redeemedCollateralWei);
            // check that confirming redemption payment after calling finishRedemptionWithoutPayment will revert
            const tx1Hash = await agent.performRedemptionPayment(request);
            await expectRevert(agent.confirmDefaultedRedemptionPayment(request, tx1Hash), "invalid request id");
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(redDef.redeemedCollateralWei));
        });

        it("mint and redeem defaults (redeemer) - too late underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // test rewarding for redemption payment default
            const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            const res = await redeemer.redemptionPaymentDefault(request);
            await agent.checkAgentInfo(fullAgentCollateral.sub(res.redeemedCollateralWei), crt.feeUBA, 0, 0);
            const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            assertWeb3Equal(res.redeemedCollateralWei, await agent.getRedemptionPaymentDefaultValue(lots));
            assertWeb3Equal(endBalanceRedeemer.sub(startBalanceRedeemer), res.redeemedCollateralWei);
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), res.redeemedCollateralWei);
            // perform too late redemption payment
            const tx1Hash = await agent.performRedemptionPayment(request);
            await agent.confirmDefaultedRedemptionPayment(request, tx1Hash);
            await agent.checkAgentInfo(fullAgentCollateral.sub(res.redeemedCollateralWei), crt.feeUBA.add(request.feeUBA), 0, 0);
            // check that calling finishRedemptionWithoutPayment after confirming redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res.redeemedCollateralWei));
        });

        it("mint and redeem f-assets (self-mint)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform self-minting
            const lots = 3;
            await agent.checkAgentInfo(fullAgentCollateral, 0, 0, 0);
            const minted = await agent.selfMint(await context.convertLotsToUBA(lots), lots);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, 0, minted.mintedAmountUBA, minted.mintedAmountUBA);
            // perform self close
            const [dustChanges, selfClosedUBA] = await agent.selfClose(minted.mintedAmountUBA);
            await agent.checkAgentInfo(fullAgentCollateral, minted.mintedAmountUBA, 0, 0);
            assertWeb3Equal(selfClosedUBA, minted.mintedAmountUBA);
            assert.equal(dustChanges.length, 0);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets (self-close)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA);
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerAddress, minted.mintedAmountUBA, { from: minter.address });
            // perform self close
            const [dustChanges, selfClosedUBA] = await agent.selfClose(minted.mintedAmountUBA);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(crt.valueUBA), 0, 0);
            assertWeb3Equal(selfClosedUBA, minted.mintedAmountUBA);
            assert.equal(dustChanges.length, 0);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets (self-close can create and/or remove dust)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA);
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerAddress, minted.mintedAmountUBA, { from: minter.address });
            // perform partial self close
            const dustAmountUBA = context.convertAmgToUBA(5);
            const selfCloseAmountUBA = minted.mintedAmountUBA.sub(dustAmountUBA);
            const [dustChangesUBA1, selfClosedUBA1] = await agent.selfClose(selfCloseAmountUBA);
            const info = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(selfCloseAmountUBA), dustAmountUBA, dustAmountUBA);
            assertWeb3Equal(info.dustUBA, dustAmountUBA);
            assertWeb3Equal(selfClosedUBA1, selfCloseAmountUBA);
            assert.equal(dustChangesUBA1.length, 1);
            assertWeb3Equal(dustChangesUBA1[0], dustAmountUBA);
            await expectRevert(agent.destroy(), "destroy not announced");
            const [dustChangesUBA2, selfClosedUBA2] = await agent.selfClose(dustAmountUBA);
            const info2 = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(selfCloseAmountUBA).add(dustAmountUBA), 0, 0);
            assertWeb3Equal(info2.dustUBA, 0);
            assertWeb3Equal(selfClosedUBA2, dustAmountUBA);
            assert.equal(dustChangesUBA2.length, 1);
            assertWeb3Equal(dustChangesUBA2[0], 0);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets (changing lot size can create dust)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // change lot size
            const currentSettings = await context.assetManager.getSettings();
            await context.assetManagerController.setLotSizeAmg([context.assetManager.address], toBN(currentSettings.lotSizeAMG).muln(2), { from: governance });
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges1] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 2);
            assert.equal(dustChanges1.length, 1);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            const dustAmountUBA = minted.mintedAmountUBA.sub(request.valueUBA);
            assertWeb3Equal(dustChanges1[0].dustUBA, dustAmountUBA);
            assert.equal(dustChanges1[0].agentVault, agent.agentVault.address);
            assert.equal(request.agentVault, agent.vaultAddress);
            const info = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, dustAmountUBA, dustAmountUBA, 0, request.valueUBA);
            assertWeb3Equal(info.dustUBA, dustAmountUBA);
            const tx1Hash = await agent.performRedemptionPayment(request);
            await agent.confirmActiveRedemptionPayment(request, tx1Hash);
            const info2 = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(request.feeUBA), dustAmountUBA, dustAmountUBA);
            assertWeb3Equal(info2.dustUBA, dustAmountUBA);
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerAddress, dustAmountUBA, { from: redeemer.address });
            // perform self close
            const [dustChangesUBA2, selfClosedUBA] = await agent.selfClose(dustAmountUBA);
            const info3 = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(request.feeUBA).add(dustAmountUBA), 0, 0);
            assertWeb3Equal(info3.dustUBA, 0);
            assertWeb3Equal(selfClosedUBA, dustAmountUBA);
            assert.equal(dustChangesUBA2.length, 1);
            assertWeb3Equal(dustChangesUBA2[0], 0);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem f-assets - convert dust to tickets", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // perform partial self close
            const dustAmountUBA = (await context.convertLotsToUBA(1)).sub(context.convertAmgToUBA(5));
            const selfCloseAmountUBA = minted.mintedAmountUBA.sub(dustAmountUBA);
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerAddress, selfCloseAmountUBA, { from: minter.address });
            const [dustChangesUBA, selfClosedUBA1] = await agent.selfClose(selfCloseAmountUBA);
            const info = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(selfCloseAmountUBA), dustAmountUBA, dustAmountUBA);
            assertWeb3Equal(info.dustUBA, dustAmountUBA);
            assertWeb3Equal(selfClosedUBA1, selfCloseAmountUBA);
            assert.equal(dustChangesUBA.length, 1);
            assertWeb3Equal(dustChangesUBA[0], minted.mintedAmountUBA.sub(selfCloseAmountUBA));
            // change lot size
            const currentSettings = await context.assetManager.getSettings();
            await context.assetManagerController.setLotSizeAmg([context.assetManager.address], toBN(currentSettings.lotSizeAMG).divn(4), { from: governance });
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA.sub(selfCloseAmountUBA), { from: minter.address });
            // perform redemption - no tickets
            await expectRevert(redeemer.requestRedemption(3), "redeem 0 lots");
            const info2 = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(selfCloseAmountUBA), dustAmountUBA, dustAmountUBA);
            assertWeb3Equal(info2.dustUBA, dustAmountUBA);
            // convert dust to redemption tickets
            const dustChangeUBA2 = await redeemer.convertDustToTickets(agent);
            const newDustAmount = (await context.convertLotsToUBA(1)).sub(context.convertAmgToUBA(5));
            assertWeb3Equal(dustChangeUBA2, newDustAmount);
            const info3 = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(selfCloseAmountUBA), dustAmountUBA, dustAmountUBA);
            assertWeb3Equal(info3.dustUBA, newDustAmount);
            // perform redemption from new tickets
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(3);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const tx1Hash = await agent.performRedemptionPayment(request);
            await agent.confirmActiveRedemptionPayment(request, tx1Hash);
            const info4 = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(selfCloseAmountUBA).add(request.feeUBA), dustAmountUBA.sub(request.valueUBA), dustAmountUBA.sub(request.valueUBA));
            assertWeb3Equal(info4.dustUBA, newDustAmount);
            // agent "buys" f-assets
            const dustAmountUBA2 = minted.mintedAmountUBA.sub(selfCloseAmountUBA).sub(request.valueUBA);
            await context.fAsset.transfer(agent.ownerAddress, dustAmountUBA2, { from: redeemer.address });
            // perform self close
            const [dustChangesUBA2, selfClosedUBA] = await agent.selfClose(dustAmountUBA2);
            const info5 = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(selfCloseAmountUBA).add(request.feeUBA).add(dustAmountUBA2), 0, 0);
            assertWeb3Equal(info5.dustUBA, 0);
            assertWeb3Equal(selfClosedUBA, dustAmountUBA2);
            assert.equal(dustChangesUBA2.length, 1);
            assertWeb3Equal(dustChangesUBA2[0], 0);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });
        
        it("mint and redeem f-assets (others can confirm redemption payment after some time)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const challenger = await Challenger.create(context, challengerAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const tx1Hash = await agent.performRedemptionPayment(request);
            // others cannot confirm redemption payment immediatelly or challenge it as illegal payment
            await expectRevert(challenger.confirmActiveRedemptionPayment(request, tx1Hash, agent), "only agent vault owner");
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "matching redemption active");
            await expectRevert(agent.destroy(), "destroy not announced");
            // others can confirm redemption payment after some time
            await time.increase(context.settings.confirmationByOthersAfterSeconds);
            const startBalance = await context.wnat.balanceOf(challenger.address);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            await challenger.confirmActiveRedemptionPayment(request, tx1Hash, agent);
            await agent.checkAgentInfo(fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)), crt.feeUBA.add(request.feeUBA), 0, 0);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            const endBalance = await context.wnat.balanceOf(challenger.address);
            // test rewarding
            assertWeb3Equal(endBalance.sub(startBalance), context.settings.confirmationByOthersRewardNATWei);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)));
        });

        it("mint and redeem f-assets (others can confirm blocked redemption payment after some time)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const challenger = await Challenger.create(context, challengerAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const tx1Hash = await agent.performRedemptionPayment(request, {status: TX_BLOCKED, maxFee: 100});
            // others cannot confirm redemption payment immediatelly or challenge it as illegal payment
            await expectRevert(challenger.confirmBlockedRedemptionPayment(request, tx1Hash, agent), "only agent vault owner");
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "matching redemption active");
            await expectRevert(agent.destroy(), "destroy not announced");
            // others can confirm redemption payment after some time
            await time.increase(context.settings.confirmationByOthersAfterSeconds);
            const startBalance = await context.wnat.balanceOf(challenger.address);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            await challenger.confirmBlockedRedemptionPayment(request, tx1Hash, agent);
            await agent.checkAgentInfo(fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)), crt.feeUBA.add(request.valueUBA).subn(100), 0, 0);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            const endBalance = await context.wnat.balanceOf(challenger.address);
            // test rewarding
            assertWeb3Equal(endBalance.sub(startBalance), context.settings.confirmationByOthersRewardNATWei);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)));
        });

        it("mint and redeem f-assets (others can confirm failed redemption payment after some time)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const challenger = await Challenger.create(context, challengerAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const tx1Hash = await agent.performRedemptionPayment(request, {status: TX_FAILED, gasLimit: 10, gasPrice: 10});
            // others cannot confirm redemption payment immediatelly or challenge it as illegal payment
            await expectRevert(challenger.confirmFailedRedemptionPayment(request, tx1Hash, agent), "only agent vault owner");
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "matching redemption active");
            await expectRevert(agent.destroy(), "destroy not announced");
            // others can confirm redemption payment after some time
            await time.increase(context.settings.confirmationByOthersAfterSeconds);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            const startBalanceChallenger = await context.wnat.balanceOf(challenger.address);
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const res = await challenger.confirmFailedRedemptionPayment(request, tx1Hash, agent);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            const endBalanceChallenger = await context.wnat.balanceOf(challenger.address);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            // test rewarding
            assertWeb3Equal(endBalanceChallenger.sub(startBalanceChallenger), context.settings.confirmationByOthersRewardNATWei);
             // test rewarding for redemption payment default
             await agent.checkAgentInfo(fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)).sub(res[1].redeemedCollateralWei), crt.feeUBA.add(request.valueUBA).subn(100), 0, 0);
             assertWeb3Equal(res[1].redeemedCollateralWei, await agent.getRedemptionPaymentDefaultValue(lots));
             assertWeb3Equal(endBalanceRedeemer.sub(startBalanceRedeemer), res[1].redeemedCollateralWei);
             assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), toBN(context.settings.confirmationByOthersRewardNATWei).add(res[1].redeemedCollateralWei));
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)).sub(res[1].redeemedCollateralWei));
        });

        it("mint and redeem f-assets (others can confirm default redemption payment after some time)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const challenger = await Challenger.create(context, challengerAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // test rewarding for redemption payment default
            const startBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            const res = await redeemer.redemptionPaymentDefault(request);
            await agent.checkAgentInfo(fullAgentCollateral.sub(res.redeemedCollateralWei), crt.feeUBA, 0, 0);
            const endBalanceRedeemer = await context.wnat.balanceOf(redeemer.address);
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            assertWeb3Equal(res.redeemedCollateralWei, await agent.getRedemptionPaymentDefaultValue(lots));
            assertWeb3Equal(endBalanceRedeemer.sub(startBalanceRedeemer), res.redeemedCollateralWei);
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), res.redeemedCollateralWei);
            // perform too late redemption payment
            const tx1Hash = await agent.performRedemptionPayment(request);
            // others can confirm redemption payment after some time
            await time.increase(context.settings.confirmationByOthersAfterSeconds);
            const startBalance = await context.wnat.balanceOf(challenger.address);
            await agent.checkAgentInfo(fullAgentCollateral.sub(res.redeemedCollateralWei), crt.feeUBA, 0, 0);
            await challenger.confirmDefaultedRedemptionPayment(request, tx1Hash, agent);
            await agent.checkAgentInfo(fullAgentCollateral.sub(res.redeemedCollateralWei).sub(toBN(context.settings.confirmationByOthersRewardNATWei)), crt.feeUBA.add(request.feeUBA), 0, 0);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            const endBalance = await context.wnat.balanceOf(challenger.address);
            // test rewarding
            assertWeb3Equal(endBalance.sub(startBalance), context.settings.confirmationByOthersRewardNATWei);
            // check that calling finishRedemptionWithoutPayment after confirming redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res.redeemedCollateralWei).sub(toBN(context.settings.confirmationByOthersRewardNATWei)));
        });
        
        it("mint and redeem f-assets - pause, terminate, buybackAgentCollateral", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter1 = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const minter2 = await Minter.createTest(context, minterAddress2, underlyingMinter2, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots1 = 3;
            const crt1 = await minter1.reserveCollateral(agent.vaultAddress, lots1);
            const tx1Hash = await minter1.performMintingPayment(crt1);
            const minted1 = await agent.executeMinting(crt1, tx1Hash);
            assertWeb3Equal(minted1.mintedAmountUBA, await context.convertLotsToUBA(lots1));
            const lots2 = 6;
            const crt2 = await minter2.reserveCollateral(agent.vaultAddress, lots2);
            const tx2Hash = await minter2.performMintingPayment(crt2);
            // pause asset manager
            await context.assetManagerController.pause([context.assetManager.address], {from: governance});
            assert.isTrue(await context.assetManager.paused());
            // existing minting can be executed, new minting is not possible
            const minted2 = await agent.executeMinting(crt2, tx2Hash, minter2);
            await expectRevert(minter1.reserveCollateral(agent.vaultAddress, lots1), "minting paused");
            await expectRevert(agent.selfMint(await context.convertLotsToUBA(lots1), lots1), "minting paused");
            // agent and redeemer "buys" f-assets
            await context.fAsset.transfer(agent.ownerAddress, minted1.mintedAmountUBA, { from: minter1.address });
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
            await agent.checkAgentInfo(fullAgentCollateral, crt1.feeUBA.add(crt2.feeUBA).add(request.feeUBA).add(selfClosedUBA), minted2.mintedAmountUBA.sub(request.valueUBA), minted2.mintedAmountUBA.sub(request.valueUBA));
            // stop FAsset
            await expectRevert(agent.buybackAgentCollateral(), "f-asset not terminated");
            await expectRevert(context.assetManagerController.terminate([context.assetManager.address], {from: governance}), "asset manager not paused enough");
            await time.increase(30 * DAYS);
            await (context.chain as MockChain).skipTime(30 * DAYS);
            const [redemptionRequests2, remainingLots2, dustChanges2] = await redeemer.requestRedemption(1);
            assertWeb3Equal(remainingLots2, 0);
            assert.equal(dustChanges2.length, 0);
            assert.equal(redemptionRequests2.length, 1);
            await context.assetManagerController.terminate([context.assetManager.address], {from: governance});
            // check that new redemption is not possible anymore, but started one can finish
            await expectRevert(redeemer.requestRedemption(lots2 / 3), "f-asset terminated");
            const request2 = redemptionRequests2[0];
            assert.equal(request2.agentVault, agent.vaultAddress);
            const tx3Hash = await agent.performRedemptionPayment(request2);
            await agent.confirmActiveRedemptionPayment(request2, tx3Hash);
            await agent.checkAgentInfo(fullAgentCollateral, crt1.feeUBA.add(crt2.feeUBA).add(request.feeUBA).add(selfClosedUBA).add(request2.feeUBA), minted2.mintedAmountUBA.sub(request.valueUBA).sub(request2.valueUBA), minted2.mintedAmountUBA.sub(request.valueUBA).sub(request2.valueUBA));
            // buybackAgentCollateral
            const burnAddress = (await context.assetManager.getSettings()).burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const startBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            await agent.buybackAgentCollateral();
            const endBalanceAgent = await context.wnat.balanceOf(agent.agentVault.address);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const buybackAgentCollateralValue = await agent.getBuybackAgentCollateralValue(minted2.mintedAmountUBA.divn(3));
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), buybackAgentCollateralValue);
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), buybackAgentCollateralValue);
            await agent.checkAgentInfo(fullAgentCollateral.sub(buybackAgentCollateralValue), crt1.feeUBA.add(crt2.feeUBA).add(request.feeUBA).add(selfClosedUBA).add(request2.feeUBA), 0, 0);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(buybackAgentCollateralValue));
        });

        it("collateral withdrawal", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA);
            // should not withdraw all but only free collateral
            await expectRevert(agent.announceCollateralWithdrawal(fullAgentCollateral), "withdrawal: value too high");
            const agentMinCollateralRatioBIPS = (await context.assetManager.getAgentInfo(agent.agentVault.address)).agentMinCollateralRatioBIPS;
            const reservedCollateral = context.convertAmgToNATWei(
                    await context.convertLotsToAMG(lots),
                    await context.currentAmgToNATWeiPrice())
                .mul(toBN(agentMinCollateralRatioBIPS)).divn(10000);
            const withdrawalAmount = fullAgentCollateral.sub(reservedCollateral);
            await agent.announceCollateralWithdrawal(withdrawalAmount);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0, withdrawalAmount);
            await expectRevert(agent.withdrawCollateral(withdrawalAmount, accounts[1]), "withdrawal: not allowed yet");
            await time.increase(300);
            const startBalance = toBN(await web3.eth.getBalance(accounts[1]));
            await agent.withdrawCollateral(withdrawalAmount, accounts[1]);
            await agent.checkAgentInfo(reservedCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA);
            const endBalance = toBN(await web3.eth.getBalance(accounts[1]));
            assertWeb3Equal(endBalance.sub(startBalance), withdrawalAmount);
            await expectRevert(agent.announceCollateralWithdrawal(1), "withdrawal: value too high");
        });

        it("topup payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            await agent.checkAgentInfo(fullAgentCollateral, 0, 0, 0);
            // topup payment
            const amount = 100;
            const txHash = await agent.performTopupPayment(amount);
            await agent.confirmTopupPayment(txHash);
            await agent.checkAgentInfo(fullAgentCollateral, amount, 0, 0);
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
            await agent1.checkAgentInfo(fullAgentCollateral, amount, 0, 0);
            const tx2Hash = await agent2.performTopupPayment(amount);
            await agent2.confirmTopupPayment(tx2Hash);
            await agent2.checkAgentInfo(fullAgentCollateral, amount, 0, 0);
            // underlying withdrawal
            const underlyingWithdrawal1 = await agent1.announceUnderlyingWithdrawal();
            const info1 = await agent1.checkAgentInfo(fullAgentCollateral, amount, 0, 0);
            assertWeb3Equal(info1.announcedUnderlyingWithdrawalId, 1);
            const underlyingWithdrawal2 = await agent2.announceUnderlyingWithdrawal();
            const info2 = await agent2.checkAgentInfo(fullAgentCollateral, amount, 0, 0);
            assertWeb3Equal(info2.announcedUnderlyingWithdrawalId, 2);
            const tx3Hash = await agent1.performUnderlyingWithdrawal(underlyingWithdrawal1, amount);
            const res1 = await agent1.confirmUnderlyingWithdrawal(underlyingWithdrawal1, tx3Hash);
            await agent1.checkAgentInfo(fullAgentCollateral, 0, 0, 0);
            assertWeb3Equal(res1.spentUBA, amount);
            const tx4Hash = await agent2.performUnderlyingWithdrawal(underlyingWithdrawal2, amount);
            const res2 = await agent2.confirmUnderlyingWithdrawal(underlyingWithdrawal2, tx4Hash);
            await agent2.checkAgentInfo(fullAgentCollateral, 0, 0, 0);
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
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // topup payment
            const amount = 100;
            const txHash = await agent.performTopupPayment(amount);
            await agent.confirmTopupPayment(txHash);
            await agent.checkAgentInfo(fullAgentCollateral, amount, 0, 0);
            // underlying withdrawal
            const underlyingWithdrawal = await agent.announceUnderlyingWithdrawal();
            const tx1Hash = await agent.performUnderlyingWithdrawal(underlyingWithdrawal, amount);
            const info = await agent.checkAgentInfo(fullAgentCollateral, amount, 0, 0);
            assertWeb3Equal(info.announcedUnderlyingWithdrawalId, 1);
            // others cannot confirm underlying withdrawal immediatelly or challenge it as illegal payment
            await expectRevert(challenger.confirmUnderlyingWithdrawal(underlyingWithdrawal, tx1Hash, agent), "only agent vault owner");
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "matching ongoing announced pmt");
            // others can confirm underlying withdrawal after some time
            await time.increase(context.settings.confirmationByOthersAfterSeconds);
            const startBalance = await context.wnat.balanceOf(challenger.address);
            const res = await challenger.confirmUnderlyingWithdrawal(underlyingWithdrawal, tx1Hash, agent);
            await agent.checkAgentInfo(fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)), 0, 0, 0);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            assertWeb3Equal(res.spentUBA, amount);
            const endBalance = await context.wnat.balanceOf(challenger.address);
            // test rewarding
            assertWeb3Equal(endBalance.sub(startBalance), context.settings.confirmationByOthersRewardNATWei);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)));
        });

        it("illegal payment challenge", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const challenger = await Challenger.create(context, challengerAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // perform illegal payment
            const tx1Hash = await agent.performPayment("IllegalPayment1", 100);
            // challenge agent for illegal payment
            const startBalance = await context.wnat.balanceOf(challenger.address);
            const liquidationStarted = await challenger.illegalPaymentChallenge(agent, tx1Hash);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: already liquidating");
            await expectRevert(challenger.doublePaymentChallenge(agent, tx1Hash, tx1Hash), "chlg dbl: already liquidating");
            await expectRevert(challenger.freeBalanceNegativeChallenge(agent, [tx1Hash]), "mult chlg: already liquidating");
            const endBalance = await context.wnat.balanceOf(challenger.address);
            // test rewarding
            const reward = await challenger.getChallengerReward(minted.mintedAmountUBA);
            assertWeb3Equal(endBalance.sub(startBalance), reward);
            // test full liquidation started
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(reward), crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0, 0, 3);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationStarted.timestamp);
            assert.equal(liquidationStarted.agentVault, agent.agentVault.address);
            // check that agent cannot exit
            await expectRevert(agent.exitAndDestroy(fullAgentCollateral.sub(reward)), "agent still active");
        });

        it("double payment challenge", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const challenger = await Challenger.create(context, challengerAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // perform double payment
            const tx1Hash = await agent.performPayment(underlyingRedeemer1, 100, PaymentReference.redemption(5));
            const tx2Hash = await agent.performPayment(underlyingRedeemer1, 100, PaymentReference.redemption(5));
            const tx3Hash = await agent.performPayment(underlyingRedeemer1, 100, PaymentReference.redemption(6));
            // check that we cannot use the same transaction multiple times or transactions with different payment references
            await expectRevert(challenger.doublePaymentChallenge(agent, tx1Hash, tx1Hash), "chlg dbl: same transaction");
            await expectRevert(challenger.doublePaymentChallenge(agent, tx1Hash, tx3Hash), "challenge: not duplicate");
            // challenge agent for double payment
            const startBalance = await context.wnat.balanceOf(challenger.address);
            const liquidationStarted = await challenger.doublePaymentChallenge(agent, tx1Hash, tx2Hash);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: already liquidating");
            await expectRevert(challenger.doublePaymentChallenge(agent, tx1Hash, tx2Hash), "chlg dbl: already liquidating");
            await expectRevert(challenger.freeBalanceNegativeChallenge(agent, [tx1Hash]), "mult chlg: already liquidating");
            const endBalance = await context.wnat.balanceOf(challenger.address);
            // test rewarding
            const reward = await challenger.getChallengerReward(minted.mintedAmountUBA);
            assertWeb3Equal(endBalance.sub(startBalance), reward);
            // test full liquidation started
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(reward), crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0, 0, 3);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationStarted.timestamp);
            assert.equal(liquidationStarted.agentVault, agent.agentVault.address);
            // check that agent cannot exit
            await expectRevert(agent.exitAndDestroy(fullAgentCollateral.sub(reward)), "agent still active");
        });

        it("free balance negative challenge", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const challenger = await Challenger.create(context, challengerAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // perform some payments
            const tx1Hash = await agent.performPayment(underlyingRedeemer1, await context.convertLotsToUBA(lots));
            // check that we cannot use the same transaction multiple times
            await expectRevert(challenger.freeBalanceNegativeChallenge(agent, [tx1Hash, tx1Hash]), "mult chlg: repeated transaction");
            // challenge agent for negative underlying balance
            const startBalance = await context.wnat.balanceOf(challenger.address);
            const liquidationStarted = await challenger.freeBalanceNegativeChallenge(agent, [tx1Hash]);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: already liquidating");
            await expectRevert(challenger.doublePaymentChallenge(agent, tx1Hash, tx1Hash), "chlg dbl: already liquidating");
            await expectRevert(challenger.freeBalanceNegativeChallenge(agent, [tx1Hash]), "mult chlg: already liquidating");
            const endBalance = await context.wnat.balanceOf(challenger.address);
            // test rewarding
            const reward = await challenger.getChallengerReward(minted.mintedAmountUBA);
            assertWeb3Equal(endBalance.sub(startBalance), reward);
            // test full liquidation started
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(reward), crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0, 0, 3);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationStarted.timestamp);
            assert.equal(liquidationStarted.agentVault, agent.agentVault.address);
            // check that agent cannot exit
            await expectRevert(agent.exitAndDestroy(fullAgentCollateral.sub(reward)), "agent still active");
        });

        it("full liquidation", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const challenger = await Challenger.create(context, challengerAddress1);
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // perform illegal payment
            const tx1Hash = await agent.performPayment("IllegalPayment1", 100);
            // challenge agent for illegal payment
            const startBalance = await context.wnat.balanceOf(challenger.address);
            const liquidationStarted = await challenger.illegalPaymentChallenge(agent, tx1Hash);
            const endBalance = await context.wnat.balanceOf(challenger.address);
            // test rewarding
            const challengerReward = await challenger.getChallengerReward(minted.mintedAmountUBA);
            assertWeb3Equal(endBalance.sub(startBalance), challengerReward);
            // test full liquidation started
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(challengerReward), crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0, 0, 3);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationStarted.timestamp);
            assert.equal(liquidationStarted.agentVault, agent.agentVault.address);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1 = await context.wnat.balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator1 = await context.wnat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA);
            assert.isUndefined(liquidationStarted1);
            assert.isUndefined(liquidationCancelled1);
            // full liquidation cannot be stopped
            await expectRevert(agent.endLiquidation(), "cannot stop liquidation");
            await expectRevert(liquidator.endLiquidation(agent), "cannot stop liquidation");
            // test rewarding
            const collateralRatioBIPS1 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(challengerReward), minted.mintedAmountUBA);
            const liquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS1, liquidationStarted.timestamp, liquidationTimestamp1);
            const liquidationReward1 = await liquidator.getLiquidationReward(liquidatedUBA1, liquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1.sub(startBalanceLiquidator1), liquidationReward1);
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.sub(challengerReward).sub(liquidationReward1), crt.feeUBA.add(liquidateMaxUBA), crt.valueUBA.sub(liquidateMaxUBA), minted.mintedAmountUBA.sub(liquidateMaxUBA), 0, 0, 0, 3);
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, liquidationStarted.timestamp);
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (second part)
            const startBalanceLiquidator2 = await context.wnat.balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator2 = await context.wnat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA2, liquidateMaxUBA);
            assert.isUndefined(liquidationStarted2);
            assert.isUndefined(liquidationCancelled2);
            // full liquidation cannot be stopped
            await expectRevert(agent.endLiquidation(), "cannot stop liquidation");
            await expectRevert(liquidator.endLiquidation(agent), "cannot stop liquidation");
            // test rewarding
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(challengerReward).sub(liquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const liquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS2, liquidationStarted.timestamp, liquidationTimestamp2);
            const liquidationReward2 = await liquidator.getLiquidationReward(liquidatedUBA2, liquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2.sub(startBalanceLiquidator2), liquidationReward2);
            const info3 = await agent.checkAgentInfo(fullAgentCollateral.sub(challengerReward).sub(liquidationReward1).sub(liquidationReward2), crt.feeUBA.add(liquidateMaxUBA.muln(2)), crt.valueUBA.sub(liquidateMaxUBA.muln(2)), minted.mintedAmountUBA.sub(liquidateMaxUBA.muln(2)), 0, 0, 0, 3);
            assertWeb3Equal(info3.ccbStartTimestamp, 0);
            assertWeb3Equal(info3.liquidationStartTimestamp, liquidationStarted.timestamp);
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (last part)
            const startBalanceLiquidator3 = await context.wnat.balanceOf(liquidator.address);
            const [liquidatedUBA3, liquidationTimestamp3, liquidationStarted3, liquidationCancelled3] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator3 = await context.wnat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA3, liquidateMaxUBA);
            assert.isUndefined(liquidationStarted3);
            assert.isUndefined(liquidationCancelled3);
            // full liquidation cannot be stopped
            await expectRevert(agent.endLiquidation(), "cannot stop liquidation");
            await expectRevert(liquidator.endLiquidation(agent), "cannot stop liquidation");
            // test rewarding
            const collateralRatioBIPS3 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(challengerReward).sub(liquidationReward1).sub(liquidationReward2), minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2));
            const liquidationFactorBIPS3 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS3, liquidationStarted.timestamp, liquidationTimestamp3);
            const liquidationReward3 = await liquidator.getLiquidationReward(liquidatedUBA3, liquidationFactorBIPS3);
            assertWeb3Equal(endBalanceLiquidator3.sub(startBalanceLiquidator3), liquidationReward3);
            const info4 = await agent.checkAgentInfo(fullAgentCollateral.sub(challengerReward).sub(liquidationReward1).sub(liquidationReward2).sub(liquidationReward3), crt.feeUBA.add(liquidateMaxUBA.muln(3)), crt.valueUBA.sub(liquidateMaxUBA.muln(3)), minted.mintedAmountUBA.sub(liquidateMaxUBA.muln(3)), 0, 0, 0, 3);
            assertWeb3Equal(info4.ccbStartTimestamp, 0);
            assertWeb3Equal(info4.liquidationStartTimestamp, liquidationStarted.timestamp);
            // final tests
            assertWeb3Equal(liquidatedUBA1, liquidatedUBA2);
            assertWeb3Equal(liquidatedUBA1, liquidatedUBA3);
            assert(liquidationFactorBIPS1.lt(liquidationFactorBIPS2));
            assert(liquidationFactorBIPS2.lt(liquidationFactorBIPS3));
            assert(liquidationReward1.lt(liquidationReward2));
            assert(liquidationReward2.lt(liquidationReward3));
            // full liquidation cannot be stopped
            await expectRevert(agent.endLiquidation(), "cannot stop liquidation");
            await expectRevert(liquidator.endLiquidation(agent), "cannot stop liquidation");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(challengerReward).sub(liquidationReward1).sub(liquidationReward2).sub(liquidationReward3));
        });

        it("ccb due to price change (no liquidation due to collateral deposit)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // price change
            await context.natFtso.setCurrentPrice(6, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // start ccb
            const [ccb, ccbStartTimestamp] = await liquidator.startLiquidation(agent);
            assert.isTrue(ccb);
            const info = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0, 0, 1);
            assertWeb3Equal(info.ccbStartTimestamp, ccbStartTimestamp);
            const ccbTimeSeconds = (await context.assetManager.getSettings()).ccbTimeSeconds;
            assertWeb3Equal(info.liquidationStartTimestamp, toBN(ccbStartTimestamp).add(toBN(ccbTimeSeconds)));
            // deposit collateral
            const additionalCollateral = toWei(5e7);
            const liquidationCancelled = await agent.depositCollateral(additionalCollateral);
            // test that ccb cancelled due to collateral deposit
            assert.equal(liquidationCancelled!.agentVault, agent.agentVault.address);
            const collateralRatioBIPS = await agent.getCollateralRatioBIPS(fullAgentCollateral.add(additionalCollateral), minted.mintedAmountUBA);
            assert(collateralRatioBIPS.gte(toBN((await context.assetManager.getSettings()).minCollateralRatioBIPS)));
            assert(collateralRatioBIPS.lt(toBN((await context.assetManager.getSettings()).safetyMinCollateralRatioBIPS)));
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.add(additionalCollateral), crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0, 0, 0);
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerAddress, minted.mintedAmountUBA, { from: minter.address });
            await agent.selfClose(minted.mintedAmountUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.add(additionalCollateral));
        });

        it("ccb due to price change (no liquidation due to partial self close)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0);
            // price change
            await context.natFtso.setCurrentPrice(6, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // start ccb
            const [ccb, ccbStartTimestamp] = await liquidator.startLiquidation(agent);
            assert.isTrue(ccb);
            const info = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0, 0, 1);
            assertWeb3Equal(info.ccbStartTimestamp, ccbStartTimestamp);
            const ccbTimeSeconds = (await context.assetManager.getSettings()).ccbTimeSeconds;
            assertWeb3Equal(info.liquidationStartTimestamp, toBN(ccbStartTimestamp).add(toBN(ccbTimeSeconds)));
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerAddress, minted.mintedAmountUBA, { from: minter.address });
            // perform partial self close
            const selfCloseAmountUBA = context.convertAmgToUBA(1e10);
            const [, selfClosedValueUBA, liquidationCancelledEvent] = await agent.selfClose(selfCloseAmountUBA);
            // test that ccb cancelled due to self close
            assert.equal(liquidationCancelledEvent.agentVault, agent.agentVault.address);
            const collateralRatioBIPS = await agent.getCollateralRatioBIPS(fullAgentCollateral, minted.mintedAmountUBA.sub(selfClosedValueUBA));
            assert(collateralRatioBIPS.gte(toBN((await context.assetManager.getSettings()).minCollateralRatioBIPS)));
            assert(collateralRatioBIPS.lt(toBN((await context.assetManager.getSettings()).safetyMinCollateralRatioBIPS)));
            const info2 = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(selfClosedValueUBA), crt.valueUBA.sub(selfClosedValueUBA), minted.mintedAmountUBA.sub(selfClosedValueUBA), 0, 0, 0, 0);
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // agent "buys" f-assets
            await agent.selfClose(minted.mintedAmountUBA.sub(selfClosedValueUBA));
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("liquidation due to price change (agent can be safe again)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0);
            // price change
            await context.natFtso.setCurrentPrice(11, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1 = await context.wnat.balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1 = await context.wnat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const collateralRatioBIPS1 = await agent.getCollateralRatioBIPS(fullAgentCollateral, minted.mintedAmountUBA);
            const liquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const liquidationReward1 = await liquidator.getLiquidationReward(liquidatedUBA1, liquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1.sub(startBalanceLiquidator1), liquidationReward1);
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // liquidation cannot be stopped if agent not safe
            await expectRevert(agent.endLiquidation(), "cannot stop liquidation");
            await expectRevert(liquidator.endLiquidation(agent), "cannot stop liquidation");
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (second part)
            const liquidateMaxUBA2 = minted.mintedAmountUBA.sub(liquidatedUBA1);
            const startBalanceLiquidator2 = await context.wnat.balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA2);
            const endBalanceLiquidator2 = await context.wnat.balanceOf(liquidator.address);
            assert(liquidatedUBA2.lt(liquidateMaxUBA2)); // agent is safe again
            assertWeb3Equal(await context.convertLotsToUBA(await context.convertUBAToLots(liquidatedUBA2)), liquidatedUBA2);
            assert.isUndefined(liquidationStarted2);
            assert.equal(liquidationCancelled2.agentVault, agent.agentVault.address);
            // test rewarding
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const liquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const liquidationReward2 = await liquidator.getLiquidationReward(liquidatedUBA2, liquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2.sub(startBalanceLiquidator2), liquidationReward2);
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2), crt.feeUBA.add(liquidatedUBA1).add(liquidatedUBA2), crt.valueUBA.sub(liquidatedUBA1).sub(liquidatedUBA2), minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2));
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // final tests
            assert(liquidationFactorBIPS1.lt(liquidationFactorBIPS2));
            const collateralRatioBIPS3 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2), minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2));
            assert(collateralRatioBIPS3.gte(toBN((await context.assetManager.getSettings()).safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2);
            await context.fAsset.transfer(agent.ownerAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2));
        });
        
        it("liquidation due to price change (agent cannot be safe again)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0);
            // price change
            await context.natFtso.setCurrentPrice(1, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1 = await context.wnat.balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator1 = await context.wnat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const collateralRatioBIPS1 = await agent.getCollateralRatioBIPS(fullAgentCollateral, minted.mintedAmountUBA);
            const liquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const liquidationReward1 = await liquidator.getLiquidationReward(liquidatedUBA1, liquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1.sub(startBalanceLiquidator1), liquidationReward1);
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (second part)
            const startBalanceLiquidator2 = await context.wnat.balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator2 = await context.wnat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA2, liquidateMaxUBA);
            assert.isUndefined(liquidationStarted2);
            assert.isUndefined(liquidationCancelled2);
            // test rewarding
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const liquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const liquidationReward2 = await liquidator.getLiquidationReward(liquidatedUBA2, liquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2.sub(startBalanceLiquidator2), liquidationReward2);
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2), crt.feeUBA.add(liquidatedUBA1).add(liquidatedUBA2), crt.valueUBA.sub(liquidatedUBA1).sub(liquidatedUBA2), minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2), 0, 0, 0, 2);
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, liquidationTimestamp1);
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (last part)
            const startBalanceLiquidator3 = await context.wnat.balanceOf(liquidator.address);
            const [liquidatedUBA3, liquidationTimestamp3, liquidationStarted3, liquidationCancelled3] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator3 = await context.wnat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA3, liquidateMaxUBA);
            assert.isUndefined(liquidationStarted3);
            assert.equal(liquidationCancelled3.agentVault, agent.agentVault.address);
            // test rewarding
            const collateralRatioBIPS3 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2), minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2));
            const liquidationFactorBIPS3 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS3, liquidationTimestamp1, liquidationTimestamp3);
            const liquidationReward3 = await liquidator.getLiquidationReward(liquidatedUBA3, liquidationFactorBIPS3);
            assertWeb3Equal(endBalanceLiquidator3.sub(startBalanceLiquidator3), liquidationReward3);
            const info3 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2).sub(liquidationReward3), crt.feeUBA.add(crt.valueUBA), 0, 0);
            assertWeb3Equal(info3.ccbStartTimestamp, 0);
            assertWeb3Equal(info3.liquidationStartTimestamp, 0);
            // final tests
            assertWeb3Equal(liquidatedUBA1, liquidatedUBA2);
            assertWeb3Equal(liquidatedUBA2, liquidatedUBA3);
            assert(liquidationFactorBIPS1.lte(liquidationFactorBIPS2));
            assert(liquidationFactorBIPS2.lte(liquidationFactorBIPS3));
            assert(liquidationReward1.lte(liquidationReward2));
            assert(liquidationReward2.lte(liquidationReward3));
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2).sub(liquidationReward3));
        });

        it("liquidation due to price change (agent can end liquidation after new price change)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0);
            // price change
            await context.natFtso.setCurrentPrice(11, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1 = await context.wnat.balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1 = await context.wnat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const collateralRatioBIPS1 = await agent.getCollateralRatioBIPS(fullAgentCollateral, minted.mintedAmountUBA);
            const liquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const liquidationReward1 = await liquidator.getLiquidationReward(liquidatedUBA1, liquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1.sub(startBalanceLiquidator1), liquidationReward1);
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // price change after some time
            await time.increase(90);
            await context.natFtso.setCurrentPrice(100, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
            // agent still in liquidation status
            const info1 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info1.ccbStartTimestamp, 0);
            assertWeb3Equal(info1.liquidationStartTimestamp, liquidationTimestamp1);
            // agent can end liquidation
            await agent.endLiquidation();
            // final tests
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            assert(collateralRatioBIPS2.gte(toBN((await context.assetManager.getSettings()).safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1);
            await context.fAsset.transfer(agent.ownerAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(liquidationReward1));
        });
        
        it("liquidation due to price change (others can end liquidation after new price change)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0);
            // price change
            await context.natFtso.setCurrentPrice(11, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1 = await context.wnat.balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1 = await context.wnat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const collateralRatioBIPS1 = await agent.getCollateralRatioBIPS(fullAgentCollateral, minted.mintedAmountUBA);
            const liquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const liquidationReward1 = await liquidator.getLiquidationReward(liquidatedUBA1, liquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1.sub(startBalanceLiquidator1), liquidationReward1);
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // price change after some time
            await time.increase(90);
            await context.natFtso.setCurrentPrice(100, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
            // agent still in liquidation status
            const info1 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info1.ccbStartTimestamp, 0);
            assertWeb3Equal(info1.liquidationStartTimestamp, liquidationTimestamp1);
            // others can end liquidation
            await liquidator.endLiquidation(agent);
            // final tests
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            assert(collateralRatioBIPS2.gte(toBN((await context.assetManager.getSettings()).safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1);
            await context.fAsset.transfer(agent.ownerAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(liquidationReward1));
        });

        it("liquidation due to price change (cannot liquidate anything after new price change if agent is safe again)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0);
            // price change
            await context.natFtso.setCurrentPrice(11, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1 = await context.wnat.balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1 = await context.wnat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const collateralRatioBIPS1 = await agent.getCollateralRatioBIPS(fullAgentCollateral, minted.mintedAmountUBA);
            const liquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const liquidationReward1 = await liquidator.getLiquidationReward(liquidatedUBA1, liquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1.sub(startBalanceLiquidator1), liquidationReward1);
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // price change after some time
            await time.increase(90);
            await context.natFtso.setCurrentPrice(100, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
            // wait some time to get next premium
            await time.increase(90);
            // agent still in liquidation status
            const info1 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info1.ccbStartTimestamp, 0);
            assertWeb3Equal(info1.liquidationStartTimestamp, liquidationTimestamp1);
            // liquidate agent (second part) - cannot liquidate anything as agent is safe again due to price change
            const liquidateMaxUBA2 = minted.mintedAmountUBA.sub(liquidatedUBA1);
            const startBalanceLiquidator2 = await context.wnat.balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA2);
            const endBalanceLiquidator2 = await context.wnat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA2, 0);
            assert.isUndefined(liquidationStarted2);
            assert.equal(liquidationCancelled2.agentVault, agent.agentVault.address);
            // test rewarding
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const liquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const liquidationReward2 = await liquidator.getLiquidationReward(liquidatedUBA2, liquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2.sub(startBalanceLiquidator2), liquidationReward2);
            assertWeb3Equal(liquidationReward2, 0);
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // final tests
            assert(liquidationFactorBIPS1.lt(liquidationFactorBIPS2));
            const collateralRatioBIPS3 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2), minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2));
            assert(collateralRatioBIPS3.gte(toBN((await context.assetManager.getSettings()).safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2);
            await context.fAsset.transfer(agent.ownerAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2));
        });
    });
});
