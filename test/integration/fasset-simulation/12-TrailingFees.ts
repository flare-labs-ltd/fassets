import { expectRevert } from "@openzeppelin/test-helpers";
import { formatBN, HOURS, MAX_BIPS, toBN, toWei, WEEKS } from "../../../lib/utils/helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { testChainInfo } from "../utils/TestChainInfo";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { Redeemer } from "../utils/Redeemer";
import { Liquidator } from "../utils/Liquidator";
import { AgentStatus, AssetManagerSettings } from "../../../lib/fasset/AssetManagerTypes";
import { assertWeb3Equal } from "../../utils/web3assertions";

contract(`AssetManagerSimulation.sol; ${getTestFile(__filename)}; Asset manager simulations - emergency pause`, async accounts => {
    const governance = accounts[10];
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[21];
    const userAddress1 = accounts[30];
    const userAddress2 = accounts[31];
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

    describe("simple scenarios - emergency pause", () => {
        it("current epoch should be same as first claimable at start", async () => {
            const currentEpoch = await context.assetManager.currentTransferFeeEpoch();
            const firstClaimableEpoch = await context.assetManager.firstClaimableTransferFeeEpoch();
            assertWeb3Equal(currentEpoch, 20);
            assertWeb3Equal(firstClaimableEpoch, 20);
        });

        it("mint and transfer - fee should be extracted", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, userAddress2, underlyingUser2);
            const agentInfo = await agent.getAgentInfo();
            await agent.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            mockChain.mine(10);
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const [minted] = await minter.performMinting(agent.vaultAddress, lots);
            // cannot transfer everything - something must remain to pay the fee
            await expectRevert(context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address }),
                "balance too low for transfer fee");
            // transfer and check that fee was subtracted
            const transferAmount = context.lotSize().muln(2);
            const startBalance = await context.fAsset.balanceOf(minter.address);
            await context.fAsset.transfer(redeemer.address, transferAmount, { from: minter.address });
            const endBalance = await context.fAsset.balanceOf(minter.address);
            const transferFee = transferAmount.mul(toBN(settings.transferFeeMillionths)).divn(1e6);
            assert.isAbove(Number(transferFee), 100);
            assertWeb3Equal(startBalance.sub(endBalance), transferAmount.add(transferFee));
            // at this epoch, claimable amount should be 0
            const claimableAmount0 = await context.assetManager.agentTransferFeeShare(agent.vaultAddress, 10);
            assertWeb3Equal(claimableAmount0, 0);
            // skip 1 epoch and claim
            await time.increase(epochDuration);
            const claimableAmount1 = await context.assetManager.agentTransferFeeShare(agent.vaultAddress, 10);
            assertWeb3Equal(claimableAmount1, transferFee);
            await context.assetManager.claimTransferFees(agent.vaultAddress, agent.ownerWorkAddress, 10, { from: agent.ownerWorkAddress });
            const ownerFBalance = await context.fAsset.balanceOf(agent.ownerWorkAddress);
            const poolFeeShare = transferFee.mul(toBN(agentInfo.poolFeeShareBIPS)).divn(MAX_BIPS);
            const agentFeeShare = transferFee.sub(poolFeeShare);
            assertWeb3Equal(ownerFBalance, agentFeeShare);
            const poolFBalance = await context.fAsset.balanceOf(agentInfo.collateralPool);
            const poolExpected = toBN(minted.poolFeeUBA).add(poolFeeShare);
            assertWeb3Equal(poolFBalance, poolExpected);
            // const [requests] = await redeemer.requestRedemption(lots);
            // // redemption payments can be performed and confirmed in pause
            // await context.assetManagerController.emergencyPause([context.assetManager.address], 1 * HOURS, { from: emergencyAddress1 });
            // await agent.performRedemptions(requests);
        });
    });
});
