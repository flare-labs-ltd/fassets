import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { filterEvents, requiredEventArgs } from "../../../lib/utils/events/truffle";
import { BNish, DAYS, HOURS, MAX_BIPS, requireNotNull, toBN, toWei, ZERO_ADDRESS } from "../../../lib/utils/helpers";
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
import { PaymentReference } from "../../../lib/fasset/PaymentReference";

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
        await context.coreVaultManager!.updateSettings(0, 0, 0, 50, { from: governance });
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
        expectEvent(res, "TransferToCoreVaultStarted", { agentVault: agent.vaultAddress, valueUBA: info.mintedUBA });
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
        // check that TransferToCoreVaultSuccessful event was emitted
        const transferRes = resps[String(rdreqs[0].requestId)];
        assert(transferRes != null);
        expectEvent(transferRes, "TransferToCoreVaultSuccessful");
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

    it("should not transfer to core vault if agent in full liquidation", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        const lots = 10;
        const [minted, crt, txHash] = await minter.performMinting(agent.vaultAddress, lots);

        await agent.poolCRFee(lots);
        assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
        // perform illegal payment
        await agent.performPayment("IllegalPayment1", 100);
        // challenge agent for illegal payment
        const proof = await context.attestationProvider.proveBalanceDecreasingTransaction(txHash, agent.underlyingAddress);
        await context.assetManager.illegalPaymentChallenge(proof, agent.agentVault.address, { from: accounts[1234] });
        const agentInfo = await agent.getAgentInfo();
        const agentStatus = Number(agentInfo.status) as AgentStatus;
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);

        // agent requests transfer for half backing to core vault
        const transferAmount = context.lotSize().muln(10);
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee });
        await expectRevert(res, "invalid agent status");
    });

    it("should not transfer to core vault if not enough underlying", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        const lots = 3;
        const [minted] = await minter.performMinting(agent.vaultAddress, lots);

        await agent.poolCRFee(lots);
        assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
        const mintedAmount = toBN(minted.mintedAmountUBA).add(minted.poolFeeUBA);
        // perform illegal payment
        await agent.performPayment("IllegalPayment1", 100);

        // agent requests transfer for all backing to core vault
        const transferAmount = context.lotSize().muln(10);
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee });
        await expectRevert(res, "not enough underlying");
    });

    it("should not transfer to core vault if transfer is already active", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        await minter.performMinting(agent.vaultAddress, 10);
        // agent requests transfer for half backing to core vault
        const transferAmount = context.lotSize().muln(5);
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        await context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee });

        // try to transfer again
        const res = context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee });
        await expectRevert(res, "transfer already active");
    });

    it("should not transfer to core vault if too little minting left", async () => {
        await context.assetManager.setCoreVaultMinimumAmountLeftBIPS(10, { from: context.governance });
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        await minter.performMinting(agent.vaultAddress, 5);
        const redemptionRes = await context.assetManager.redeem(5, minter.underlyingAddress, ZERO_ADDRESS, { from: minter.address });
        // agent requests transfer for half backing to core vault
        const transferAmount = context.lotSize().muln(4);
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee });
        await expectRevert(res, "too little minting left after transfer");
    });

    it("should cancel transfer to core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        // another mint, just to prevent merging tickets
        await minter.performMinting(agent2.vaultAddress, 1);
        // agent requests transfer for half backing to core vault
        const totalMintedAmount = toBN(minted.mintedAmountUBA).add(toBN(minted.poolFeeUBA));
        const transferAmount = context.lotSize().muln(5);
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = await context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee });
        const rdreqs = filterEvents(res, "RedemptionRequested").map(evt => evt.args);
        assertWeb3Equal(rdreqs.length, 1);
        // agent now has approx half backing in redeeming state
        const expectRemainingMinted = totalMintedAmount.sub(transferAmount);
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: expectRemainingMinted, redeemingUBA: transferAmount }, "reset");
        // agent cancels transfer request
        const cancelRes = await context.assetManager.cancelTransferToCoreVault(agent.vaultAddress, { from: agent.ownerWorkAddress });
        expectEvent(cancelRes, "TransferToCoreVaultCancelled", { agentVault: agent.vaultAddress, transferRedemptionRequestId: rdreqs[0].requestId });
        // proving transfer of underlying should fail
        await expectRevert(agent.performRedemptions(rdreqs), "invalid request id");
        // agent now has again full backing left
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: totalMintedAmount, redeemingUBA: 0 }, "reset");
        // redemption queue now has two tickets of 5 lots (and 1 by agent2)
        const queue = await context.getRedemptionQueue();
        assert.equal(queue.length, 3);
        assertWeb3Equal(queue[0].ticketValueUBA, context.lotSize().muln(5));
        assertWeb3Equal(queue[1].ticketValueUBA, context.lotSize());
        assertWeb3Equal(queue[2].ticketValueUBA, context.lotSize().muln(5));
        // redemption of all lots can go through
        const redemptionRes = await context.assetManager.redeem(11, redeemer.underlyingAddress, ZERO_ADDRESS, { from: redeemer.address });
        expectEvent(redemptionRes, "RedemptionRequested", { agentVault: agent.vaultAddress, valueUBA: minted.mintedAmountUBA });
        expectEvent.notEmitted(redemptionRes, "RedemptionRequestIncomplete");
    });

    it("confirming failed transfer payment acts like cancel", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        // another mint, just to prevent merging tickets
        await minter.performMinting(agent2.vaultAddress, 1);
        // agent requests transfer for half backing to core vault
        const totalMintedAmount = toBN(minted.mintedAmountUBA).add(toBN(minted.poolFeeUBA));
        const transferAmount = context.lotSize().muln(5);
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = await context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee });
        const rdreqs = filterEvents(res, "RedemptionRequested").map(evt => evt.args);
        assertWeb3Equal(rdreqs.length, 1);
        // agent now has approx half backing in redeeming state
        const expectRemainingMinted = totalMintedAmount.sub(transferAmount);
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: expectRemainingMinted, redeemingUBA: transferAmount }, "reset");
        // agent makes and proves redemption payment with wrong amount
        const request = rdreqs[0];
        const txHash = await agent.performPayment(request.paymentAddress, 1, request.paymentReference);
        const proof = await context.attestationProvider.provePayment(txHash, agent.underlyingAddress, request.paymentAddress);
        const paymentRes = await context.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: agent.ownerWorkAddress });
        expectEvent(paymentRes, "RedemptionPaymentFailed");
        // agent now has again full backing left
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: totalMintedAmount, redeemingUBA: 0 }, "reset");
        // redemption queue now has two tickets of 5 lots (and 1 by agent2)
        const queue = await context.getRedemptionQueue();
        assert.equal(queue.length, 3);
        assertWeb3Equal(queue[0].ticketValueUBA, context.lotSize().muln(5));
        assertWeb3Equal(queue[1].ticketValueUBA, context.lotSize());
        assertWeb3Equal(queue[2].ticketValueUBA, context.lotSize().muln(5));
        // redemption of all lots can go through
        const redemptionRes = await context.assetManager.redeem(11, redeemer.underlyingAddress, ZERO_ADDRESS, { from: redeemer.address });
        expectEvent(redemptionRes, "RedemptionRequested", { agentVault: agent.vaultAddress, valueUBA: minted.mintedAmountUBA });
        expectEvent.notEmitted(redemptionRes, "RedemptionRequestIncomplete");
    });

    it("by setting coreVaultMinimumAmountLeftBIPS, system may require that some minting is left on the agent", async () => {
        // set nonzero coreVaultMinimumAmountLeftBIPS
        await executeTimelockedGovernanceCall(context.assetManager,
            (governance) => context.assetManager.setCoreVaultMinimumAmountLeftBIPS(2000, { from: governance }));
        //
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        const cv = await Redeemer.create(context, context.initSettings.coreVaultNativeAddress, coreVaultUnderlyingAddress);
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(10);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        // agent requests transfer for all backing to core vault
        const info = await agent.getAgentInfo();
        const mintedAmount = toBN(info.mintedUBA);
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(mintedAmount);
        // trying to transfer everything will fail
        await expectRevert(context.assetManager.transferToCoreVault(agent.vaultAddress, mintedAmount, { from: agent.ownerWorkAddress, value: cbTransferFee }),
            "too little minting left after transfer");
        // check the maximum transfer amount, should be somewhere between 50% and 80%
        const { 0: maxTransferAmount, 1: minLeftAmount } = await context.assetManager.maximumTransferToCoreVault(agent.vaultAddress);
        assert.isTrue(maxTransferAmount.gte(mintedAmount.muln(50).divn(100)));
        assert.isTrue(maxTransferAmount.lte(mintedAmount.muln(80).divn(100)));
        assertWeb3Equal(minLeftAmount, mintedAmount.sub(maxTransferAmount));
        // trying to transfer above max transfer amount will fail
        await expectRevert(context.assetManager.transferToCoreVault(agent.vaultAddress, maxTransferAmount.addn(1), { from: agent.ownerWorkAddress, value: cbTransferFee }),
            "too little minting left after transfer");
        // the agent can transfer up to maxTransferAmount
        const transferAmount = maxTransferAmount;
        const cbTransferFee2 = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = await context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee2 });
        expectEvent(res, "TransferToCoreVaultStarted", { agentVault: agent.vaultAddress, valueUBA: transferAmount });
    });

    it("should revert canceling transfer to core vault if no active transfer", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const res = context.assetManager.cancelTransferToCoreVault(agent.vaultAddress, { from: agent.ownerWorkAddress });
        await expectRevert(res, "no active transfer");
    });

    async function prefundCoreVault(from: string, amount: BNish) {
        const wallet = new MockChainWallet(mockChain);
        const rtx = await wallet.addTransaction(from, coreVaultUnderlyingAddress, amount, null);
        const proof = await context.attestationProvider.provePayment(rtx, from, coreVaultUnderlyingAddress);
        await context.coreVaultManager!.confirmPayment(proof);
    }

    it("request return from core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        await prefundCoreVault(minter.underlyingAddress, 1e6);
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
        const returnReq = requiredEventArgs(rres, "ReturnFromCoreVaultRequested");
        assert.isTrue(toBN(returnReq.requestId).gten(1));
        assertWeb3Equal(returnReq.agentVault, agent2.vaultAddress);
        assertWeb3Equal(returnReq.valueUBA, context.convertLotsToUBA(5));
        assert.isTrue(PaymentReference.isValid(returnReq.paymentReference));
        assertWeb3Equal(PaymentReference.decodeType(returnReq.paymentReference), PaymentReference.RETURN_FROM_CORE_VAULT);
        // check transfer requested event from core vault
        const transferRequested = requiredEventArgsFrom(rres, context.coreVaultManager!, "TransferRequested");
        assert.equal(transferRequested.cancelable, true);
        assert.equal(transferRequested.destinationAddress, agent2.underlyingAddress);
        assert.equal(transferRequested.paymentReference, returnReq.paymentReference);
        assertWeb3Equal(transferRequested.amount, context.lotSize().muln(5));
        // trigger CV requests
        const trigRes = await context.coreVaultManager!.triggerInstructions({ from: triggeringAccount });
        const paymentReqs = filterEvents(trigRes, "PaymentInstructions");
        assert.equal(paymentReqs.length, 1);
        assertWeb3Equal(paymentReqs[0].args.account, coreVaultUnderlyingAddress);
        assertWeb3Equal(paymentReqs[0].args.destination, agent2.underlyingAddress);
        assertWeb3Equal(paymentReqs[0].args.amount, transferRequested.amount);
        assertWeb3Equal(paymentReqs[0].args.paymentReference, transferRequested.paymentReference);
        // simulate transfer from CV
        const wallet = new MockChainWallet(mockChain);
        for (const req of paymentReqs) {
            const rtx = await wallet.addTransaction(req.args.account, req.args.destination, req.args.amount, req.args.paymentReference);
            const proof = await context.attestationProvider.provePayment(rtx, req.args.account, req.args.destination);
            const cres = await context.assetManager.confirmReturnFromCoreVault(proof, agent2.vaultAddress, { from: agent2.ownerWorkAddress });
            expectEvent(cres, "ReturnFromCoreVaultConfirmed", { requestId: returnReq.requestId, remintedUBA: returnReq.valueUBA });
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
        await prefundCoreVault(minter.underlyingAddress, 1e6);
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
        const returnReq = requiredEventArgs(rres, "ReturnFromCoreVaultRequested");
        // now the second agent cancels the request
        const cres = await context.assetManager.cancelReturnFromCoreVault(agent2.vaultAddress, { from: agent2.ownerWorkAddress });
        expectEvent(cres, "ReturnFromCoreVaultCancelled", { agentVault: agent2.vaultAddress, requestId: returnReq.requestId });
        // trigger CV requests
        const trigRes = await context.coreVaultManager!.triggerInstructions({ from: triggeringAccount });
        const paymentReqs = filterEvents(trigRes, "PaymentInstructions");
        assert.equal(paymentReqs.length, 0);
    });

    it("should not cancel return from core vault if not requested", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const res = context.assetManager.cancelReturnFromCoreVault(agent.vaultAddress, { from: agent.ownerWorkAddress });
        await expectRevert(res, "no active return request");
    });

    it("test checks in requesting return from core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        await prefundCoreVault(minter.underlyingAddress, 1e6);
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

    it("should not request return from core vault if return already requested", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        await prefundCoreVault(minter.underlyingAddress, 1e6);
        // allow CV manager addresses
        await context.coreVaultManager!.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        await minter.performMinting(agent.vaultAddress, 10);
        // agent requests transfer for some backing to core vault
        const transferAmount = context.lotSize().muln(5);
        await agent.transferToCoreVault(transferAmount);
        // second agent requests return from CV
        await context.assetManager.requestReturnFromCoreVault(agent2.vaultAddress, 5, { from: agent2.ownerWorkAddress });
        // second agent tries to request return again
        const res = context.assetManager.requestReturnFromCoreVault(agent2.vaultAddress, 5, { from: agent2.ownerWorkAddress });
        await expectRevert(res, "return from core vault already requested");
    });

    it("should not request return from core vault if agent in status is not normal", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        await prefundCoreVault(minter.underlyingAddress, 1e6);
        // allow CV manager addresses
        await context.coreVaultManager!.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        const [minted, crt, txHash] = await minter.performMinting(agent.vaultAddress, 10);
        // agent requests transfer for some backing to core vault
        const transferAmount = context.lotSize().muln(5);
        await agent.transferToCoreVault(transferAmount);

        // perform illegal payment
        await agent2.performPayment("IllegalPayment1", 100);
        // challenge agent for illegal payment
        const proof = await context.attestationProvider.proveBalanceDecreasingTransaction(txHash, agent2.underlyingAddress);
        await context.assetManager.illegalPaymentChallenge(proof, agent2.agentVault.address, { from: accounts[1234] });
        const agentInfo = await agent2.getAgentInfo();
        const agentStatus = Number(agentInfo.status) as AgentStatus;
        assert.equal(agentStatus, AgentStatus.FULL_LIQUIDATION);

        // second agent requests return from CV
        const res = context.assetManager.requestReturnFromCoreVault(agent2.vaultAddress, 5, { from: agent2.ownerWorkAddress });
        await expectRevert(res, "invalid agent status");
    });

    it("should not request return from core vault if not enough free collateral", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        await prefundCoreVault(minter.underlyingAddress, 1e6);
        // allow CV manager addresses
        await context.coreVaultManager!.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        await agent2.depositCollateralsAndMakeAvailable(toWei(3e5), toWei(3e5));
        // mint
        const [minted, crt, txHash] = await minter.performMinting(agent.vaultAddress, 10);
        // agent requests transfer for some backing to core vault
        const transferAmount = context.lotSize().muln(5);
        await agent.transferToCoreVault(transferAmount);

        // second agent requests return from CV
        const res = context.assetManager.requestReturnFromCoreVault(agent2.vaultAddress, 10, { from: agent2.ownerWorkAddress });
        await expectRevert(res, "not enough free collateral");
    });

    async function makeAndConfirmReturnPayment(agent: Agent, from: string, to: string, amount: BNish, paymentReference: string) {
        const wallet = new MockChainWallet(mockChain);
        const rtx = await wallet.addTransaction(from, to, amount, paymentReference);
        const proof = await context.attestationProvider.provePayment(rtx, from, to);
        const cres = await context.assetManager.confirmReturnFromCoreVault(proof, agent.vaultAddress, { from: agent.ownerWorkAddress });
        return requiredEventArgs(cres, "ReturnFromCoreVaultConfirmed");
    }

    it("test checks in confirming return from core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        await prefundCoreVault(minter.underlyingAddress, 1e6);
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
        // mint some coins on core vault for invalid transfers
        mockChain.mint(coreVaultUnderlyingAddress, transferAmount.muln(10));
        // second agent requests return from CV
        const rres = await context.assetManager.requestReturnFromCoreVault(agent2.vaultAddress, 5, { from: agent2.ownerWorkAddress });
        // trigger CV requests
        const trigRes = await context.coreVaultManager!.triggerInstructions({ from: triggeringAccount });
        const paymentReqs = filterEvents(trigRes, "PaymentInstructions");
        const req = requireNotNull(paymentReqs[0]);
        // agent must have active return request
        await expectRevert(makeAndConfirmReturnPayment(agent, req.args.account, agent.underlyingAddress, req.args.amount, req.args.paymentReference),
            "no active return request");
        // source address must be coreVaultUnderlyingAddress
        await expectRevert(makeAndConfirmReturnPayment(agent2, minter.underlyingAddress, req.args.destination, req.args.amount, req.args.paymentReference),
            "payment not from core vault");
        // destination address must be agent's
        await expectRevert(makeAndConfirmReturnPayment(agent2, req.args.account, underlyingRedeemer1, req.args.amount, req.args.paymentReference),
            "payment not to agent's address");
        // payment reference must match active payment
        await expectRevert(makeAndConfirmReturnPayment(agent2, req.args.account, req.args.destination, req.args.amount, PaymentReference.returnFromCoreVault(1e6)),
            "invalid payment reference");
    });

    async function testRedeemFromCV(redeemer: Redeemer, lots: number) {
        const res = await context.assetManager.redeemFromCoreVault(lots, redeemer.underlyingAddress, { from: redeemer.address });
        const redeem = requiredEventArgs(res, "CoreVaultRedemptionRequested");
        assertWeb3Equal(redeem.redeemer, redeemer.address);
        assertWeb3Equal(redeem.paymentAddress, redeemer.underlyingAddress);
        assertWeb3Equal(redeem.valueUBA, context.convertLotsToUBA(lots));
        assertWeb3Equal(redeem.feeUBA, toBN(redeem.valueUBA).mul(toBN(context.initSettings.coreVaultRedemptionFeeBIPS)).divn(MAX_BIPS));
        assert.isTrue(PaymentReference.isValid(redeem.paymentReference));
        assertWeb3Equal(PaymentReference.decodeType(redeem.paymentReference), PaymentReference.REDEMPTION_FROM_CORE_VAULT);
        const paymentAmount = toBN(redeem.valueUBA).sub(toBN(redeem.feeUBA));
        const paymentReference = redeem.paymentReference;
        return [paymentAmount, paymentReference] as const;
    }

    it("request direct redemption from core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        await prefundCoreVault(minter.underlyingAddress, 1e6);
        // allow CV manager addresses
        await context.coreVaultManager!.addAllowedDestinationAddresses([redeemer.underlyingAddress], { from: governance });
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 100);
        await minter.transferFAsset(redeemer.address, minted.mintedAmountUBA);
        // agent requests transfer for some backing to core vault
        const transferAmount = context.convertLotsToUBA(100);
        await agent.transferToCoreVault(transferAmount);
        // redeemer requests direct redemption from CV
        const [paymentAmount1, paymentReference1] = await testRedeemFromCV(redeemer, 50);
        // second redemption request gets equal payment reference
        const [paymentAmount2, paymentReference2] = await testRedeemFromCV(redeemer, 30);
        assert.equal(paymentReference1, paymentReference2);
        // trigger CV requests - there should be one with amount the sum of requests to the same redeemer
        const trigRes = await context.coreVaultManager!.triggerInstructions({ from: triggeringAccount });
        const paymentReqs = filterEvents(trigRes, "PaymentInstructions");
        const redemptionPaymentAmount = paymentAmount1.add(paymentAmount2);
        assert.equal(paymentReqs.length, 1);
        assertWeb3Equal(paymentReqs[0].args.account, coreVaultUnderlyingAddress);
        assertWeb3Equal(paymentReqs[0].args.destination, redeemer.underlyingAddress);
        assertWeb3Equal(paymentReqs[0].args.amount, redemptionPaymentAmount);
        // request after trigger gets different payment reference
        const [paymentAmount3, paymentReference3] = await testRedeemFromCV(redeemer, 20);
        assert.notEqual(paymentReference1, paymentReference3);
        // simulate transfer from CV
        const wallet = new MockChainWallet(mockChain);
        for (const req of paymentReqs) {
            await wallet.addTransaction(req.args.account, req.args.destination, req.args.amount, null);
        }
        assertWeb3Equal(await mockChain.getBalance(redeemer.underlyingAddress), redemptionPaymentAmount);
    });

    it("test checks in requesting direct redemption from core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        await prefundCoreVault(minter.underlyingAddress, 1e6);
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
        // update manager
        await context.assetManager.setCoreVaultManager(accounts[31], { from: context.governance });
        assertWeb3Equal(await context.assetManager.getCoreVaultManager(), accounts[31]);
        // update vault native address (collects fees)
        await context.assetManager.setCoreVaultNativeAddress(accounts[32], { from: context.governance });
        assertWeb3Equal(await context.assetManager.getCoreVaultNativeAddress(), accounts[32]);
        // update transfer-to-vault fee
        await context.assetManager.setCoreVaultTransferFeeBIPS(123, { from: context.governance });
        assertWeb3Equal(await context.assetManager.getCoreVaultTransferFeeBIPS(), 123);
        // update minimum amount left after transfer to vault
        await context.assetManager.setCoreVaultMinimumAmountLeftBIPS(1234, { from: context.governance });
        assertWeb3Equal(await context.assetManager.getCoreVaultMinimumAmountLeftBIPS(), 1234);
        // update direct-redemption-from-vault fee
        await context.assetManager.setCoreVaultRedemptionFeeBIPS(211, { from: context.governance });
        assertWeb3Equal(await context.assetManager.getCoreVaultRedemptionFeeBIPS(), 211);
        // update minimum redem lots
        await context.assetManager.setCoreVaultMinimumRedeemLots(3, { from: context.governance });
        assertWeb3Equal(await context.assetManager.getCoreVaultMinimumRedeemLots(), 3);
    });

    it("core vault setting modification requires governance call", async () => {
        await expectRevert(context.assetManager.setCoreVaultManager(accounts[31]), "only governance");
        await expectRevert(context.assetManager.setCoreVaultNativeAddress(accounts[32]), "only governance");
        await expectRevert(context.assetManager.setCoreVaultTransferFeeBIPS(123), "only governance");
        await expectRevert(context.assetManager.setCoreVaultRedemptionFeeBIPS(211), "only governance");
        await expectRevert(context.assetManager.setCoreVaultMinimumAmountLeftBIPS(1000), "only governance");
        await expectRevert(context.assetManager.setCoreVaultMinimumRedeemLots(3), "only governance");
    });

    it("core vault address setting is timelocked, the others aren't", async () => {
        let timelocked: boolean;
        await context.assetManager.switchToProductionMode({ from: context.governance });
        // manager is timelocked
        timelocked = await executeTimelockedGovernanceCall(context.assetManager,
            (governance) => context.assetManager.setCoreVaultManager(accounts[31], { from: governance }));
        assert.equal(timelocked, true);
        // others aren't timelocked
        timelocked = await executeTimelockedGovernanceCall(context.assetManager,
            (governance) => context.assetManager.setCoreVaultNativeAddress(accounts[32], { from: governance }));
        assert.equal(timelocked, false);
        //
        timelocked = await executeTimelockedGovernanceCall(context.assetManager,
            (governance) => context.assetManager.setCoreVaultTransferFeeBIPS(123, { from: governance }));
        assert.equal(timelocked, false);
        //
        timelocked = await executeTimelockedGovernanceCall(context.assetManager,
            (governance) => context.assetManager.setCoreVaultRedemptionFeeBIPS(211, { from: governance }));
        assert.equal(timelocked, false);
        //
        timelocked = await executeTimelockedGovernanceCall(context.assetManager,
            (governance) => context.assetManager.setCoreVaultMinimumAmountLeftBIPS(1000, { from: governance }));
        assert.equal(timelocked, false);
        //
        timelocked = await executeTimelockedGovernanceCall(context.assetManager,
            (governance) => context.assetManager.setCoreVaultMinimumRedeemLots(3, { from: governance }));
        assert.equal(timelocked, false);
    });

    it("should revert if core vault not enabled", async () => {
        async function initialize1() {
            commonContext = await CommonContext.createTest(governance);
            context = await AssetContext.createTest(commonContext, testChainInfo.xrp);
            return { commonContext, context };
        }
        ({ commonContext, context } = await loadFixtureCopyVars(initialize1));
        mockChain = context.chain as MockChain;
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);

        // transfer to core vault
        await expectRevert(context.assetManager.transferToCoreVault(agent.vaultAddress, context.lotSize().muln(10), { from: agent.ownerWorkAddress }), "core vault not enabled");
        // cancel transfer to core vault
        await expectRevert(context.assetManager.cancelTransferToCoreVault(agent.vaultAddress, { from: agent.ownerWorkAddress }), "core vault not enabled");
        // request return from core vault
        await expectRevert(context.assetManager.requestReturnFromCoreVault(agent.vaultAddress, 10, { from: agent.ownerWorkAddress }), "core vault not enabled");
        // cancel return from core vault
        await expectRevert(context.assetManager.cancelReturnFromCoreVault(agent.vaultAddress, { from: agent.ownerWorkAddress }), "core vault not enabled");
        // confirm return from core vault
        const wallet = new MockChainWallet(mockChain);
        const rtx = await wallet.addTransaction(agent.underlyingAddress, coreVaultUnderlyingAddress, 10, null);
        const proof = await context.attestationProvider.provePayment(rtx, agent.underlyingAddress, coreVaultUnderlyingAddress);
        await expectRevert(context.assetManager.confirmReturnFromCoreVault(proof, agent.vaultAddress, { from: agent.ownerWorkAddress }), "core vault not enabled");
        // redeem return from core vault
        await expectRevert(context.assetManager.redeemFromCoreVault(10, agent.underlyingAddress, { from: agent.ownerWorkAddress }), "core vault not enabled");
    });
});