import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { filterEvents } from "../../../lib/utils/events/truffle";
import { DAYS, HOURS, toBN, toWei, ZERO_ADDRESS } from "../../../lib/utils/helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo } from "../utils/TestChainInfo";
import { AgentStatus } from "../../../lib/fasset/AssetManagerTypes";
import { executeTimelockedGovernanceCall } from "../../utils/contract-test-helpers";

contract(`AssetManagerSimulation.sol; ${getTestFile(__filename)}; Asset manager simulations`, async accounts => {
    const governance = accounts[10];
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[21];
    const agentOwner3 = accounts[22];
    const minterAddress1 = accounts[30];
    const minterAddress2 = accounts[31];
    const minterAddress3 = accounts[32];
    const redeemerAddress1 = accounts[40];
    const redeemerAddress2 = accounts[41];
    const redeemerAddress3 = accounts[42];
    const challengerAddress1 = accounts[50];
    const challengerAddress2 = accounts[51];
    const liquidatorAddress1 = accounts[60];
    const liquidatorAddress2 = accounts[61];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
    const underlyingAgent2 = "Agent2";
    const underlyingAgent3 = "Agent3";
    const underlyingMinter1 = "Minter1";
    const underlyingMinter2 = "Minter2";
    const underlyingMinter3 = "Minter3";
    const underlyingRedeemer1 = "Redeemer1";
    const underlyingRedeemer2 = "Redeemer2";
    const underlyingRedeemer3 = "Redeemer3";
    const coreVaultUnderlyingAddress = "CORE_VAULT_UNDERLYING";

    let commonContext: CommonContext;
    let context: AssetContext;
    let mockChain: MockChain;

    async function initialize() {
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.xrp, { coreVaultUnderlyingAddress });
        return { commonContext, context };
    }

    beforeEach(async () => {
        ({ commonContext, context } = await loadFixtureCopyVars(initialize));
        mockChain = context.chain as MockChain;
    });

    it("should transfer all backing to core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        const cv = await Redeemer.create(context, context.initSettings.coreVaultNativeAddress, coreVaultUnderlyingAddress);
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // minter2 also deposits to pool (so some fasset fees will go to them)
        await agent.collateralPool.enter(0, false, { from: minterAddress2, value: toWei(3e8) });
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        // update time
        await context.updateUnderlyingBlock();
        const { 0: currentBlock, 1: currentTimestamp } = await context.assetManager.currentUnderlyingBlock();
        // agent requests transfer for all backing to core vault
        const info = await agent.getAgentInfo();
        const transferAmount = info.mintedUBA;
        // calculate the transfer fee
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        await expectRevert(context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee.subn(1) }),
            "transfer fee payment too small");
        // transfer request
        const res = await context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee });
        expectEvent(res, "CoreVaultTransferStarted", { agentVault: agent.vaultAddress, valueUBA: info.mintedUBA });
        const rdreqs = filterEvents(res, "RedemptionRequested").map(evt => evt.args);
        assertWeb3Equal(rdreqs.length, 1);
        assertWeb3Equal(rdreqs[0].valueUBA, info.mintedUBA);
        assertWeb3Equal(rdreqs[0].feeUBA, 0);
        assert.isAbove(Number(rdreqs[0].lastUnderlyingTimestamp), mockChain.currentTimestamp() + 365 * DAYS);   // payment time should be huge (> 1 year)
        // wait 20 blocks and 1 hour - transfer can be defaulted without time extension
        context.skipToExpiration(currentBlock.addn(20), currentTimestamp.addn(1 * HOURS));
        await expectRevert(cv.redemptionPaymentDefault(rdreqs[0]), "overflow block not found");
        // perform transfer of underlying
        const resps = await agent.performRedemptions(rdreqs);
        // check that CoreVaultTransferSuccessful event was emitted
        const transferRes = resps[String(rdreqs[0].requestId)];
        assert(transferRes != null);
        expectEvent(transferRes, "CoreVaultTransferSuccessful");
        await expectEvent.inTransaction(transferRes.tx, context.coreVaultManager!, "PaymentConfirmed",
            { paymentReference: rdreqs[0].paymentReference, amount: transferAmount });
        // agent now has 0 backing
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: 0, redeemingUBA: 0, dustUBA: 0, requiredUnderlyingBalanceUBA: 0 }, "reset");
        // all backing has been transferred from agent's underlying address
        assertWeb3Equal(await mockChain.getBalance(agent.underlyingAddress), minted.agentFeeUBA);
        assertWeb3Equal(await mockChain.getBalance(coreVaultUnderlyingAddress), toBN(minted.mintedAmountUBA).add(minted.poolFeeUBA));
        // normal redemption requests are now impossible
        await expectRevert(context.assetManager.redeem(10, redeemer.underlyingAddress, ZERO_ADDRESS, { from: redeemer.address }),
            "redeem 0 lots");
    });

    it("should transfer partial backing to core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        // agent requests transfer for all backing to core vault
        const transferAmount = context.lotSize().muln(5);
        const remainingTicketAmount = context.lotSize().muln(5);
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = await context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee });
        const rdreqs = filterEvents(res, "RedemptionRequested").map(evt => evt.args);
        assertWeb3Equal(rdreqs.length, 1);
        assertWeb3Equal(rdreqs[0].valueUBA, transferAmount);
        assertWeb3Equal(rdreqs[0].feeUBA, 0);
        // perform transfer of underlying
        await agent.performRedemptions(rdreqs);
        // agent now has approx half backing left
        const expectRemainingMinted = remainingTicketAmount.add(toBN(minted.poolFeeUBA));
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: expectRemainingMinted, redeemingUBA: 0 }, "reset");
        // redemption requests are now partial
        const redemptionRes = await context.assetManager.redeem(10, redeemer.underlyingAddress, ZERO_ADDRESS, { from: redeemer.address });
        expectEvent(redemptionRes, "RedemptionRequested", { agentVault: agent.vaultAddress, valueUBA: remainingTicketAmount });
        expectEvent(redemptionRes, "RedemptionRequestIncomplete");
    });

    it("modify core vault settings", async () => {
        // // update address
        // await context.assetManager.setCoreVaultAddress(accounts[31], "SOME_NEW_ADDRESS", { from: context.governance });
        let settings = await context.assetManager.getCoreVaultSettings();
        // assertWeb3Equal(settings.nativeAddress, accounts[31]);
        // assertWeb3Equal(settings.underlyingAddressString, "SOME_NEW_ADDRESS");
        // update transfer fee
        await context.assetManager.setCoreVaultTransferFeeBIPS(123, { from: context.governance });
        settings = await context.assetManager.getCoreVaultSettings();
        assertWeb3Equal(settings.transferFeeBIPS, 123);
        // update redemption fee
        await context.assetManager.setCoreVaultRedemptionFeeBIPS(211, { from: context.governance });
        settings = await context.assetManager.getCoreVaultSettings();
        assertWeb3Equal(settings.redemptionFeeBIPS, 211);
    });

    it("core vault setting modification requires governance call", async () => {
        // await expectRevert(context.assetManager.setCoreVaultAddress(accounts[31], "SOME_NEW_ADDRESS"), "only governance");
        await expectRevert(context.assetManager.setCoreVaultTransferFeeBIPS(123), "only governance");
        await expectRevert(context.assetManager.setCoreVaultRedemptionFeeBIPS(211), "only governance");
    });

    it("core vault address setting is timelocked, the others aren't", async () => {
        let timelocked: boolean;
        await context.assetManager.switchToProductionMode({ from: context.governance });
        // // address is timelocked
        // timelocked = await executeTimelockedGovernanceCall(context.assetManager,
        //     (governance) => context.assetManager.setCoreVaultAddress(accounts[31], "SOME_NEW_ADDRESS", { from: governance }));
        // assert.equal(timelocked, true);
        // others aren't timelocked
        timelocked = await executeTimelockedGovernanceCall(context.assetManager,
            (governance) => context.assetManager.setCoreVaultTransferFeeBIPS(123, { from: governance }));
        assert.equal(timelocked, false);
        //
        timelocked = await executeTimelockedGovernanceCall(context.assetManager,
            (governance) => context.assetManager.setCoreVaultRedemptionFeeBIPS(211, { from: governance }));
        assert.equal(timelocked, false);
    });
});
