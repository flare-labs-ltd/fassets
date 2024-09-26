import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expectRevert } from "@openzeppelin/test-helpers";
import { AssetManagerSettings } from "../../../lib/fasset/AssetManagerTypes";
import { MAX_BIPS, toBN, toWei, WEEKS } from "../../../lib/utils/helpers";
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

    async function initialize() {
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth, {
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
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, userAddress2, underlyingUser2);
            const agentInfo = await agent.getAgentInfo();
            await agent.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            mockChain.mine(10);
            await context.updateUnderlyingBlock();
            const currentEpoch = await context.assetManager.currentTransferFeeEpoch();
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
            const transferFee = transferAmount.mul(toBN(settings.transferFeeMillionths)).divn(1e6);
            assertWeb3Equal(transfer.fee, transferFee);
            assert.isAbove(Number(transferFee), 100);
            assertWeb3Equal(startBalance.sub(endBalance), transferAmount.add(transferFee));
            // at this epoch, claimable amount should be 0, though fees are collected
            const { 2: totalFees } = await context.assetManager.transferFeeEpochData(currentEpoch);
            const claimableAmount0 = await agent.transferFeeShare(10);
            assertWeb3Equal(totalFees, transferFee);
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
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.underlyingAmount(10000));
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
            const { 2: totalFees } = await context.assetManager.transferFeeEpochData(currentEpoch);
            assertWeb3Equal(totalFees, 0);
        });

        it("other account can pay transfer fee", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter1 = await Minter.createTest(context, userAddress1, underlyingUser1, context.underlyingAmount(10000));
            const minter2 = await Minter.createTest(context, userAddress2, underlyingUser2, context.underlyingAmount(10000));
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
            const { 2: totalFees } = await context.assetManager.transferFeeEpochData(currentEpoch);
            assertWeb3Equal(transfer.fee, totalFees);
            // minter2 has paid the fee
            assertWeb3Equal(await context.fAsset.balanceOf(minter2.address), toBN(minted2.mintedAmountUBA).sub(toBN(transfer.fee)));
        });

        it("multiple agents split the fees according to average minted amount", async () => {
            // TODO
        });
    });
});
