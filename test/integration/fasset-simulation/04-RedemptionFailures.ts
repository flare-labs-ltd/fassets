import { expectRevert, time } from "@openzeppelin/test-helpers";
import { TX_BLOCKED, TX_FAILED } from "../../../lib/underlying-chain/interfaces/IBlockChain";
import { findRequiredEvent, requiredEventArgs } from "../../../lib/utils/events/truffle";
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
        commonContext = await CommonContext.createTest(governance, testNatInfo);
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
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
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
            const tx1Hash = await agent.performRedemptionPayment(request, { status: TX_BLOCKED });
            await agent.confirmBlockedRedemptionPayment(request, tx1Hash);
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(request.valueUBA), 0, 0);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
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
            const tx1Hash = await agent.performRedemptionPayment(request, { status: TX_FAILED, gasLimit: 10, gasPrice: 10 });
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

        it("redemption - wrong underlying payment", async () => {
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

        it("redemption - no underlying payment (default not needed after a day)", async () => {
            mockStateConnectorClient.queryWindowSeconds = 300;
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
            for (let i = 0; i <= mockStateConnectorClient.queryWindowSeconds / mockChain.secondsPerBlock + 1; i++) {
                mockChain.mine();
            }
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

        it("redemption - too late underlying payment", async () => {
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
    });
});
