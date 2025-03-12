import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { filterEvents } from "../../../lib/utils/events/truffle";
import { DAYS, HOURS, toBN, toWei, ZERO_ADDRESS } from "../../../lib/utils/helpers";
import { MockChain, MockChainWallet } from "../../utils/fasset/MockChain";
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
import { requiredEventArgsFrom } from "../../utils/Web3EventDecoder";

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
    const triggeringAccount = accounts[5];
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
        await context.coreVaultManager!.addTriggeringAccounts([triggeringAccount], { from: governance });
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
        await expectEvent.inTransaction(transferRes.tx, context.coreVaultManager!, "PaymentConfirmed", { amount: transferAmount });
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
        // agent requests transfer for half backing to core vault
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

    it("request return from core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        // allow CV manager addresses
        await context.coreVaultManager!.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        // agent requests transfer for some backing to core vault
        const transferAmount = context.lotSize().muln(5);
        const remainingTicketAmount = context.lotSize().muln(5);
        await agent.transferToCoreVault(transferAmount);
        // second agent requests return from CV
        const rres = await context.assetManager.requestReturnFromCoreVault(agent2.vaultAddress, 5, { from: agent2.ownerWorkAddress });
        const transferRequested = requiredEventArgsFrom(rres, context.coreVaultManager!, "TransferRequested");
        assert.equal(transferRequested.cancelable, true);
        assert.equal(transferRequested.destinationAddress, agent2.underlyingAddress);
        assertWeb3Equal(transferRequested.amount, context.lotSize().muln(5));
        // trigger CV requests
        const trigRes = await context.coreVaultManager!.triggerInstructions({ from: triggeringAccount });
        const paymentReqs = filterEvents(trigRes, "PaymentInstructions");
        assert.equal(paymentReqs.length, 1);
        assertWeb3Equal(paymentReqs[0].args.account, coreVaultUnderlyingAddress);
        assertWeb3Equal(paymentReqs[0].args.destination, agent2.underlyingAddress);
        assertWeb3Equal(paymentReqs[0].args.amount, transferRequested.amount);
        // simulate transfer from CV
        const wallet = new MockChainWallet(mockChain);
        for (const req of paymentReqs) {
            const rtx = await wallet.addTransaction(req.args.account, req.args.destination, req.args.amount, null);
            const proof = await context.attestationProvider.provePayment(rtx, req.args.account, req.args.destination);
            await expectRevert(context.assetManager.confirmReturnFromCoreVault(proof, agent.vaultAddress, { from: agent.ownerWorkAddress }),
                "payment not to agent's address");
            await context.assetManager.confirmReturnFromCoreVault(proof, agent2.vaultAddress, { from: agent2.ownerWorkAddress });
        }
        // agent now has approx half backing left
        const expectRemainingMinted = remainingTicketAmount.add(toBN(minted.poolFeeUBA));
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: expectRemainingMinted, redeemingUBA: 0 }, "reset");
        // second agent has approx the other half
        await agent2.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: transferRequested.amount, redeemingUBA: 0 }, "reset");
        // redemption requests are split over two agents
        const redemptionRes = await context.assetManager.redeem(10, redeemer.underlyingAddress, ZERO_ADDRESS, { from: redeemer.address });
        expectEvent(redemptionRes, "RedemptionRequested", { agentVault: agent.vaultAddress, valueUBA: remainingTicketAmount });
        expectEvent(redemptionRes, "RedemptionRequested", { agentVault: agent2.vaultAddress, valueUBA: transferRequested.amount });
        expectEvent.notEmitted(redemptionRes, "RedemptionRequestIncomplete");
    });

    it("request return from core vault and then cancel", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        // allow CV manager addresses
        await context.coreVaultManager!.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        // agent requests transfer for some backing to core vault
        const transferAmount = context.lotSize().muln(5);
        await agent.transferToCoreVault(transferAmount);
        // second agent requests return from CV
        const rres = await context.assetManager.requestReturnFromCoreVault(agent2.vaultAddress, 5, { from: agent2.ownerWorkAddress });
        // now the second agent cancels the request
        await context.assetManager.cancelReturnFromCoreVault(agent2.vaultAddress, { from: agent2.ownerWorkAddress });
        // trigger CV requests
        const trigRes = await context.coreVaultManager!.triggerInstructions({ from: triggeringAccount });
        const paymentReqs = filterEvents(trigRes, "PaymentInstructions");
        assert.equal(paymentReqs.length, 0);
    });

    it("test checks in request return from core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        // allow CV manager addresses
        await context.coreVaultManager!.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        // agent requests transfer for some backing to core vault
        const transferAmount = context.lotSize().muln(10);
        await agent.transferToCoreVault(transferAmount);
        // target underlying address must be allowed
        await expectRevert(context.assetManager.requestReturnFromCoreVault(agent.vaultAddress, 10, { from: agent.ownerWorkAddress }),
            "agent's underlying address not allowed by core vault");
        // must request more than 0 lots
        await expectRevert(context.assetManager.requestReturnFromCoreVault(agent2.vaultAddress, 0, { from: agent2.ownerWorkAddress }),
            "cannot return 0 lots");
        // requested redeem amount cannot be more than total available amount on core vault
        await expectRevert(context.assetManager.requestReturnFromCoreVault(agent2.vaultAddress, 20, { from: agent2.ownerWorkAddress }),
            "not enough available on core vault");
    });

    it("request direct redemption from core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        // allow CV manager addresses
        await context.coreVaultManager!.addAllowedDestinationAddresses([redeemer.underlyingAddress], { from: governance });
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        await minter.transferFAsset(redeemer.address, minted.mintedAmountUBA);
        // agent requests transfer for some backing to core vault
        const transferAmount = context.convertLotsToUBA(10);
        await agent.transferToCoreVault(transferAmount);
        // redeemer requests direct redemption from CV
        await context.assetManager.redeemFromCoreVault(10, redeemer.underlyingAddress, { from: redeemer.address });
        // trigger CV requests
        const trigRes = await context.coreVaultManager!.triggerInstructions({ from: triggeringAccount });
        const paymentReqs = filterEvents(trigRes, "PaymentInstructions");
        assert.equal(paymentReqs.length, 1);
        assertWeb3Equal(paymentReqs[0].args.account, coreVaultUnderlyingAddress);
        assertWeb3Equal(paymentReqs[0].args.destination, redeemer.underlyingAddress);
        assertWeb3Equal(paymentReqs[0].args.amount, context.convertLotsToUBA(10));
        // simulate transfer from CV
        const wallet = new MockChainWallet(mockChain);
        for (const req of paymentReqs) {
            await wallet.addTransaction(req.args.account, req.args.destination, req.args.amount, null);
        }
        assertWeb3Equal(await mockChain.getBalance(redeemer.underlyingAddress), context.convertLotsToUBA(10));
    });

    it("test checks in request direct redemption from core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        // allow CV manager addresses
        await context.coreVaultManager!.addAllowedDestinationAddresses([redeemer.underlyingAddress], { from: governance });
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        await minter.transferFAsset(redeemer.address, minted.mintedAmountUBA);
        // agent requests transfer for some backing to core vault
        const transferAmount = context.lotSize().muln(10);
        await agent.transferToCoreVault(transferAmount);
        // target underlying address must be allowed
        await expectRevert(context.assetManager.redeemFromCoreVault(10, minter.underlyingAddress, { from: minter.address }),
            "underlying address not allowed by core vault");
        // requesting address must have enough fassets
        await expectRevert(context.assetManager.redeemFromCoreVault(10, redeemer.underlyingAddress, { from: accounts[0] }),
            "f-asset balance too low");
        // requested redeem amount must be larger than `minimumRedeemLots` of lots
        await expectRevert(context.assetManager.redeemFromCoreVault(5, redeemer.underlyingAddress, { from: redeemer.address }),
            "requested amount too small");
        // requested redeem amount cannot be more than total available amount on core vault
        await expectRevert(context.assetManager.redeemFromCoreVault(11, redeemer.underlyingAddress, { from: redeemer.address }),
            "not enough available on core vault");
    });

    it("modify core vault settings", async () => {
        // // update address
        // await context.assetManager.setCoreVaultAddress(accounts[31], "SOME_NEW_ADDRESS", { from: context.governance });
        // let settings = await context.assetManager.getCoreVaultSettings();
        // assertWeb3Equal(settings.nativeAddress, accounts[31]);
        // assertWeb3Equal(settings.underlyingAddressString, "SOME_NEW_ADDRESS");
        // update transfer fee
        await context.assetManager.setCoreVaultTransferFeeBIPS(123, { from: context.governance });
        assertWeb3Equal(await context.assetManager.getCoreVaultTransferFeeBIPS(), 123);
        // update redemption fee
        await context.assetManager.setCoreVaultRedemptionFeeBIPS(211, { from: context.governance });
        assertWeb3Equal(await context.assetManager.getCoreVaultRedemptionFeeBIPS(), 211);
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
