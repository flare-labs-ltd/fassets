import { expectRevert } from "@openzeppelin/test-helpers";
import { toBN, toWei } from "../../../lib/utils/helpers";
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

    describe("simple scenarios - creating and converting dust", () => {
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
            const dustChangeUBA2 = await redeemer.convertDustToTicket(agent);
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
    });
});
