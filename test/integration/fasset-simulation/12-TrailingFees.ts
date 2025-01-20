import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { BN_ZERO, BNish, DAYS, MAX_BIPS, toBN, toBNExp, toWei, WEEKS, ZERO_ADDRESS } from "../../../lib/utils/helpers";
import { FAssetInstance, IIAssetManagerInstance } from "../../../typechain-truffle";
import { assertApproximatelyEqual } from "../../utils/approximation";
import { MockChain } from "../../utils/fasset/MockChain";
import { deterministicTimeIncrease, getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Web3EventDecoder } from "../../utils/Web3EventDecoder";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo } from "../utils/TestChainInfo";
import { calculateReceivedNat } from "../../utils/eth";
import { requiredEventArgs } from "../../../lib/utils/events/truffle";

contract(`AssetManagerSimulation.sol; ${getTestFile(__filename)}; Asset manager simulations - transfer fees`, async accounts => {
    const governance = accounts[10];
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[21];
    const agentOwner3 = accounts[22];
    const userAddress1 = accounts[30];
    const userAddress2 = accounts[31];
    const userAddress3 = accounts[32];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
    const underlyingAgent2 = "Agent2";
    const underlyingAgent3 = "Agent3";
    const underlyingUser1 = "Minter1";
    const underlyingUser2 = "Minter2";

    const epochDuration = 1 * WEEKS;

    let commonContext: CommonContext;
    let context: AssetContext;
    let mockChain: MockChain;
    let assetManager: IIAssetManagerInstance;
    let fAsset: FAssetInstance;

    function epochAverage(cumulative: BNish) {
        return toBN(cumulative).divn(epochDuration);
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
        assetManager = context.assetManager;
        fAsset = context.fAsset;
        mockChain = context.chain as MockChain;
    });

    describe("transfer fees charging", () => {
        it("should charge transfer fee and agent can claim", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.lotSize().muln(100));
            const redeemer = await Redeemer.create(context, userAddress2, underlyingUser2);
            const agentInfo = await agent.getAgentInfo();
            await agent.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            mockChain.mine(10);
            await context.updateUnderlyingBlock();
            const currentEpoch = await assetManager.currentTransferFeeEpoch();
            // perform minting
            const lots = 3;
            const [minted] = await minter.performMinting(agent.vaultAddress, lots);
            // transfer and check that fee was subtracted
            const transferAmount = context.lotSize().muln(2);
            const transferFee = await calculateFee(transferAmount, false);
            const { 1: fee } = await context.fAsset.getReceivedAmount(minter.address, redeemer.address, transferAmount);
            assertWeb3Equal(transferFee, fee);
            const startBalanceM = await fAsset.balanceOf(minter.address);
            const startBalanceR = await fAsset.balanceOf(redeemer.address);
            const transfer = await minter.transferFAsset(redeemer.address, transferAmount);
            const endBalanceM = await fAsset.balanceOf(minter.address);
            const endBalanceR = await fAsset.balanceOf(redeemer.address);
            assertWeb3Equal(transfer.fee, transferFee);
            assert.isAbove(Number(transferFee), 100);
            assertWeb3Equal(endBalanceM, startBalanceM.sub(transferAmount));
            assertWeb3Equal(endBalanceR.sub(startBalanceR), transferAmount.sub(transferFee));
            // at this epoch, claimable amount should be 0, though fees are collected
            const epochData = await assetManager.transferFeeEpochData(currentEpoch);
            const claimableAmount0 = await agent.transferFeeShare(10);
            assertWeb3Equal(epochData.totalFees, transferFee);
            assertWeb3Equal(claimableAmount0, 0);
            // skip 1 epoch and claim
            await deterministicTimeIncrease(epochDuration);
            const claimableAmount1 = await agent.transferFeeShare(10);
            assertWeb3Equal(claimableAmount1, transferFee);
            const claimed = await agent.claimTransferFees(agent.ownerWorkAddress, 10);
            const ownerFBalance = await fAsset.balanceOf(agent.ownerWorkAddress);
            const poolFeeShare = transferFee.mul(toBN(agentInfo.poolFeeShareBIPS)).divn(MAX_BIPS);
            const agentFeeShare = transferFee.sub(poolFeeShare);
            assertWeb3Equal(ownerFBalance, agentFeeShare);
            assertWeb3Equal(agentFeeShare, claimed.agentClaimedUBA);
            assertWeb3Equal(poolFeeShare, claimed.poolClaimedUBA);
            const poolFBalance = await fAsset.balanceOf(agentInfo.collateralPool);
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
            const currentEpoch = await assetManager.currentTransferFeeEpoch();
            // perform minting and redemption
            const lots = 2;
            const [minted] = await minter.performMinting(agent.vaultAddress, lots);
            const [requests] = await redeemer.requestRedemption(lots);
            await agent.performRedemptions(requests);
            // only pool minting fee is minted now
            const agentInfo = await agent.getAgentInfo();
            assertWeb3Equal(agentInfo.mintedUBA, minted.poolFeeUBA);
            // and no fee was charged
            const epochData = await assetManager.transferFeeEpochData(currentEpoch);
            assertWeb3Equal(epochData.totalFees, 0);
        });

        it("agent self close with additional collateral provider (with debt) - after self close exit payout in vault collateral", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.underlyingAmount(1e8));
            const redeemer = await Redeemer.create(context, userAddress2, underlyingUser2);
            const fullAgentCollateral = toWei(1e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // minter mints
            const lots = 300;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash1 = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash1);
            // minter enters the pool
            const minterPoolDeposit1 = toWei(10000);
            const enterRes = await agent.collateralPool.enter(0, false, { from: minter.address, value: minterPoolDeposit1 });
            const minterPoolTokens = toBN(requiredEventArgs(enterRes, "Entered").receivedTokensWei);

            const vaultCollateralBalanceAgentBefore = await context.usdc.balanceOf(agent.agentVault.address);
            const vaultCollateralBalanceRedeemerBefore = await context.usdc.balanceOf(minter.address);

            // Approve enough fassets that will be needed in self close exit.
            await context.fAsset.approve(agent.collateralPool.address, 10000000000, { from: minter.address });

            // Self close exit with vault collateral payout
            const selfCloseAmount = minterPoolTokens;
            const fAssetBalanceBefore = await context.fAsset.balanceOf(minter.address);
            const fAssetReqForClose = await agent.collateralPool.fAssetRequiredForSelfCloseExit(selfCloseAmount);
            const { 1: transferFee } = await context.fAsset.getSendAmount(minter.address, agent.collateralPool.address, fAssetReqForClose);
            await deterministicTimeIncrease(await context.assetManager.getCollateralPoolTokenTimelockSeconds()); // wait for minted token timelock
            const response = await agent.collateralPool.selfCloseExit(selfCloseAmount, true, underlyingUser1, ZERO_ADDRESS, { from: minter.address });
            const receivedNat = await calculateReceivedNat(response, minter.address);
            const fAssetBalanceAfter = await context.fAsset.balanceOf(minter.address);
            assertWeb3Equal(fAssetBalanceBefore.sub(fAssetBalanceAfter), fAssetReqForClose.add(transferFee));

            const info = await agent.getAgentInfo();
            const natShare = toBN(info.totalPoolCollateralNATWei).mul(selfCloseAmount).div(await agent.collateralPoolToken.totalSupply());
            const vaultCollateralBalanceAgentAfter = await context.usdc.balanceOf(agent.agentVault.address);
            const vaultCollateralBalanceRedeemerAfter = await context.usdc.balanceOf(minter.address);
            assertWeb3Equal(vaultCollateralBalanceRedeemerAfter.sub(vaultCollateralBalanceRedeemerBefore), vaultCollateralBalanceAgentBefore.sub(vaultCollateralBalanceAgentAfter));
            assertWeb3Equal(receivedNat, natShare);
            expectEvent(response, "Exited");

            // send fAsset to agent so the agent can self close
            await context.fAsset.transfer(agent.ownerWorkAddress, fAssetBalanceAfter, { from: minter.address });
            await agent.withdrawPoolFees(await agent.poolFeeBalance(), agent.ownerWorkAddress);
            // skip 1 epoch and claim (multiple times)
            await deterministicTimeIncrease(epochDuration);
            await agent.claimTransferFees(agent.ownerWorkAddress, 10);
            await agent.withdrawPoolFees(await agent.poolFeeBalance(), agent.ownerWorkAddress);
            await deterministicTimeIncrease(epochDuration);
            await agent.claimTransferFees(agent.ownerWorkAddress, 10);
            await agent.withdrawPoolFees(await agent.poolFeeBalance(), agent.ownerWorkAddress);
            await deterministicTimeIncrease(epochDuration);
            await agent.claimTransferFees(agent.ownerWorkAddress, 10);
            const totalSupply = await context.fAsset.totalSupply();
            const [dustChanges, selfClosedUBA] = await agent.selfClose(totalSupply);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: crt.valueUBA.add(crt.feeUBA), mintedUBA: BN_ZERO });
            assertWeb3Equal(selfClosedUBA, totalSupply);
            assert.equal(dustChanges.length, 0);    // initially dust is cleared and then re-created
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("agent self close with additional collateral provider (no debt) - after self close exit payout in vault collateral", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.underlyingAmount(1e8));
            const redeemer = await Redeemer.create(context, userAddress2, underlyingUser2);
            const fullAgentCollateral = toWei(1e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // minter enters the pool
            const minterPoolDeposit1 = toWei(10000);
            const enterRes = await agent.collateralPool.enter(0, false, { from: minter.address, value: minterPoolDeposit1 });
            const minterPoolTokens = toBN(requiredEventArgs(enterRes, "Entered").receivedTokensWei);
            // minter mints
            const lots = 300;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash1 = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash1);

            const vaultCollateralBalanceAgentBefore = await context.usdc.balanceOf(agent.agentVault.address);
            const vaultCollateralBalanceRedeemerBefore = await context.usdc.balanceOf(minter.address);

            // Approve enough fassets that will be needed in self close exit.
            await context.fAsset.approve(agent.collateralPool.address, 10000000000, { from: minter.address });

            // Self close exit with vault collateral payout
            const selfCloseAmount = minterPoolTokens;
            const fAssetBalanceBefore = await context.fAsset.balanceOf(minter.address);
            const fAssetReqForClose = await agent.collateralPool.fAssetRequiredForSelfCloseExit(selfCloseAmount);
            assertWeb3Equal(fAssetReqForClose, 0);
            const fee = await agent.collateralPool.fAssetFeesOf(minter.address);
            const { 1: transferFee } = await context.fAsset.getReceivedAmount(minter.address, agent.collateralPool.address, fee);
            await deterministicTimeIncrease(await context.assetManager.getCollateralPoolTokenTimelockSeconds()); // wait for minted token timelock
            const response = await agent.collateralPool.selfCloseExit(selfCloseAmount, true, underlyingUser1, ZERO_ADDRESS, { from: minter.address });
            const receivedNat = await calculateReceivedNat(response, minter.address);
            const fAssetBalanceAfter = await context.fAsset.balanceOf(minter.address);
            assertWeb3Equal(fAssetBalanceAfter.sub(fAssetBalanceBefore), fee.sub(transferFee));

            const info = await agent.getAgentInfo();
            const natShare = toBN(info.totalPoolCollateralNATWei).mul(selfCloseAmount).div(await agent.collateralPoolToken.totalSupply());
            const vaultCollateralBalanceAgentAfter = await context.usdc.balanceOf(agent.agentVault.address);
            const vaultCollateralBalanceRedeemerAfter = await context.usdc.balanceOf(minter.address);
            assertWeb3Equal(vaultCollateralBalanceRedeemerAfter.sub(vaultCollateralBalanceRedeemerBefore), vaultCollateralBalanceAgentBefore.sub(vaultCollateralBalanceAgentAfter));
            assertWeb3Equal(receivedNat, natShare);
            expectEvent(response, "Exited");

            // send fAsset to agent so the agent can self close
            await context.fAsset.transfer(agent.ownerWorkAddress, fAssetBalanceAfter, { from: minter.address });
            await agent.withdrawPoolFees(await agent.poolFeeBalance(), agent.ownerWorkAddress);
            // skip 1 epoch and claim (multiple times)
            await deterministicTimeIncrease(epochDuration);
            await agent.claimTransferFees(agent.ownerWorkAddress, 10);
            await agent.withdrawPoolFees(await agent.poolFeeBalance(), agent.ownerWorkAddress);
            await deterministicTimeIncrease(epochDuration);
            await agent.claimTransferFees(agent.ownerWorkAddress, 10);
            await agent.withdrawPoolFees(await agent.poolFeeBalance(), agent.ownerWorkAddress);
            await deterministicTimeIncrease(epochDuration);
            await agent.claimTransferFees(agent.ownerWorkAddress, 10);
            const totalSupply = await context.fAsset.totalSupply();
            const [dustChanges, selfClosedUBA] = await agent.selfClose(totalSupply);
            await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: crt.valueUBA.add(crt.feeUBA), mintedUBA: BN_ZERO });
            assertWeb3Equal(selfClosedUBA, totalSupply);
            assert.equal(dustChanges.length, 0);    // initially dust is cleared and then re-created
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

    });

    describe("various ways of paying fee", () => {
        it("plain transfer - fee should be subtracted from the payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.lotSize().muln(100));
            await agent.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            mockChain.mine(10);
            await context.updateUnderlyingBlock();
            // settings
            const lotSize = context.lotSize();
            const eventDecoder = new Web3EventDecoder({ fAsset: context.fAsset })
            // perform minting
            const lots = 10;
            const [minted] = await minter.performMinting(agent.vaultAddress, lots);
            const transfer1LotFee = await calculateFee(lotSize, false);
            // transfer
            const startBalance1 = await fAsset.balanceOf(minter.address);
            const res1 = await fAsset.transfer(userAddress2, lotSize, { from: minter.address });
            const endBalance1 = await fAsset.balanceOf(minter.address);
            const received1 = await fAsset.balanceOf(userAddress2);
            const transfers1 = eventDecoder.filterEventsFrom(res1, context.fAsset, "Transfer");
            assert.equal(transfers1.length, 2);
            // check
            assertWeb3Equal(transfers1[0].args.from, minter.address);
            assertWeb3Equal(transfers1[0].args.to, userAddress2);
            assertWeb3Equal(transfers1[0].args.value, lotSize.sub(transfer1LotFee));
            assertWeb3Equal(transfers1[1].args.from, minter.address);
            assertWeb3Equal(transfers1[1].args.to, assetManager.address);
            assertWeb3Equal(transfers1[1].args.value, transfer1LotFee);
            assertWeb3Equal(startBalance1.sub(endBalance1), lotSize);
            assertWeb3Equal(received1, lotSize.sub(transfer1LotFee));
        });

        it("plain transferFrom - fee should be subtracted from the payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.lotSize().muln(100));
            await agent.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            mockChain.mine(10);
            await context.updateUnderlyingBlock();
            // settings
            const lotSize = context.lotSize();
            const eventDecoder = new Web3EventDecoder({ fAsset: context.fAsset })
            // perform minting
            const lots = 10;
            const [minted] = await minter.performMinting(agent.vaultAddress, lots);
            const transfer1LotFee = await calculateFee(lotSize, false);
            // approval is required
            await expectRevert(fAsset.transferFrom(minter.address, userAddress2, lotSize, { from: userAddress2 }), "ERC20: insufficient allowance");
            // approve and transfer
            await fAsset.approve(userAddress2, lotSize, { from: minter.address });
            const startBalance1 = await fAsset.balanceOf(minter.address);
            const res1 = await fAsset.transferFrom(minter.address, userAddress2, lotSize, { from: userAddress2 });
            const endBalance1 = await fAsset.balanceOf(minter.address);
            const received1 = await fAsset.balanceOf(userAddress2);
            const transfers1 = eventDecoder.filterEventsFrom(res1, context.fAsset, "Transfer");
            // check
            assert.equal(transfers1.length, 2);
            assertWeb3Equal(transfers1[0].args.from, minter.address);
            assertWeb3Equal(transfers1[0].args.to, userAddress2);
            assertWeb3Equal(transfers1[0].args.value, lotSize.sub(transfer1LotFee));
            assertWeb3Equal(transfers1[1].args.from, minter.address);
            assertWeb3Equal(transfers1[1].args.to, assetManager.address);
            assertWeb3Equal(transfers1[1].args.value, transfer1LotFee);
            assertWeb3Equal(startBalance1.sub(endBalance1), lotSize);
            assertWeb3Equal(received1, lotSize.sub(transfer1LotFee));
        });

        it("transferExactDest - fee should be additionally charged to the payer", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.lotSize().muln(100));
            await agent.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            mockChain.mine(10);
            await context.updateUnderlyingBlock();
            // settings
            const lotSize = context.lotSize();
            const eventDecoder = new Web3EventDecoder({ fAsset: context.fAsset })
            // perform minting
            const lots = 10;
            const [minted] = await minter.performMinting(agent.vaultAddress, lots);
            const transfer1LotFee = await calculateFee(lotSize, true);
            // transfer
            const startBalance1 = await fAsset.balanceOf(minter.address);
            const res1 = await fAsset.transferExactDest(userAddress2, lotSize, { from: minter.address });
            const endBalance1 = await fAsset.balanceOf(minter.address);
            const received1 = await fAsset.balanceOf(userAddress2);
            const transfers1 = eventDecoder.filterEventsFrom(res1, context.fAsset, "Transfer");
            assert.equal(transfers1.length, 2);
            // check
            assertWeb3Equal(transfers1[0].args.from, minter.address);
            assertWeb3Equal(transfers1[0].args.to, userAddress2);
            assertWeb3Equal(transfers1[0].args.value, lotSize);
            assertWeb3Equal(transfers1[1].args.from, minter.address);
            assertWeb3Equal(transfers1[1].args.to, assetManager.address);
            assertWeb3Equal(transfers1[1].args.value, transfer1LotFee);
            assertWeb3Equal(startBalance1.sub(endBalance1), lotSize.add(transfer1LotFee));
            assertWeb3Equal(received1, lotSize);
        });

        it("transferExactDestFrom - fee should be additionally charged to the payer", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.lotSize().muln(100));
            await agent.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            mockChain.mine(10);
            await context.updateUnderlyingBlock();
            // settings
            const lotSize = context.lotSize();
            const eventDecoder = new Web3EventDecoder({ fAsset: context.fAsset })
            // perform minting
            const lots = 10;
            const [minted] = await minter.performMinting(agent.vaultAddress, lots);
            const transfer1LotFee = await calculateFee(lotSize, true);
            // approval is required
            await expectRevert(fAsset.transferExactDestFrom(minter.address, userAddress2, lotSize, { from: userAddress2 }), "ERC20: insufficient allowance");
            // approval must include fee
            await fAsset.approve(userAddress2, lotSize, { from: minter.address });
            await expectRevert(fAsset.transferExactDestFrom(minter.address, userAddress2, lotSize, { from: userAddress2 }), "ERC20: insufficient allowance");
            // approve and transfer
            await fAsset.approve(userAddress2, lotSize.add(transfer1LotFee), { from: minter.address });
            const startBalance1 = await fAsset.balanceOf(minter.address);
            const res1 = await fAsset.transferExactDestFrom(minter.address, userAddress2, lotSize, { from: userAddress2 });
            const endBalance1 = await fAsset.balanceOf(minter.address);
            const received1 = await fAsset.balanceOf(userAddress2);
            const transfers1 = eventDecoder.filterEventsFrom(res1, context.fAsset, "Transfer");
            // check
            assert.equal(transfers1.length, 2);
            assertWeb3Equal(transfers1[0].args.from, minter.address);
            assertWeb3Equal(transfers1[0].args.to, userAddress2);
            assertWeb3Equal(transfers1[0].args.value, lotSize);
            assertWeb3Equal(transfers1[1].args.from, minter.address);
            assertWeb3Equal(transfers1[1].args.to, assetManager.address);
            assertWeb3Equal(transfers1[1].args.value, transfer1LotFee);
            assertWeb3Equal(startBalance1.sub(endBalance1), lotSize.add(transfer1LotFee));
            assertWeb3Equal(received1, lotSize);
        });
    });

    describe("transfer fee claim epochs", () => {
        it("current epoch should be same as first claimable at start", async () => {
            const currentEpoch = await assetManager.currentTransferFeeEpoch();
            const firstClaimableEpoch = await assetManager.firstClaimableTransferFeeEpoch();
            assertWeb3Equal(currentEpoch, 20);
            assertWeb3Equal(firstClaimableEpoch, 20);
        });

        it("multiple agents split the fees according to average minted amount", async () => {
            const agent1 = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            await agent1.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
            await agent2.depositCollateralsAndMakeAvailable(toWei(1e8), toWei(1e8));
            const agent3 = await Agent.createTest(context, agentOwner3, underlyingAgent3);  // do-nothing agent, just to test init
            const minter = await Minter.createTest(context, userAddress1, underlyingUser1, context.lotSize().muln(100));
            const redeemer = await Redeemer.create(context, userAddress2, underlyingUser2);
            mockChain.mine(10);
            await context.updateUnderlyingBlock();
            //
            const firstEpoch = Number(await assetManager.currentTransferFeeEpoch());
            const start = await time.latest();
            const trfSettings = await assetManager.transferFeeSettings();
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
            await agent1.withdrawPoolFees(await agent1.poolFeeBalance(), minter.address);
            //
            await time.increaseTo(start + 0.5 * epochDuration);
            await minter.transferFAsset(redeemer.address, lotSize.muln(30), true);
            const [rrqs1] = await redeemer.requestRedemption(20);
            await Agent.performRedemptions([agent1, agent2], rrqs1);
            await agent1.checkAgentInfo({ mintedUBA: toBN(lotSize).muln(0).add(poolFees1) });
            await agent2.checkAgentInfo({ mintedUBA: toBN(lotSize).muln(20).add(poolFees2) });
            //
            await time.increaseTo(start + 1.5 * epochDuration);
            await minter.transferFAsset(redeemer.address, lotSize.muln(10), true);
            const [rrqs2] = await redeemer.requestRedemption(20);
            await Agent.performRedemptions([agent1, agent2], rrqs2);
            await agent1.checkAgentInfo({ mintedUBA: toBN(lotSize).muln(0).add(poolFees1) });
            await agent2.checkAgentInfo({ mintedUBA: toBN(lotSize).muln(0).add(poolFees2) });
            //
            await time.increaseTo(start + 2.5 * epochDuration);
            // check unclaimed epochs
            const { 0: firstUnclaimed1, 1: totalUnclaimed1 } = await assetManager.agentUnclaimedTransferFeeEpochs(agent1.vaultAddress);
            assertWeb3Equal(firstUnclaimed1, 20);
            assertWeb3Equal(totalUnclaimed1, 2);
            const { 0: firstUnclaimed2, 1: totalUnclaimed2 } = await assetManager.agentUnclaimedTransferFeeEpochs(agent2.vaultAddress);
            assertWeb3Equal(firstUnclaimed2, 20);
            assertWeb3Equal(totalUnclaimed2, 2);
            const { 0: firstUnclaimed3, 1: totalUnclaimed3 } = await assetManager.agentUnclaimedTransferFeeEpochs(agent3.vaultAddress);
            assertWeb3Equal(firstUnclaimed3, 20);
            assertWeb3Equal(totalUnclaimed3, 2);
            const totalFeeAgent1 = await assetManager.agentTransferFeeShare(agent1.vaultAddress, 10);
            const totalFeeAgent2 = await assetManager.agentTransferFeeShare(agent2.vaultAddress, 10);
            const totalFeeAgent3 = await assetManager.agentTransferFeeShare(agent3.vaultAddress, 10);
            // we can also do init agents now, it should be a no-op
            await assetManager.initAgentsMintingHistory([agent1.vaultAddress, agent2.vaultAddress]);
            // check unclaimed epochs again - should be equal
            const { 0: firstUnclaimed1a, 1: totalUnclaimed1a } = await assetManager.agentUnclaimedTransferFeeEpochs(agent1.vaultAddress);
            assertWeb3Equal(firstUnclaimed1a, 20);
            assertWeb3Equal(totalUnclaimed1a, 2);
            assertWeb3Equal(totalFeeAgent1, await assetManager.agentTransferFeeShare(agent1.vaultAddress, 10));
            const { 0: firstUnclaimed2a, 1: totalUnclaimed2a } = await assetManager.agentUnclaimedTransferFeeEpochs(agent2.vaultAddress);
            assertWeb3Equal(firstUnclaimed2a, 20);
            assertWeb3Equal(totalUnclaimed2a, 2);
            assertWeb3Equal(totalFeeAgent2, await assetManager.agentTransferFeeShare(agent2.vaultAddress, 10));
            const { 0: firstUnclaimed3a, 1: totalUnclaimed3a } = await assetManager.agentUnclaimedTransferFeeEpochs(agent3.vaultAddress);
            assertWeb3Equal(firstUnclaimed3a, 20);
            assertWeb3Equal(totalUnclaimed3a, 2);
            assertWeb3Equal(totalFeeAgent3, await assetManager.agentTransferFeeShare(agent3.vaultAddress, 10));
            // backing for epoch1: total = 40 lots for 1/2 epoch, 20 lots for 1/2 epoch = 30 lots avg
            //   ag1: 10 lots for 1/2 epoch -> 10 * 1/2 / 30 = 1/6 share
            //   ag2: 30 lots for 1/2 epoch, 20 lots for 1/2 epoch -> (30 * 1/2 + 20 * 1/2) / 30 = 25/30 = 5/6 share
            // backing for epoch2: total = 20 lots for 1/2 epoch = 10 lots avg
            //   ag1: 0
            //   ag2: 20 lots for 1/2 epoch -> 10 / 10 = 25/30 = 1 share
            const ep1agent1 = await assetManager.transferFeeCalculationDataForAgent(agent1.vaultAddress, firstEpoch);
            const ep1agent2 = await assetManager.transferFeeCalculationDataForAgent(agent2.vaultAddress, firstEpoch);
            const ep2agent1 = await assetManager.transferFeeCalculationDataForAgent(agent1.vaultAddress, firstEpoch + 1);
            const ep2agent2 = await assetManager.transferFeeCalculationDataForAgent(agent2.vaultAddress, firstEpoch + 1);
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
            // fees should be split accordingly
            const fee1agent1 = await assetManager.agentTransferFeeShareForEpoch(agent1.vaultAddress, firstEpoch);
            const fee1agent2 = await assetManager.agentTransferFeeShareForEpoch(agent2.vaultAddress, firstEpoch);
            const fee2agent1 = await assetManager.agentTransferFeeShareForEpoch(agent1.vaultAddress, firstEpoch + 1);
            const fee2agent2 = await assetManager.agentTransferFeeShareForEpoch(agent2.vaultAddress, firstEpoch + 1);
            assertApproximatelyEqual(fee1agent1, toBN(ep1agent1.cumulativeMinted).mul(toBN(ep1agent1.totalFees)).div(toBN(ep1agent1.totalCumulativeMinted)), 'relative', 1e-3);
            assertApproximatelyEqual(fee1agent2, toBN(ep1agent2.cumulativeMinted).mul(toBN(ep1agent2.totalFees)).div(toBN(ep1agent2.totalCumulativeMinted)), 'relative', 1e-3);
            assertApproximatelyEqual(fee2agent1, toBN(ep2agent1.cumulativeMinted).mul(toBN(ep2agent1.totalFees)).div(toBN(ep2agent1.totalCumulativeMinted)), 'relative', 1e-3);
            assertApproximatelyEqual(fee2agent2, toBN(ep2agent2.cumulativeMinted).mul(toBN(ep2agent2.totalFees)).div(toBN(ep2agent2.totalCumulativeMinted)), 'relative', 1e-3);
            // total fees should match
            assertWeb3Equal(totalFeeAgent1, fee1agent1.add(fee2agent1));
            assertWeb3Equal(totalFeeAgent2, fee1agent2.add(fee2agent2));
            assertWeb3Equal(totalFeeAgent3, 0);
            // claimed amounts should match
            const agent1balPre = await fAsset.balanceOf(agent1.ownerWorkAddress);
            const agent1claim = await agent1.claimTransferFees(agent1.ownerWorkAddress, 10);
            const agent1balPost = await fAsset.balanceOf(agent1.ownerWorkAddress);
            assertWeb3Equal(toBN(agent1claim.agentClaimedUBA).add(toBN(agent1claim.poolClaimedUBA)), totalFeeAgent1);
            assertWeb3Equal(agent1balPost.sub(agent1balPre), agent1claim.agentClaimedUBA);
            //
            const agent2balPre = await fAsset.balanceOf(agent2.ownerWorkAddress);
            const agent2claim = await agent2.claimTransferFees(agent2.ownerWorkAddress, 10);
            const agent2balPost = await fAsset.balanceOf(agent2.ownerWorkAddress);
            assertWeb3Equal(toBN(agent2claim.agentClaimedUBA).add(toBN(agent2claim.poolClaimedUBA)), totalFeeAgent2);
            assertWeb3Equal(agent2balPost.sub(agent2balPre), agent2claim.agentClaimedUBA);
        });
    });

    describe("transfer fee settings", () => {
        it("transfer fee share can be updated with scheduled effect", async () => {
            const startTime = await time.latest();
            // will use time.increaseTo(currentTime += ...) instead of deterministicTimeIncrease(...) because time can unexpectedly jump a lot on CI
            let currentTime = startTime;
            const startFee = await assetManager.transferFeeMillionths();
            assertWeb3Equal(startFee, 200);
            // update fee to 500 in 100 sec
            await context.assetManagerController.setTransferFeeMillionths([assetManager.address], 500, startTime + 200, { from: governance});
            assertWeb3Equal(await assetManager.transferFeeMillionths(), startFee);
            await time.increaseTo(currentTime += 100);
            assertWeb3Equal(await assetManager.transferFeeMillionths(), startFee);
            await time.increaseTo(currentTime += 100);
            assertWeb3Equal(await assetManager.transferFeeMillionths(), 500);
            // updating is rate-limited
            await expectRevert(context.assetManagerController.setTransferFeeMillionths([assetManager.address], 400, await time.latest() + 200, { from: governance }),
                "too close to previous update");
            // update fee again, to 400
            await time.increaseTo(currentTime += 1 * DAYS);  // skip to avoid too close updates
            await context.assetManagerController.setTransferFeeMillionths([assetManager.address], 400, await time.latest() + 200, { from: governance });
            assertWeb3Equal(await assetManager.transferFeeMillionths(), 500);
            await time.increaseTo(currentTime += 100);
            assertWeb3Equal(await assetManager.transferFeeMillionths(), 500);
            await time.increaseTo(currentTime += 100);
            assertWeb3Equal(await assetManager.transferFeeMillionths(), 400);
            // update in past/now/0 updates immediately
            await time.increaseTo(currentTime += 1 * DAYS);
            await context.assetManagerController.setTransferFeeMillionths([assetManager.address], 300, startTime, { from: governance });
            assertWeb3Equal(await assetManager.transferFeeMillionths(), 300);
            await time.increaseTo(currentTime += 1 * DAYS);
            await context.assetManagerController.setTransferFeeMillionths([assetManager.address], 150, await time.latest() + 1, { from: governance });
            assertWeb3Equal(await assetManager.transferFeeMillionths(), 150);
            await time.increaseTo(currentTime += 1 * DAYS);
            await context.assetManagerController.setTransferFeeMillionths([assetManager.address], 100, 0, { from: governance });
            assertWeb3Equal(await assetManager.transferFeeMillionths(), 100);
        });

        it("calculating received amount and fee", async () => {
            for (let i = 0; i < 1000; i++) {
                const amount = toBNExp(Math.random(), 20);
                // calculate fee
                const fee = await calculateFee(amount, false);
                // calculate amounts and fees
                const { 0: receivedAmount, 1: payedFee } = await fAsset.getReceivedAmount(accounts[0], accounts[1], amount);
                const { 0: sendAmount, 1: payedFee2 } = await fAsset.getSendAmount(accounts[0], accounts[1], receivedAmount);
                assertWeb3Equal(payedFee, fee);
                assertWeb3Equal(receivedAmount, amount.sub(fee));
                assertWeb3Equal(payedFee2, fee);
                assertWeb3Equal(sendAmount, amount);
            }
        });

        it("calculating send amount to receive given amount", async () => {
            for (let i = 0; i < 1000; i++) {
                const amount = toBNExp(Math.random(), 20);
                // calculate fee
                const fee = await calculateFee(amount, true);
                // calculate required send amount to receive `amount`
                const { 0: sendAmount, 1: payedFee } = await fAsset.getSendAmount(accounts[0], accounts[1], amount);
                const { 0: receivedAmount, 1: payedFee2 } = await fAsset.getReceivedAmount(accounts[0], accounts[1], sendAmount);
                // calculate amounts and fees
                assertWeb3Equal(payedFee, fee);
                assertWeb3Equal(sendAmount.sub(fee), amount);
                assertWeb3Equal(payedFee2, fee);
                assertWeb3Equal(receivedAmount, amount);
            }
        });
    });

    async function calculateFee(amount: BNish, exactDest: boolean) {
        const transferFeeMillionths = await assetManager.transferFeeMillionths();
        const mul = toBN(amount).mul(transferFeeMillionths)
        const div = toBN(1e6).sub(exactDest ? transferFeeMillionths : BN_ZERO);
        if (mul.mod(div).isZero()) {
            return mul.div(div);
        } else {
            return mul.div(div).addn(1);
        }
    }
});
