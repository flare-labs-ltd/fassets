import { expectRevert } from "@openzeppelin/test-helpers";
import { EventArgs } from "../../../lib/utils/events/common";
import { toWei } from "../../../lib/utils/helpers";
import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { MockTransactionOptionsWithFee } from "../../utils/fasset/MockChain";
import { getTestFile } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext, CommonContext } from "../utils/AssetContext";
import { Challenger } from "../utils/Challenger";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo, testNatInfo } from "../utils/TestChainInfo";

contract(`Audit.ts; ${getTestFile(__filename)}; Audit tests`, async accounts => {
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

    it("must fail", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1,
            context.underlyingAmount(10000));
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
        const fakeTxHash = await agent.performFakeRedemptionPayment(request);
        // others cannot confirm redemption payment immediately or challenge it as illegal payment
        await expectRevert(challenger.confirmActiveRedemptionPayment(request, tx1Hash, agent), "only agent vault owner");
        await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "matching redemption active");
        await challenger.illegalPaymentChallenge(agent, fakeTxHash);
    });

    it("must fail", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1,
            context.underlyingAmount(10000));
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
        const fakeTxHash = await agent.performFakeRedemptionPaymentID(request);
        // others cannot confirm redemption payment immediately or challenge it as illegal payment
        await expectRevert(challenger.confirmActiveRedemptionPayment(request, tx1Hash, agent), "only agent vault owner");
        await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "matching redemption active");
        await challenger.illegalPaymentChallenge(agent, fakeTxHash);
    });
});
