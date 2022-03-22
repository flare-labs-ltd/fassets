import { expectRevert, time } from "@openzeppelin/test-helpers";
import { PaymentReference } from "../../utils/fasset/PaymentReference";
import { getTestFile, toBN, toWei } from "../../utils/helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "./Agent";
import { AssetContext, CommonContext } from "./AssetContext";
import { testChainInfo, testNatInfo } from "./ChainInfo";
import { Challenger } from "./Challenger";
import { Minter } from "./Minter";
import { Redeemer } from "./Redeemer";

contract(`AssetManagerSimulation.sol; ${getTestFile(__filename)}; Asset manager simulations`, async accounts => {
    const governance = accounts[10];
    const assetManagerController = accounts[11];
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[21];
    const minterAddress1 = accounts[30];
    const minterAddress2 = accounts[31];
    const redeemerAddress1 = accounts[40];
    const redeemerAddress2 = accounts[41];
    const challengerAddress1 = accounts[50];
    const challengerAddress2 = accounts[51];
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
        commonContext = await CommonContext.create(governance, assetManagerController, testNatInfo);
        context = await AssetContext.create(commonContext, testChainInfo.eth);
    });
    
    describe("simple scenarios", () => {
        it("create agent", async () => {
            const agent = await Agent.create(context, agentOwner1, underlyingAgent1);
        });

        it("mint and redeem f-assets", async () => {
            const agent = await Agent.create(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.create(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000)
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const transaction = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, transaction.hash);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(redemptionRequests.length, 1);
            for (const request of redemptionRequests) {
                assert.equal(request.agentVault, agent.vaultAddress);
                const transaction = await agent.performRedemptionPayment(request);
                await agent.confirmRedemptionPayment(request, transaction.hash);
            }
            // agent can exit now
            await agent.exitAvailable();
            await agent.announceWithdrawal(fullAgentCollateral);
            await time.increase(300);
            await agent.destroy();
        });

        it("mint and redeem f-assets (two redemption tickets - same agent)", async () => {
            const agent = await Agent.create(context, agentOwner1, underlyingAgent1);
            const minter1 = await Minter.create(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const minter2 = await Minter.create(context, minterAddress2, underlyingMinter2, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000)
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots1 = 3;
            const crt1 = await minter1.reserveCollateral(agent.vaultAddress, lots1);
            const transaction1 = await minter1.performMintingPayment(crt1);
            const minted1 = await minter1.executeMinting(crt1, transaction1.hash);
            assertWeb3Equal(minted1.mintedAmountUBA, context.convertLotsToUBA(lots1));
            const lots2 = 6;
            const crt2 = await minter2.reserveCollateral(agent.vaultAddress, lots2);
            const transaction2 = await minter2.performMintingPayment(crt2);
            const minted2 = await minter2.executeMinting(crt2, transaction2.hash);
            assertWeb3Equal(minted2.mintedAmountUBA, context.convertLotsToUBA(lots2));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted2.mintedAmountUBA, { from: minter2.address });
            // perform redemption
            const [redemptionRequests, remainingLots] = await redeemer.requestRedemption(lots2);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(redemptionRequests.length, 1);
            for (const request of redemptionRequests) {
                assert.equal(request.agentVault, agent.vaultAddress);
                const transaction = await agent.performRedemptionPayment(request);
                await agent.confirmRedemptionPayment(request, transaction.hash);
            }
            await expectRevert(agent.announceWithdrawal(fullAgentCollateral), "withdrawal: value too high");
        });

        it("mint and redeem f-assets (two redemption tickets - different agents)", async () => {
            const agent1 = await Agent.create(context, agentOwner1, underlyingAgent1);
            const agent2 = await Agent.create(context, agentOwner2, underlyingAgent2);
            const minter = await Minter.create(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent1.depositCollateral(fullAgentCollateral);
            await agent1.makeAvailable(500, 2_2000)
            await agent2.depositCollateral(fullAgentCollateral);
            await agent2.makeAvailable(500, 2_2000)
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots1 = 3;
            const crt1 = await minter.reserveCollateral(agent1.vaultAddress, lots1);
            const transaction1 = await minter.performMintingPayment(crt1);
            const minted1 = await minter.executeMinting(crt1, transaction1.hash);
            assertWeb3Equal(minted1.mintedAmountUBA, context.convertLotsToUBA(lots1));
            const lots2 = 6;
            const crt2 = await minter.reserveCollateral(agent2.vaultAddress, lots2);
            const transaction2 = await minter.performMintingPayment(crt2);
            const minted2 = await minter.executeMinting(crt2, transaction2.hash);
            assertWeb3Equal(minted2.mintedAmountUBA, context.convertLotsToUBA(lots2));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted2.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots] = await redeemer.requestRedemption(lots2);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(redemptionRequests.length, 2);
            const request1 = redemptionRequests[0];
            assert.equal(request1.agentVault, agent1.vaultAddress);
            const transaction3 = await agent1.performRedemptionPayment(request1);
            await agent1.confirmRedemptionPayment(request1, transaction3.hash);
            await agent1.announceWithdrawal(fullAgentCollateral);
            const request2 = redemptionRequests[1];
            assert.equal(request2.agentVault, agent2.vaultAddress);
            const transaction4 = await agent2.performRedemptionPayment(request2);
            await agent2.confirmRedemptionPayment(request2, transaction4.hash);
            await expectRevert(agent2.announceWithdrawal(fullAgentCollateral), "withdrawal: value too high");
        });

        it("mint and redeem f-assets (one redemption ticket - two redeemers)", async () => {
            const agent = await Agent.create(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.create(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer1 = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const redeemer2 = await Redeemer.create(context, redeemerAddress2, underlyingRedeemer2);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000)
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const transaction = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, transaction.hash);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            // redeemers "buy" f-assets
            await context.fAsset.transfer(redeemer1.address, minted.mintedAmountUBA.divn(2), { from: minter.address });
            await context.fAsset.transfer(redeemer2.address, minted.mintedAmountUBA.divn(2), { from: minter.address });
            // perform redemptions
            const [redemptionRequests1, remainingLots1] = await redeemer1.requestRedemption(lots / 2);
            assertWeb3Equal(remainingLots1, 0);
            assert.equal(redemptionRequests1.length, 1);
            const [redemptionRequests2, remainingLots2] = await redeemer2.requestRedemption(lots / 2);
            assertWeb3Equal(remainingLots2, 0);
            assert.equal(redemptionRequests2.length, 1);
            const request1 = redemptionRequests1[0];
            assert.equal(request1.agentVault, agent.vaultAddress);
            const transaction3 = await agent.performRedemptionPayment(request1);
            await agent.confirmRedemptionPayment(request1, transaction3.hash);
            await expectRevert(agent.announceWithdrawal(fullAgentCollateral), "withdrawal: value too high");
            const request2 = redemptionRequests2[0];
            assert.equal(request2.agentVault, agent.vaultAddress);
            const transaction4 = await agent.performRedemptionPayment(request2);
            await agent.confirmRedemptionPayment(request2, transaction4.hash);
            // agent can exit now
            await agent.exitAvailable();
            await agent.announceWithdrawal(fullAgentCollateral);
            await time.increase(300);
            await agent.destroy();
        });

        it("mint and redeem f-assets (self-close)", async () => {
            const agent = await Agent.create(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.create(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000)
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const transaction = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, transaction.hash);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerAddress, minted.mintedAmountUBA, { from: minter.address });
            // perform self close
            const [dustChanges, selfClosedUBA] = await agent.selfClose(minted.mintedAmountUBA);
            assertWeb3Equal(selfClosedUBA, minted.mintedAmountUBA);
            assert.equal(dustChanges.length, 0);
            // agent can exit now
            await agent.exitAvailable();
            await agent.announceWithdrawal(fullAgentCollateral);
            await time.increase(300);
            await agent.destroy();
        });

        it("mint and redeem f-assets (self-close can create and/or remove dust)", async () => {
            const agent = await Agent.create(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.create(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000)
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const transaction = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, transaction.hash);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerAddress, minted.mintedAmountUBA, { from: minter.address });
            // perform partial self close
            const dustAmountUBA = context.convertAmgToUBA(5);
            const selfCloseAmountUBA = minted.mintedAmountUBA.sub(dustAmountUBA);
            const [dustChangesUBA1, selfClosedUBA1] = await agent.selfClose(selfCloseAmountUBA);
            assertWeb3Equal(selfClosedUBA1, selfCloseAmountUBA);
            assert.equal(dustChangesUBA1.length, 1);
            assertWeb3Equal(dustChangesUBA1[0], dustAmountUBA);
            await expectRevert(agent.destroy(), "agent still active");
            const [dustChangesUBA2, selfClosedUBA2] = await agent.selfClose(dustAmountUBA);
            assertWeb3Equal(selfClosedUBA2, dustAmountUBA);
            assert.equal(dustChangesUBA2.length, 1);
            assertWeb3Equal(dustChangesUBA2[0], 0);
            // agent can exit now
            await agent.exitAvailable();
            await agent.announceWithdrawal(fullAgentCollateral);
            await time.increase(300);
            await agent.destroy();
        });

        it("illegal payment challenge", async () => {
            const agent = await Agent.create(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.create(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const challenger = await Challenger.create(context, challengerAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000)
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const transaction = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, transaction.hash);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            // perform illegal payment
            const tx = await agent.performPayment("IllegalPayment1", 100);
            // challenge agent for illegal payment
            const startBalance = await context.wnat.balanceOf(challengerAddress1);
            await challenger.illegalPaymentChallenge(agent, tx.hash);
            const endBalance = await context.wnat.balanceOf(challengerAddress1);
            // test rewarding
            assertWeb3Equal(endBalance.sub(startBalance), await challenger.getChallengerReward(context.convertLotsToAMG(lots)));
        });

        it("double payment challenge", async () => {
            const agent = await Agent.create(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.create(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const challenger = await Challenger.create(context, challengerAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000)
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const transaction = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, transaction.hash);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            // perform double payment
            const tx1 = await agent.performPayment(underlyingRedeemer1, 100, 0, PaymentReference.redemption(5));
            const tx2 = await agent.performPayment(underlyingRedeemer1, 100, 0, PaymentReference.redemption(5));
            // challenge agent for double payment
            const startBalance = await context.wnat.balanceOf(challengerAddress1);
            await challenger.doublePaymentChallenge(agent, tx1.hash, tx2.hash);
            const endBalance = await context.wnat.balanceOf(challengerAddress1);
            // test rewarding
            assertWeb3Equal(endBalance.sub(startBalance), await challenger.getChallengerReward(context.convertLotsToAMG(lots)));
        });

        it("free balance negative challenge", async () => {
            const agent = await Agent.create(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.create(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const challenger = await Challenger.create(context, challengerAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000)
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const transaction = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, transaction.hash);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            // perform some payments
            const tx = await agent.performPayment(underlyingRedeemer1, context.convertLotsToUBA(lots));
            // challenge agent for negative underlying balance
            const startBalance = await context.wnat.balanceOf(challengerAddress1);
            await challenger.freeBalanceNegativeChallenge(agent, [tx.hash]);
            const endBalance = await context.wnat.balanceOf(challengerAddress1);
            // test rewarding
            assertWeb3Equal(endBalance.sub(startBalance), await challenger.getChallengerReward(context.convertLotsToAMG(lots)));
        });
    });
});
