import { expectRevert, time } from "@openzeppelin/test-helpers";
import { TX_BLOCKED, TX_FAILED } from "../../../lib/underlying-chain/interfaces/IBlockChain";
import { toBN, toWei } from "../../../lib/utils/helpers";
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

    describe("", () => {
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
            const startBalance = await context.wNat.balanceOf(challenger.address);
            await agent.checkAgentInfoOld(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            await challenger.confirmActiveRedemptionPayment(request, tx1Hash, agent);
            await agent.checkAgentInfoOld(fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)), crt.feeUBA.add(request.feeUBA), 0, 0);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            const endBalance = await context.wNat.balanceOf(challenger.address);
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
            const tx1Hash = await agent.performRedemptionPayment(request, { status: TX_BLOCKED, maxFee: 100 });
            // others cannot confirm redemption payment immediatelly or challenge it as illegal payment
            await expectRevert(challenger.confirmBlockedRedemptionPayment(request, tx1Hash, agent), "only agent vault owner");
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "matching redemption active");
            await expectRevert(agent.destroy(), "destroy not announced");
            // others can confirm redemption payment after some time
            await time.increase(context.settings.confirmationByOthersAfterSeconds);
            const startBalance = await context.wNat.balanceOf(challenger.address);
            await agent.checkAgentInfoOld(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            await challenger.confirmBlockedRedemptionPayment(request, tx1Hash, agent);
            await agent.checkAgentInfoOld(fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)), crt.feeUBA.add(request.valueUBA).subn(100), 0, 0);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            const endBalance = await context.wNat.balanceOf(challenger.address);
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
            const tx1Hash = await agent.performRedemptionPayment(request, { status: TX_FAILED, gasLimit: 10, gasPrice: 10 });
            // others cannot confirm redemption payment immediatelly or challenge it as illegal payment
            await expectRevert(challenger.confirmFailedRedemptionPayment(request, tx1Hash, agent), "only agent vault owner");
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "matching redemption active");
            await expectRevert(agent.destroy(), "destroy not announced");
            // others can confirm redemption payment after some time
            await time.increase(context.settings.confirmationByOthersAfterSeconds);
            await agent.checkAgentInfoOld(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            const startBalanceChallenger = await context.wNat.balanceOf(challenger.address);
            const startBalanceAgent = await context.wNat.balanceOf(agent.agentVault.address);
            const startBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const res = await challenger.confirmFailedRedemptionPayment(request, tx1Hash, agent);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            const endBalanceChallenger = await context.wNat.balanceOf(challenger.address);
            const endBalanceAgent = await context.wNat.balanceOf(agent.agentVault.address);
            const endBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            // test rewarding
            assertWeb3Equal(endBalanceChallenger.sub(startBalanceChallenger), context.settings.confirmationByOthersRewardNATWei);
            // test rewarding for redemption payment default
            await agent.checkAgentInfoOld(fullAgentCollateral.sub(toBN(context.settings.confirmationByOthersRewardNATWei)).sub(res[1].redeemedCollateralWei), crt.feeUBA.add(request.valueUBA).subn(100), 0, 0);
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
            const startBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const startBalanceAgent = await context.wNat.balanceOf(agent.agentVault.address);
            await agent.checkAgentInfoOld(fullAgentCollateral, crt.feeUBA, 0, 0, 0, request.valueUBA);
            const res = await redeemer.redemptionPaymentDefault(request);
            await agent.checkAgentInfoOld(fullAgentCollateral.sub(res.redeemedCollateralWei), crt.feeUBA, 0, 0);
            const endBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const endBalanceAgent = await context.wNat.balanceOf(agent.agentVault.address);
            assertWeb3Equal(res.redeemedCollateralWei, await agent.getRedemptionPaymentDefaultValue(lots));
            assertWeb3Equal(endBalanceRedeemer.sub(startBalanceRedeemer), res.redeemedCollateralWei);
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), res.redeemedCollateralWei);
            // perform too late redemption payment
            const tx1Hash = await agent.performRedemptionPayment(request);
            // others can confirm redemption payment after some time
            await time.increase(context.settings.confirmationByOthersAfterSeconds);
            const startBalance = await context.wNat.balanceOf(challenger.address);
            await agent.checkAgentInfoOld(fullAgentCollateral.sub(res.redeemedCollateralWei), crt.feeUBA, 0, 0);
            await challenger.confirmDefaultedRedemptionPayment(request, tx1Hash, agent);
            await agent.checkAgentInfoOld(fullAgentCollateral.sub(res.redeemedCollateralWei).sub(toBN(context.settings.confirmationByOthersRewardNATWei)), crt.feeUBA.add(request.feeUBA), 0, 0);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            const endBalance = await context.wNat.balanceOf(challenger.address);
            // test rewarding
            assertWeb3Equal(endBalance.sub(startBalance), context.settings.confirmationByOthersRewardNATWei);
            // check that calling finishRedemptionWithoutPayment after confirming redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res.redeemedCollateralWei).sub(toBN(context.settings.confirmationByOthersRewardNATWei)));
        });
    });
});
