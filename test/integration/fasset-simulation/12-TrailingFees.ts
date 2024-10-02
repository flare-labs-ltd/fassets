import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expectRevert } from "@openzeppelin/test-helpers";
import { AssetManagerSettings } from "../../../lib/fasset/AssetManagerTypes";
import { BNish, deepFormat, MAX_BIPS, toBN, toWei, WEEKS, ZERO_ADDRESS } from "../../../lib/utils/helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo } from "../utils/TestChainInfo";
import { assertApproximatelyEqual } from "../../utils/approximation";

contract(`AssetManagerSimulation.sol; ${getTestFile(__filename)}; Asset manager simulations - transfer fees`, async accounts => {
    const governance = accounts[10];
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[21];
    const userAddress1 = accounts[30];
    const userAddress2 = accounts[31];
    const userAddress3 = accounts[32];
    const challengerAddress1 = accounts[50];
    const challengerAddress2 = accounts[51];
    const liquidatorAddress1 = accounts[60];
    const liquidatorAddress2 = accounts[61];
    const emergencyAddress1 = accounts[71];
    const emergencyAddress2 = accounts[72];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
    const underlyingAgent2 = "Agent2";
    const underlyingUser1 = "Minter1";
    const underlyingUser2 = "Minter2";

    const epochDuration = 1 * WEEKS;

    let commonContext: CommonContext;
    let context: AssetContext;
    let mockChain: MockChain;
    let mockStateConnectorClient: MockStateConnectorClient;
    let settings: AssetManagerSettings;

    async function transferFeeClaimingSettings(context: AssetContext) {
        const { 0: firstEpochStartTs, 1: epochDuration, 2: maxUnexpiredEpochs, 3: firstClaimableEpoch } =
            await context.assetManager.transferFeeClaimingSettings();
        const transferFeeMillionths = await context.assetManager.transferFeeMillionths();
        return { transferFeeMillionths, firstEpochStartTs, epochDuration, maxUnexpiredEpochs, firstClaimableEpoch };
    }

    async function transferFeeEpochData(context: AssetContext, epoch: BNish) {
        const { 0: startTs, 1: endTs, 2: totalFees, 3: claimedFees, 4: claimable, 5: expired } =
            await context.assetManager.transferFeeEpochData(epoch);
        return { startTs, endTs, totalFees, claimedFees, claimable, expired };
    }

    async function agentTransferFeeEpochData(agent: Agent, epoch: BNish) {
        const { 0: totalFees, 1: cumulativeMinted, 2: totalCumulativeMinted, 3: claimable, 4: claimed } =
            await agent.context.assetManager.agentTransferFeeEpochData(agent.vaultAddress, epoch);
        // console.log(agent.underlyingAddress, `epoch ${epoch}`,
        //     deepFormat({ totalFees, avgMinted: epochAverage(cumulativeMinted), totalAvgMinted: epochAverage(totalCumulativeMinted), claimable, claimed }));
        return { totalFees, cumulativeMinted, totalCumulativeMinted, claimable, claimed };
    }

    function epochAverage(cumulative: BNish) {
        return toBN(cumulative).divn(epochDuration);
    }

    const UNLIMITED = toBN(1).shln(255);

    async function setFAssetFeesPaidBy(origin: string, feePayer: string, maxFeeAmount: BNish, method: () => Promise<void>,) {
        await context.fAsset.approve(origin, maxFeeAmount, { from: feePayer });
        await context.fAsset.setTransferFeesPaidBy(feePayer, { from: origin });
        await method();
        await context.fAsset.setTransferFeesPaidBy(ZERO_ADDRESS, { from: origin });
        await context.fAsset.approve(origin, 0, { from: feePayer });
    }

    async function initialize() {
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.btc, {
            testSettings: {
                transferFeeMillionths: 200, // 2 BIPS
                transferFeeClaimFirstEpochStartTs: (await time.latest()) - 20 * epochDuration,
                transferFeeClaimEpochDurationSeconds: epochDuration,
                transferFeeClaimMaxUnexpiredEpochs: 12,
            }
        });
        return { commonContext, context };
    }

    beforeEach(async () => {
        ({ commonContext, context } = await loadFixtureCopyVars(initialize));
        settings = context.settings;
        mockChain = context.chain as MockChain;
        mockStateConnectorClient = context.stateConnectorClient as MockStateConnectorClient;
    });

    describe("transfer fees charging and claiming", () => {
        it("current epoch should be same as first claimable at start", async () => {
            const currentEpoch = await context.assetManager.currentTransferFeeEpoch();
            const firstClaimableEpoch = await context.assetManager.firstClaimableTransferFeeEpoch();
            assertWeb3Equal(currentEpoch, 20);
            assertWeb3Equal(firstClaimableEpoch, 20);
        });

        it("should charge transfer fee and agent can claim", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.lotSize().muln(100));
            const redeemer = await Redeemer.create(context, userAddress2, underlyingUser2);
            const agentInfo = await agent.getAgentInfo();
            await agent.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            mockChain.mine(10);
            await context.updateUnderlyingBlock();
            const currentEpoch = await context.assetManager.currentTransferFeeEpoch();
            const trfSettings = await transferFeeClaimingSettings(context);
            // perform minting
            const lots = 3;
            const [minted] = await minter.performMinting(agent.vaultAddress, lots);
            // cannot transfer everything - something must remain to pay the fee
            await expectRevert(minter.transferFAsset(redeemer.address, minted.mintedAmountUBA),
                "balance too low for transfer fee");
            // transfer and check that fee was subtracted
            const transferAmount = context.lotSize().muln(2);
            const startBalance = await context.fAsset.balanceOf(minter.address);
            const transfer = await minter.transferFAsset(redeemer.address, transferAmount);
            const endBalance = await context.fAsset.balanceOf(minter.address);
            const transferFee = transferAmount.mul(toBN(trfSettings.transferFeeMillionths)).divn(1e6);
            assertWeb3Equal(transfer.fee, transferFee);
            assert.isAbove(Number(transferFee), 100);
            assertWeb3Equal(startBalance.sub(endBalance), transferAmount.add(transferFee));
            // at this epoch, claimable amount should be 0, though fees are collected
            const epochData = await transferFeeEpochData(context, currentEpoch);
            const claimableAmount0 = await agent.transferFeeShare(10);
            assertWeb3Equal(epochData.totalFees, transferFee);
            assertWeb3Equal(claimableAmount0, 0);
            // skip 1 epoch and claim
            await time.increase(epochDuration);
            const claimableAmount1 = await agent.transferFeeShare(10);
            assertWeb3Equal(claimableAmount1, transferFee);
            const claimed = await agent.claimTransferFees(agent.ownerWorkAddress, 10);
            const ownerFBalance = await context.fAsset.balanceOf(agent.ownerWorkAddress);
            const poolFeeShare = transferFee.mul(toBN(agentInfo.poolFeeShareBIPS)).divn(MAX_BIPS);
            const agentFeeShare = transferFee.sub(poolFeeShare);
            assertWeb3Equal(ownerFBalance, agentFeeShare);
            assertWeb3Equal(agentFeeShare, claimed.agentClaimedUBA);
            assertWeb3Equal(poolFeeShare, claimed.poolClaimedUBA);
            const poolFBalance = await context.fAsset.balanceOf(agentInfo.collateralPool);
            const poolExpected = toBN(minted.poolFeeUBA).add(poolFeeShare);
            assertWeb3Equal(poolFBalance, poolExpected);
        });

        it("transfer fees should not affect mint and redeem", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.lotSize().muln(100));
            const redeemer = await Redeemer.create(context, userAddress1, underlyingUser1);
            await agent.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            mockChain.mine(10);
            await context.updateUnderlyingBlock();
            const currentEpoch = await context.assetManager.currentTransferFeeEpoch();
            // perform minting and redemption
            const lots = 2;
            const [minted] = await minter.performMinting(agent.vaultAddress, lots);
            const [requests] = await redeemer.requestRedemption(lots);
            await agent.performRedemptions(requests);
            // only pool minting fee is minted now
            const agentInfo = await agent.getAgentInfo();
            assertWeb3Equal(agentInfo.mintedUBA, minted.poolFeeUBA);
            // and no fee was charged
            const epochData = await transferFeeEpochData(context, currentEpoch);
            assertWeb3Equal(epochData.totalFees, 0);
        });

        it("other account can pay transfer fee", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter1 = await Minter.createTest(context, userAddress1, underlyingUser1, context.lotSize().muln(100));
            const minter2 = await Minter.createTest(context, userAddress2, underlyingUser2, context.lotSize().muln(100));
            await agent.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            mockChain.mine(10);
            await context.updateUnderlyingBlock();
            const currentEpoch = await context.assetManager.currentTransferFeeEpoch();
            // perform mintings
            const lots = 1;
            const [minted1] = await minter1.performMinting(agent.vaultAddress, lots);
            const [minted2] = await minter2.performMinting(agent.vaultAddress, lots);
            // change transfer payer
            await context.fAsset.setTransferFeesPaidBy(minter2.address, { from: minter1.address });
            // of course the other has to agree
            await expectRevert(minter1.transferFAsset(userAddress3, minted1.mintedAmountUBA),
                "allowance too low for transfer fee");
            // after approval, minter1 should be able to transfer whole amount
            const transferAmount = toBN(minted1.mintedAmountUBA);
            await context.fAsset.approve(minter1.address, transferAmount.divn(1000), { from: minter2.address });
            assertWeb3Equal(await context.fAsset.balanceOf(minter1.address), transferAmount);
            const transfer = await minter1.transferFAsset(userAddress3, transferAmount);
            assertWeb3Equal(await context.fAsset.balanceOf(minter1.address), 0);
            assertWeb3Equal(await context.fAsset.balanceOf(userAddress3), transferAmount);
            assertWeb3Equal(transfer.value, transferAmount);
            assert.isBelow(Number(transfer.fee), Number(transfer.value) / 100);
            assert.isAbove(Number(transfer.fee), 0);
            const epochData = await transferFeeEpochData(context, currentEpoch);
            assertWeb3Equal(transfer.fee, epochData.totalFees);
            // minter2 has paid the fee
            assertWeb3Equal(await context.fAsset.balanceOf(minter2.address), toBN(minted2.mintedAmountUBA).sub(toBN(transfer.fee)));
        });

        it("multiple agents split the fees according to average minted amount", async () => {
            const agent1 = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            await agent1.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
            await agent2.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.lotSize().muln(100));
            const redeemer = await Redeemer.create(context, userAddress2, underlyingUser2);
            mockChain.mine(10);
            await context.updateUnderlyingBlock();
            //
            const firstEpoch = Number(await context.assetManager.currentTransferFeeEpoch());
            const firstEpochData = transferFeeEpochData(context, firstEpoch);
            const start = await time.latest();
            const trfSettings = await transferFeeClaimingSettings(context);
            const epochDuration = Number(trfSettings.epochDuration);
            const lotSize = context.lotSize();
            // do some minting, redeeming and transfers
            const [minted1] = await minter.performMinting(agent1.vaultAddress, 10);
            const [minted2] = await minter.performMinting(agent2.vaultAddress, 30);
            // check
            const poolFees1 = toBN(minted1.poolFeeUBA);
            const poolFees2 = toBN(minted2.poolFeeUBA);
            const poolFeesTotal = poolFees1.add(poolFees2);
            await agent1.checkAgentInfo({ mintedUBA: toBN(lotSize).muln(10).add(poolFees1) });
            await agent2.checkAgentInfo({ mintedUBA: toBN(lotSize).muln(30).add(poolFees2) });
            // console.log(await time.latest() - Number((await firstEpochData).startTs));
            // console.log((await time.latest() - Number((await firstEpochData).startTs)) / epochDuration);
            // give minter enough extra to cover transfer fees (mind that this charges some transfer fees too)
            await setFAssetFeesPaidBy(agent1.ownerWorkAddress, minter.address, UNLIMITED, async () => {
                await agent1.withdrawPoolFees(await agent1.poolFeeBalance(), minter.address);
            });
            //
            await time.increaseTo(start + 0.5 * epochDuration);
            await minter.transferFAsset(redeemer.address, lotSize.muln(30));
            const [rrqs1] = await redeemer.requestRedemption(20);
            await Agent.performRedemptions([agent1, agent2], rrqs1);
            await agent1.checkAgentInfo({ mintedUBA: toBN(lotSize).muln(0).add(poolFees1) });
            await agent2.checkAgentInfo({ mintedUBA: toBN(lotSize).muln(20).add(poolFees2) });
            //
            await time.increaseTo(start + 1.5 * epochDuration);
            await minter.transferFAsset(redeemer.address, lotSize.muln(10));
            const [rrqs2] = await redeemer.requestRedemption(20);
            await Agent.performRedemptions([agent1, agent2], rrqs2);
            await agent1.checkAgentInfo({ mintedUBA: toBN(lotSize).muln(0).add(poolFees1) });
            await agent2.checkAgentInfo({ mintedUBA: toBN(lotSize).muln(0).add(poolFees2) });
            // backing for epoch1: total = 40 lots for 1/2 epoch, 20 lots for 1/2 epoch = 30 lots avg
            //   ag1: 10 lots for 1/2 epoch -> 10 * 1/2 / 30 = 1/6 share
            //   ag2: 30 lots for 1/2 epoch, 20 lots for 1/2 epoch -> (30 * 1/2 + 20 * 1/2) / 30 = 25/30 = 5/6 share
            // backing for epoch2: total = 20 lots for 1/2 epoch = 10 lots avg
            //   ag1: 0
            //   ag2: 20 lots for 1/2 epoch -> 10 / 10 = 25/30 = 1 share
            const ep1agent1 = await agentTransferFeeEpochData(agent1, firstEpoch);
            const ep2agent1 = await agentTransferFeeEpochData(agent1, firstEpoch + 1);
            const ep1agent2 = await agentTransferFeeEpochData(agent2, firstEpoch);
            const ep2agent2 = await agentTransferFeeEpochData(agent2, firstEpoch + 1);
            assertWeb3Equal(ep1agent1.totalCumulativeMinted, ep1agent2.totalCumulativeMinted);
            assertWeb3Equal(ep2agent1.totalCumulativeMinted, ep2agent2.totalCumulativeMinted);
            const ep1TotalAvgNoFee = epochAverage(ep1agent1.totalCumulativeMinted).sub(poolFeesTotal);
            const ep2TotalAvgNoFee = epochAverage(ep2agent1.totalCumulativeMinted).sub(poolFeesTotal);
            assertApproximatelyEqual(ep1TotalAvgNoFee, lotSize.muln(30), 'relative', 1e-3);
            assertApproximatelyEqual(ep2TotalAvgNoFee, lotSize.muln(10), 'relative', 1e-3);
            assertApproximatelyEqual(epochAverage(ep1agent1.cumulativeMinted), ep1TotalAvgNoFee.muln(1).divn(6).add(poolFees1), 'relative', 1e-3);
            assertApproximatelyEqual(epochAverage(ep1agent2.cumulativeMinted), ep1TotalAvgNoFee.muln(5).divn(6).add(poolFees2), 'relative', 1e-3);
            assertApproximatelyEqual(epochAverage(ep2agent1.cumulativeMinted), ep2TotalAvgNoFee.muln(0).add(poolFees1), 'relative', 1e-3);
            assertApproximatelyEqual(epochAverage(ep2agent2.cumulativeMinted), ep2TotalAvgNoFee.muln(1).add(poolFees2), 'relative', 1e-3);
        });
    });
});
