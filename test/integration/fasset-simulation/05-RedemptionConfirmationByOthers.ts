import { expectRevert } from "@openzeppelin/test-helpers";
import { TX_BLOCKED, TX_FAILED } from "../../../lib/underlying-chain/interfaces/IBlockChain";
import { toBN, toWei } from "../../../lib/utils/helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockFlareDataConnectorClient } from "../../utils/fasset/MockFlareDataConnectorClient";
import { deterministicTimeIncrease, getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { Challenger } from "../utils/Challenger";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo } from "../utils/TestChainInfo";

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
    let mockFlareDataConnectorClient: MockFlareDataConnectorClient;

    async function initialize() {
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
        return { commonContext, context };
    }

    beforeEach(async () => {
        ({ commonContext, context } = await loadFixtureCopyVars(initialize));
        mockChain = context.chain as MockChain;
        mockFlareDataConnectorClient = context.flareDataConnectorClient as MockFlareDataConnectorClient;
    });

    describe("", () => {
        it("mint and redeem f-assets (others can confirm redemption payment after some time)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const challenger = await Challenger.create(context, challengerAddress1);
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
            const tx1Hash = await agent.performRedemptionPayment(request);
            // others cannot confirm redemption payment immediately or challenge it as illegal payment
            await expectRevert(challenger.confirmActiveRedemptionPayment(request, tx1Hash, agent), "only agent vault owner");
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "matching redemption active");
            await expectRevert(agent.destroy(), "destroy not announced");
            // others can confirm redemption payment after some time
            await deterministicTimeIncrease(context.settings.confirmationByOthersAfterSeconds);
            const startChallengerVaultCollateralBalance = await agent.vaultCollateralToken().balanceOf(challenger.address);
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA, mintedUBA: minted.poolFeeUBA, reservedUBA: 0, redeemingUBA: request.valueUBA });
            await challenger.confirmActiveRedemptionPayment(request, tx1Hash, agent);
            const challengerVaultCollateralReward = await agent.usd5ToVaultCollateralWei(toBN(context.settings.confirmationByOthersRewardUSD5));
            assert.approximately(Number(challengerVaultCollateralReward) / 1e18, 100, 10);
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(challengerVaultCollateralReward), freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(request.feeUBA), redeemingUBA: 0 });
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            const endChallengerVaultCollateralBalance = await agent.vaultCollateralToken().balanceOf(challenger.address);
            // test rewarding
            assertWeb3Equal(endChallengerVaultCollateralBalance.sub(startChallengerVaultCollateralBalance), challengerVaultCollateralReward);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(challengerVaultCollateralReward));
        });

        it("mint and redeem f-assets (others can confirm blocked redemption payment after some time)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const challenger = await Challenger.create(context, challengerAddress1);
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
            const tx1Hash = await agent.performRedemptionPayment(request, { status: TX_BLOCKED, maxFee: 100 });
            // others cannot confirm redemption payment immediatelly or challenge it as illegal payment
            await expectRevert(challenger.confirmBlockedRedemptionPayment(request, tx1Hash, agent), "only agent vault owner");
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "matching redemption active");
            await expectRevert(agent.destroy(), "destroy not announced");
            // others can confirm redemption payment after some time
            await deterministicTimeIncrease(context.settings.confirmationByOthersAfterSeconds);
            const startChallengerVaultCollateralBalance = await agent.vaultCollateralToken().balanceOf(challenger.address);
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA, mintedUBA: minted.poolFeeUBA, reservedUBA: 0, redeemingUBA: request.valueUBA });
            await challenger.confirmBlockedRedemptionPayment(request, tx1Hash, agent);
            const challengerVaultCollateralReward = await agent.usd5ToVaultCollateralWei(toBN(context.settings.confirmationByOthersRewardUSD5));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(challengerVaultCollateralReward), freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(request.valueUBA).subn(100), redeemingUBA: 0 });
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            const endChallengerVaultCollateralBalance = await agent.vaultCollateralToken().balanceOf(challenger.address);
            // test rewarding
            assertWeb3Equal(endChallengerVaultCollateralBalance.sub(startChallengerVaultCollateralBalance), challengerVaultCollateralReward);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(challengerVaultCollateralReward));
        });

        it("mint and redeem f-assets (others can confirm failed redemption payment after some time)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const challenger = await Challenger.create(context, challengerAddress1);
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
            const tx1Hash = await agent.performRedemptionPayment(request, { status: TX_FAILED, gasLimit: 10, gasPrice: 10 });
            // others cannot confirm redemption payment immediatelly or challenge it as illegal payment
            await expectRevert(challenger.confirmFailedRedemptionPayment(request, tx1Hash, agent), "only agent vault owner");
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "matching redemption active");
            await expectRevert(agent.destroy(), "destroy not announced");
            // others can confirm redemption payment after some time
            await deterministicTimeIncrease(context.settings.confirmationByOthersAfterSeconds);
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA, mintedUBA: minted.poolFeeUBA, reservedUBA: 0, redeemingUBA: request.valueUBA });
            const startVaultCollateralBalanceChallenger = await agent.vaultCollateralToken().balanceOf(challenger.address);
            const startVaultCollateralBalanceAgent = await agent.vaultCollateralToken().balanceOf(agent.agentVault.address);
            const startVaultCollateralBalanceRedeemer = await agent.vaultCollateralToken().balanceOf(redeemer.address);
            const startPoolBalanceAgent = await agent.poolCollateralBalance();
            const startPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const res = await challenger.confirmFailedRedemptionPayment(request, tx1Hash, agent);
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            const endVaultCollateralBalanceChallenger = await agent.vaultCollateralToken().balanceOf(challenger.address);
            const endVaultCollateralBalanceAgent = await agent.vaultCollateralToken().balanceOf(agent.agentVault.address);
            const endVaultCollateralBalanceRedeemer = await agent.vaultCollateralToken().balanceOf(redeemer.address);
            const endPoolBalanceAgent = await agent.poolCollateralBalance();
            const endPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            // test rewarding
            const challengerVaultCollateralReward = await agent.usd5ToVaultCollateralWei(toBN(context.settings.confirmationByOthersRewardUSD5));
            assertWeb3Equal(endVaultCollateralBalanceChallenger.sub(startVaultCollateralBalanceChallenger), challengerVaultCollateralReward);
            // test rewarding for redemption payment default
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(challengerVaultCollateralReward).sub(res[1].redeemedVaultCollateralWei), freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(request.valueUBA).subn(100), redeemingUBA: 0 });
            const [redemptionDefaultValueVaultCollateral, redemptionDefaultValuePool] = await agent.getRedemptionPaymentDefaultValue(lots);
            assertWeb3Equal(res[1].redeemedVaultCollateralWei,redemptionDefaultValueVaultCollateral);
            assertWeb3Equal(res[1].redeemedPoolCollateralWei, redemptionDefaultValuePool);
            assertWeb3Equal(endVaultCollateralBalanceRedeemer.sub(startVaultCollateralBalanceRedeemer), res[1].redeemedVaultCollateralWei);
            assertWeb3Equal(startVaultCollateralBalanceAgent.sub(endVaultCollateralBalanceAgent), challengerVaultCollateralReward.add(res[1].redeemedVaultCollateralWei));
            assertWeb3Equal(endPoolBalanceRedeemer.sub(startPoolBalanceRedeemer), res[1].redeemedPoolCollateralWei);
            assertWeb3Equal(startPoolBalanceAgent.sub(endPoolBalanceAgent), res[1].redeemedPoolCollateralWei);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(challengerVaultCollateralReward).sub(res[1].redeemedVaultCollateralWei));
        });

        it("mint and redeem f-assets (others can confirm default redemption payment after some time)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
            const challenger = await Challenger.create(context, challengerAddress1);
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
            await context.updateUnderlyingBlock();
            const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(dustChanges.length, 0);
            assert.equal(redemptionRequests.length, 1);
            const request = redemptionRequests[0];
            assert.equal(request.agentVault, agent.vaultAddress);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment + 10; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // test rewarding for redemption payment default
            const startVaultCollateralBalanceRedeemer = await agent.vaultCollateralToken().balanceOf(redeemer.address);
            const startVaultCollateralBalanceAgent = await agent.vaultCollateralToken().balanceOf(agent.agentVault.address);
            const startPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const startPoolBalanceAgent = await agent.poolCollateralBalance();
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: minted.agentFeeUBA, mintedUBA: minted.poolFeeUBA, reservedUBA: 0, redeemingUBA: request.valueUBA });
            const res = await redeemer.redemptionPaymentDefault(request);
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(res.redeemedVaultCollateralWei), freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(request.valueUBA), redeemingUBA: 0 });
            const endVaultCollateralBalanceRedeemer = await agent.vaultCollateralToken().balanceOf(redeemer.address);
            const endVaultCollateralBalanceAgent = await agent.vaultCollateralToken().balanceOf(agent.agentVault.address);
            const endPoolBalanceRedeemer = await context.wNat.balanceOf(redeemer.address);
            const endPoolBalanceAgent = await agent.poolCollateralBalance();
            const [redemptionDefaultValueVaultCollateral, redemptionDefaultValuePool] = await agent.getRedemptionPaymentDefaultValue(lots);
            assertWeb3Equal(res.redeemedVaultCollateralWei, redemptionDefaultValueVaultCollateral);
            assertWeb3Equal(res.redeemedPoolCollateralWei, redemptionDefaultValuePool);
            assertWeb3Equal(endVaultCollateralBalanceRedeemer.sub(startVaultCollateralBalanceRedeemer), res.redeemedVaultCollateralWei);
            assertWeb3Equal(startVaultCollateralBalanceAgent.sub(endVaultCollateralBalanceAgent), res.redeemedVaultCollateralWei);
            assertWeb3Equal(endPoolBalanceRedeemer.sub(startPoolBalanceRedeemer), res.redeemedPoolCollateralWei);
            assertWeb3Equal(startPoolBalanceAgent.sub(endPoolBalanceAgent), res.redeemedPoolCollateralWei);
            // perform too late redemption payment
            const tx1Hash = await agent.performRedemptionPayment(request);
            // others can confirm redemption payment after some time
            await deterministicTimeIncrease(context.settings.confirmationByOthersAfterSeconds);
            const startChallengerVaultCollateralBalance = await agent.vaultCollateralToken().balanceOf(challenger.address);
            await challenger.confirmDefaultedRedemptionPayment(request, tx1Hash, agent);
            const challengerVaultCollateralReward = await agent.usd5ToVaultCollateralWei(toBN(context.settings.confirmationByOthersRewardUSD5));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(res.redeemedVaultCollateralWei).sub(challengerVaultCollateralReward), freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(request.feeUBA) });
            await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), "chlg: transaction confirmed");
            const endChallengerVaultCollateralBalance = await agent.vaultCollateralToken().balanceOf(challenger.address);
            // test rewarding
            assertWeb3Equal(endChallengerVaultCollateralBalance.sub(startChallengerVaultCollateralBalance), challengerVaultCollateralReward);
            // check that calling finishRedemptionWithoutPayment after confirming redemption payment will revert
            await expectRevert(agent.finishRedemptionWithoutPayment(request), "invalid request id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(res.redeemedVaultCollateralWei).sub(challengerVaultCollateralReward));
        });
    });
});
