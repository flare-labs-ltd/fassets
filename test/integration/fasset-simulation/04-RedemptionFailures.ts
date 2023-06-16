import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { TX_BLOCKED, TX_FAILED } from "../../../lib/underlying-chain/interfaces/IBlockChain";
import { eventArgs, findRequiredEvent, requiredEventArgs } from "../../../lib/utils/events/truffle";
import { DAYS, toBN, toWei } from "../../../lib/utils/helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo, testNatInfo } from "../utils/TestChainInfo";

contract(`AssetManager.sol; ${getTestFile(__filename)}; Asset manager simulations`, async accounts => {
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
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
        mockChain = context.chain as MockChain;
        mockStateConnectorClient = context.stateConnectorClient as MockStateConnectorClient;
    });

    describe("simple scenarios - redemption failures", () => {
        it("mint and redeem f-assets - payment blocked", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // mine a block to skip the agent creation time
            mockChain.mine();
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
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: 0, mintedUBA: 0, reservedUBA: lotsUBA });
            const burnAddress = (await context.assetManager.getSettings()).burnAddress;
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            const minted = await minter.executeMinting(crt, txHash);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            assertWeb3Equal(minted.mintedAmountUBA, lotsUBA);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA, mintedUBA: lotsUBA.add(minted.poolFeeUBA), reservedUBA: 0 });
            // check that fee was burned
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee);
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA, mintedUBA: minted.poolFeeUBA, reservedUBA: 0, redeemingUBA: lotsUBA });
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            const tx1Hash = await agent.performRedemptionPayment(request, { status: TX_BLOCKED });
            await agent.confirmBlockedRedemptionPayment(request, tx1Hash);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(request.valueUBA), mintedUBA: minted.poolFeeUBA, redeemingUBA: 0 });
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint and redeem defaults (agent) - no underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
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
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.poolFeeUBA, reservedUBA: 0, redeemingUBA: request.valueUBA });
            // test rewarding for redemption payment default
            const class1Token = agent.class1Token();
            const startClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const startClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const startPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const startPoolBalanceAgent = await agent.poolCollateralBalance();
            const res = await agent.redemptionPaymentDefault(request);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral.sub(res.redeemedClass1CollateralWei),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(request.valueUBA), mintedUBA: minted.poolFeeUBA, redeemingUBA: 0 });
            const redDef = await agent.finishRedemptionWithoutPayment(request);
            assert.isUndefined(redDef);
            const endClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const endClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const endPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const endPoolBalanceAgent = await agent.poolCollateralBalance();
            const [redemptionDefaultValueClass1, redemptionDefaultValuePool] = await agent.getRedemptionPaymentDefaultValue(lots);
            assertWeb3Equal(res.redeemedClass1CollateralWei, redemptionDefaultValueClass1);
            assertWeb3Equal(res.redeemedPoolCollateralWei, redemptionDefaultValuePool);
            assertWeb3Equal(endClass1BalanceRedeemer.sub(startClass1BalanceRedeemer), res.redeemedClass1CollateralWei);
            assertWeb3Equal(startClass1BalanceAgent.sub(endClass1BalanceAgent), res.redeemedClass1CollateralWei);
            assertWeb3Equal(endPoolBalanceRedeemer.sub(startPoolBalanceRedeemer), res.redeemedPoolCollateralWei);
            assertWeb3Equal(startPoolBalanceAgent.sub(endPoolBalanceAgent), res.redeemedPoolCollateralWei);
            // check that confirming redemption payment after calling finishRedemptionWithoutPayment will revert
            const tx1Hash = await agent.performRedemptionPayment(request);
            await expectRevert(agent.confirmDefaultedRedemptionPayment(request, tx1Hash), "invalid request id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res.redeemedClass1CollateralWei));
        });

        it("mint and redeem defaults (redeemer) - failed underlying payment (failed transaction)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
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
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA, mintedUBA: minted.poolFeeUBA, reservedUBA: 0, redeemingUBA: request.valueUBA });
            // perform some (failed) payment with correct redemption reference
            const tx1Hash = await agent.performRedemptionPayment(request, { status: TX_FAILED, gasLimit: 10, gasPrice: 10 });
            const class1Token = agent.class1Token();
            const startClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const startClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const startPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const startPoolBalanceAgent = await agent.poolCollateralBalance();
            const res = await agent.confirmFailedRedemptionPayment(request, tx1Hash);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling finishRedemptionWithoutPayment after failed redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // test rewarding for redemption payment default
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral.sub(res[1].redeemedClass1CollateralWei),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(request.valueUBA).subn(100), mintedUBA: minted.poolFeeUBA, redeemingUBA: 0 });
            const endClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const endClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const endPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const endPoolBalanceAgent = await agent.poolCollateralBalance();
            //
            const [redemptionDefaultValueClass1, redemptionDefaultValuePool] = await agent.getRedemptionPaymentDefaultValue(lots);
            assertWeb3Equal(res[0].failureReason, "transaction failed");
            assertWeb3Equal(res[1].redeemedClass1CollateralWei, redemptionDefaultValueClass1);
            assertWeb3Equal(endClass1BalanceRedeemer.sub(startClass1BalanceRedeemer), res[1].redeemedClass1CollateralWei);
            assertWeb3Equal(startClass1BalanceAgent.sub(endClass1BalanceAgent), res[1].redeemedClass1CollateralWei);
            assertWeb3Equal(endPoolBalanceRedeemer.sub(startPoolBalanceRedeemer), res[1].redeemedPoolCollateralWei);
            assertWeb3Equal(startPoolBalanceAgent.sub(endPoolBalanceAgent), res[1].redeemedPoolCollateralWei);
            assertWeb3Equal(res[1].redeemedPoolCollateralWei, redemptionDefaultValuePool);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res[1].redeemedClass1CollateralWei));
        });

        it("mint and redeem defaults (redeemer) - failed underlying payment (not redeemer's address)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
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
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA, mintedUBA: minted.poolFeeUBA, reservedUBA: 0, redeemingUBA: request.valueUBA });
            // perform some (failed) payment with correct redemption reference
            const tx1Hash = await agent.performPayment(minter.underlyingAddress, request.valueUBA, request.paymentReference);
            const proof = await context.attestationProvider.provePayment(tx1Hash, agent.underlyingAddress, minter.underlyingAddress);
            const class1Token = agent.class1Token();
            const startClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const startClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const startPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const startPoolBalanceAgent = await agent.poolCollateralBalance();
            const res = await context.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: agent.ownerHotAddress })
            const resFailed = requiredEventArgs(res, 'RedemptionPaymentFailed');
            const resDefault = requiredEventArgs(res, 'RedemptionDefault');
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling finishRedemptionWithoutPayment after failed redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // test rewarding for redemption payment default
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral.sub(resDefault.redeemedClass1CollateralWei),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA, mintedUBA: minted.poolFeeUBA, redeemingUBA: 0 });
            const endClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const endClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const endPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const endPoolBalanceAgent = await agent.poolCollateralBalance();
            const [redemptionDefaultValueClass1, redemptionDefaultValuePool] = await agent.getRedemptionPaymentDefaultValue(lots);
            assertWeb3Equal(resFailed.failureReason, "not redeemer's address");
            assertWeb3Equal(resDefault.redeemedPoolCollateralWei, redemptionDefaultValuePool);
            assertWeb3Equal(resDefault.redeemedClass1CollateralWei, redemptionDefaultValueClass1);
            assertWeb3Equal(endClass1BalanceRedeemer.sub(startClass1BalanceRedeemer), resDefault.redeemedClass1CollateralWei);
            assertWeb3Equal(startClass1BalanceAgent.sub(endClass1BalanceAgent), resDefault.redeemedClass1CollateralWei);
            assertWeb3Equal(endPoolBalanceRedeemer.sub(startPoolBalanceRedeemer), resDefault.redeemedPoolCollateralWei);
            assertWeb3Equal(startPoolBalanceAgent.sub(endPoolBalanceAgent), resDefault.redeemedPoolCollateralWei);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(resDefault.redeemedClass1CollateralWei));
        });

        it("mint and redeem defaults (redeemer) - failed underlying payment (redemption payment too small)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
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
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.poolFeeUBA, reservedUBA: 0, redeemingUBA: request.valueUBA });
            // perform some (failed) payment with correct redemption reference
            const tx1Hash = await agent.performPayment(request.paymentAddress, 100, request.paymentReference);
            const class1Token = agent.class1Token();
            const startClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const startClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const startPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const startPoolBalanceAgent = await agent.poolCollateralBalance();
            const res = await agent.confirmFailedRedemptionPayment(request, tx1Hash);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling finishRedemptionWithoutPayment after failed redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // test rewarding for redemption payment default
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral.sub(res[1].redeemedClass1CollateralWei),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(request.valueUBA).subn(100), mintedUBA: minted.poolFeeUBA, redeemingUBA: 0 });
            const endClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const endClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const endPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const endPoolBalanceAgent = await agent.poolCollateralBalance();
            const [redemptionDefaultValueClass1, redemptionDefaultValuePool] = await agent.getRedemptionPaymentDefaultValue(lots);
            assertWeb3Equal(res[0].failureReason, "redemption payment too small");
            assertWeb3Equal(res[1].redeemedPoolCollateralWei, redemptionDefaultValuePool);
            assertWeb3Equal(res[1].redeemedClass1CollateralWei, redemptionDefaultValueClass1);
            assertWeb3Equal(endClass1BalanceRedeemer.sub(startClass1BalanceRedeemer), res[1].redeemedClass1CollateralWei);
            assertWeb3Equal(startClass1BalanceAgent.sub(endClass1BalanceAgent), res[1].redeemedClass1CollateralWei);
            assertWeb3Equal(endPoolBalanceRedeemer.sub(startPoolBalanceRedeemer), res[1].redeemedPoolCollateralWei);
            assertWeb3Equal(startPoolBalanceAgent.sub(endPoolBalanceAgent), res[1].redeemedPoolCollateralWei);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res[1].redeemedClass1CollateralWei));
        });

        it("redemption - wrong underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
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
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.poolFeeUBA, reservedUBA: 0, redeemingUBA: request.valueUBA });
            // perform some (failed) payment with correct redemption reference
            const tx1Hash = await agent.wallet.addTransaction(minter.underlyingAddress, request.paymentAddress, 1, request.paymentReference);
            const proof = await context.attestationProvider.provePayment(tx1Hash, minter.underlyingAddress, request.paymentAddress);
            await expectRevert(context.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: agent.ownerHotAddress }), "confirm failed payment only from agent's address");
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling finishRedemptionWithoutPayment after failed redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "should default first");
            // test rewarding for redemption payment default
            const class1Token = agent.class1Token();
            const startClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const startClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const startPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const startPoolBalanceAgent = await agent.poolCollateralBalance();
            const res = await redeemer.redemptionPaymentDefault(request);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral.sub(res.redeemedClass1CollateralWei),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(request.valueUBA), mintedUBA: minted.poolFeeUBA, redeemingUBA: 0 });
            const endClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const endClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const endPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const endPoolBalanceAgent = await agent.poolCollateralBalance();
            const [redemptionDefaultValueClass1, redemptionDefaultValuePool] = await agent.getRedemptionPaymentDefaultValue(lots);
            assertWeb3Equal(res.redeemedPoolCollateralWei, redemptionDefaultValuePool);
            assertWeb3Equal(res.redeemedClass1CollateralWei, redemptionDefaultValueClass1);
            assertWeb3Equal(endClass1BalanceRedeemer.sub(startClass1BalanceRedeemer), res.redeemedClass1CollateralWei);
            assertWeb3Equal(startClass1BalanceAgent.sub(endClass1BalanceAgent), res.redeemedClass1CollateralWei);
            assertWeb3Equal(endPoolBalanceRedeemer.sub(startPoolBalanceRedeemer), res.redeemedPoolCollateralWei);
            assertWeb3Equal(startPoolBalanceAgent.sub(endPoolBalanceAgent), res.redeemedPoolCollateralWei);
            const redDef = await agent.finishRedemptionWithoutPayment(request);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral.sub(res.redeemedClass1CollateralWei),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(crt.valueUBA), mintedUBA: minted.poolFeeUBA, redeemingUBA: 0 });
            assert.isUndefined(redDef);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res.redeemedClass1CollateralWei));
        });

        it("redemption - no underlying payment (default not needed after a day)", async () => {
            mockStateConnectorClient.queryWindowSeconds = 300;
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
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
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.poolFeeUBA, reservedUBA: 0, redeemingUBA: request.valueUBA });
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling finishRedemptionWithoutPayment after no redemption payment will revert if called too soon
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "should default first");
            await time.increase(DAYS);
            context.skipToProofUnavailability(request.lastUnderlyingBlock, request.lastUnderlyingTimestamp);
            // test rewarding for redemption payment default
            const class1Token = agent.class1Token();
            const startClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const startClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const startPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const startPoolBalanceAgent = await agent.poolCollateralBalance();
            const redDef = await agent.finishRedemptionWithoutPayment(request);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral.sub(redDef.redeemedClass1CollateralWei),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(request.valueUBA), mintedUBA: minted.poolFeeUBA, redeemingUBA: 0 });
            const endClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const endClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const endPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const endPoolBalanceAgent = await agent.poolCollateralBalance();
            assertWeb3Equal(redDef.requestId, request.requestId);
            const [redemptionDefaultValueClass1, redemptionDefaultValuePool] = await agent.getRedemptionPaymentDefaultValue(lots);
            assertWeb3Equal(redDef.redeemedPoolCollateralWei, redemptionDefaultValuePool);
            assertWeb3Equal(redDef.redeemedClass1CollateralWei, redemptionDefaultValueClass1);
            assertWeb3Equal(endClass1BalanceRedeemer.sub(startClass1BalanceRedeemer), redDef.redeemedClass1CollateralWei);
            assertWeb3Equal(startClass1BalanceAgent.sub(endClass1BalanceAgent), redDef.redeemedClass1CollateralWei);
            assertWeb3Equal(endPoolBalanceRedeemer.sub(startPoolBalanceRedeemer), redDef.redeemedPoolCollateralWei);
            assertWeb3Equal(startPoolBalanceAgent.sub(endPoolBalanceAgent), redDef.redeemedPoolCollateralWei);
            // check that confirming redemption payment after calling finishRedemptionWithoutPayment will revert
            const tx1Hash = await agent.performRedemptionPayment(request);
            await expectRevert(agent.confirmDefaultedRedemptionPayment(request, tx1Hash), "invalid request id");
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(redDef.redeemedClass1CollateralWei));
        });

        it("redemption - too late underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
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
            const class1Token = agent.class1Token();
            const startClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const startClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const startPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const startPoolBalanceAgent = await agent.poolCollateralBalance();
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA, mintedUBA: minted.poolFeeUBA, reservedUBA: 0, redeemingUBA: request.valueUBA });
            const res = await redeemer.redemptionPaymentDefault(request);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral.sub(res.redeemedClass1CollateralWei), freeUnderlyingBalanceUBA: request.valueUBA.add(minted.agentFeeUBA), mintedUBA: minted.poolFeeUBA, redeemingUBA: 0 });
            const endClass1BalanceRedeemer = await class1Token.balanceOf(redeemer.address);
            const endClass1BalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const endPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const endPoolBalanceAgent = await agent.poolCollateralBalance();
            const [redemptionDefaultValueClass1, redemptionDefaultValuePool] = await agent.getRedemptionPaymentDefaultValue(lots);
            assertWeb3Equal(res.redeemedPoolCollateralWei, redemptionDefaultValuePool);
            assertWeb3Equal(res.redeemedClass1CollateralWei, redemptionDefaultValueClass1);
            assertWeb3Equal(endClass1BalanceRedeemer.sub(startClass1BalanceRedeemer), res.redeemedClass1CollateralWei);
            assertWeb3Equal(startClass1BalanceAgent.sub(endClass1BalanceAgent), res.redeemedClass1CollateralWei);
            assertWeb3Equal(endPoolBalanceRedeemer.sub(startPoolBalanceRedeemer), res.redeemedPoolCollateralWei);
            assertWeb3Equal(startPoolBalanceAgent.sub(endPoolBalanceAgent), res.redeemedPoolCollateralWei);
            // perform too late redemption payment
            const tx1Hash = await agent.performRedemptionPayment(request);
            const tx = await agent.confirmDefaultedRedemptionPayment(request, tx1Hash);
            assert.equal(eventArgs(tx, "RedemptionPaymentFailed").failureReason, "redemption payment too late");
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral.sub(res.redeemedClass1CollateralWei),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(request.feeUBA), mintedUBA: minted.poolFeeUBA, redeemingUBA: 0 });
            // check that calling finishRedemptionWithoutPayment after confirming redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res.redeemedClass1CollateralWei));
        });
    });
});
