import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { filterEvents, requiredEventArgs } from "../../../lib/utils/events/truffle";
import { BNish, DAYS, HOURS, MAX_BIPS, requireNotNull, toBN, toWei, ZERO_ADDRESS } from "../../../lib/utils/helpers";
import { MockChain, MockChainWallet } from "../../utils/fasset/MockChain";
import { deterministicTimeIncrease, getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
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
import { MockCoreVaultBot } from "../utils/MockCoreVaultBot";
import { assertApproximatelyEqual } from "../../utils/approximation";

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
    const coreVaultCustodianAddress = "CORE_VAULT_CUSTODIAN";

    let commonContext: CommonContext;
    let context: AssetContext;
    let mockChain: MockChain;
    let coreVaultManager: NonNullable<AssetContext["coreVaultManager"]>;
    let preimages: string[];

    async function initialize() {
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.xrp);
        // enable core vault
        await context.assignCoreVaultManager({
            underlyingAddress: coreVaultUnderlyingAddress,
            custodianAddress: coreVaultCustodianAddress,
            triggeringAccounts: [triggeringAccount],
        });
        // add escrow preimage hashes
        preimages = Array.from({ length: 10 }, (_, i) => `PREIMAGE no. ${i + 1}`);
        const preimageHashes = preimages.map(web3.utils.keccak256);
        await context.coreVaultManager!.addPreimageHashes(preimageHashes, { from: context.governance });
        //
        return { commonContext, context, preimages };
    }

    beforeEach(async () => {
        ({ commonContext, context, preimages } = await loadFixtureCopyVars(initialize));
        mockChain = context.chain as MockChain;
        coreVaultManager = requireNotNull(context.coreVaultManager);
    });

    it("should transfer all backing to core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        const cv = await Redeemer.create(context, context.initSettings.coreVaultNativeAddress, coreVaultUnderlyingAddress);
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
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
        // wait 20 blocks and 1 hour - transfer can be defaulted without time extension
        context.skipToExpiration(currentBlock.addn(20), currentTimestamp.addn(1 * HOURS));
        await expectRevert(cv.redemptionPaymentDefault(rdreqs[0]), "overflow block not found");
        // perform transfer of underlying
        const resps = await agent.performRedemptions(rdreqs);
        // check that TransferToCoreVaultSuccessful event was emitted
        const transferRes = resps[String(rdreqs[0].requestId)];
        assert(transferRes != null);
        expectEvent(transferRes, "TransferToCoreVaultSuccessful");
        await expectEvent.inTransaction(transferRes.tx, coreVaultManager, "PaymentConfirmed", { amount: transferAmount });
        // agent now has 0 backing
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: 0, redeemingUBA: 0, dustUBA: 0, requiredUnderlyingBalanceUBA: 0 });
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
        await agent.depositCollateralLotsAndMakeAvailable(100);
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
        // however, cannot transfer 0
        await expectRevert(context.assetManager.transferToCoreVault(agent.vaultAddress, 0, { from: agent.ownerWorkAddress, value: cbTransferFee }),
            "zero transfer not allowed");
        // perform transfer of underlying
        await agent.performRedemptions(rdreqs);
        // agent now has approx half backing left
        const expectRemainingMinted = remainingTicketAmount.add(toBN(minted.poolFeeUBA));
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: expectRemainingMinted, redeemingUBA: 0 });
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
        await agent.depositCollateralLotsAndMakeAvailable(100);
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
        await agent.depositCollateralLotsAndMakeAvailable(100);
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
        await agent.depositCollateralLotsAndMakeAvailable(100);
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
        await agent.depositCollateralLotsAndMakeAvailable(100);
        // mint
        await minter.performMinting(agent.vaultAddress, 5);
        const redemptionRes = await context.assetManager.redeem(5, minter.underlyingAddress, ZERO_ADDRESS, { from: minter.address });
        // agent requests transfer for half backing to core vault
        const transferAmount = context.lotSize().muln(4);
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee });
        await expectRevert(res, "too little minting left after transfer");
    });

    it("should default transfer to core vault - by agent", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
        await agent2.depositCollateralLotsAndMakeAvailable(100);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        // another mint, just to prevent merging tickets
        await minter.performMinting(agent2.vaultAddress, 1);
        // update time
        await context.updateUnderlyingBlock();
        const { 0: currentBlock, 1: currentTimestamp } = await context.assetManager.currentUnderlyingBlock();
        // agent requests transfer for half backing to core vault
        const totalMintedAmount = toBN(minted.mintedAmountUBA).add(toBN(minted.poolFeeUBA));
        const transferAmount = context.lotSize().muln(5);
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = await context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee });
        const rdreqs = filterEvents(res, "RedemptionRequested").map(evt => evt.args);
        assertWeb3Equal(rdreqs.length, 1);
        // agent now has approx half backing in redeeming state
        const expectRemainingMinted = totalMintedAmount.sub(transferAmount);
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: expectRemainingMinted, redeemingUBA: transferAmount });
        // time for payment is longer than normal
        const expectedPaymentTime = currentTimestamp.add(toBN(context.settings.underlyingSecondsForPayment).add(toBN(context.initSettings.coreVaultTransferTimeExtensionSeconds)));
        assert.isTrue(toBN(rdreqs[0].lastUnderlyingTimestamp).gte(expectedPaymentTime));
        // cannot default immediatelly
        await expectRevert(agent.transferToCoreVaultDefault(rdreqs[0]), "overflow block not found");
        // skip until the payment time passes
        context.skipToExpiration(rdreqs[0].lastUnderlyingBlock, rdreqs[0].lastUnderlyingTimestamp);
        // agent defaults transfer request
        await agent.transferToCoreVaultDefault(rdreqs[0]);
        // agent now has full backing left
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: totalMintedAmount, redeemingUBA: 0 });
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

    it("should default transfer to core vault - by others", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
        await agent2.depositCollateralLotsAndMakeAvailable(100);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        // another mint, just to prevent merging tickets
        await minter.performMinting(agent2.vaultAddress, 1);
        // update time
        await context.updateUnderlyingBlock();
        // agent requests transfer for half backing to core vault
        const totalMintedAmount = toBN(minted.mintedAmountUBA).add(toBN(minted.poolFeeUBA));
        const transferAmount = context.lotSize().muln(5);
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = await context.assetManager.transferToCoreVault(agent.vaultAddress, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee });
        const rdreqs = filterEvents(res, "RedemptionRequested").map(evt => evt.args);
        assertWeb3Equal(rdreqs.length, 1);
        // agent now has approx half backing in redeeming state
        const expectRemainingMinted = totalMintedAmount.sub(transferAmount);
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: expectRemainingMinted, redeemingUBA: transferAmount });
        // cannot default immediatelly
        await expectRevert(agent.transferToCoreVaultDefault(rdreqs[0], challengerAddress1), "overflow block not found");
        // skip until the payment time passes
        context.skipToExpiration(rdreqs[0].lastUnderlyingBlock, rdreqs[0].lastUnderlyingTimestamp);
        // others cannot default immediately when payment time ends
        await expectRevert(agent.transferToCoreVaultDefault(rdreqs[0], challengerAddress1), "only redeemer, executor or agent");
        // after confirmation by others time, the default will succeed and the challenger will get some reward
        await deterministicTimeIncrease(context.settings.confirmationByOthersAfterSeconds);
        const challengerBalanceBefore = await context.usdc.balanceOf(challengerAddress1);
        await agent.transferToCoreVaultDefault(rdreqs[0], challengerAddress1);
        const challengerBalanceAfter = await context.usdc.balanceOf(challengerAddress1);
        assert.isTrue(challengerBalanceAfter.gte(challengerBalanceBefore.addn(50e6)));
        // agent now has full backing left
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: totalMintedAmount, redeemingUBA: 0 });
    });

    it("confirming failed transfer payment acts like cancel", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
        await agent2.depositCollateralLotsAndMakeAvailable(100);
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
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: expectRemainingMinted, redeemingUBA: transferAmount });
        // agent makes and proves redemption payment with wrong amount
        const request = rdreqs[0];
        const txHash = await agent.performPayment(request.paymentAddress, 1, request.paymentReference);
        const proof = await context.attestationProvider.provePayment(txHash, agent.underlyingAddress, request.paymentAddress);
        const paymentRes = await context.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: agent.ownerWorkAddress });
        expectEvent(paymentRes, "RedemptionPaymentFailed");
        // agent now has again full backing left
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: totalMintedAmount, redeemingUBA: 0 });
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

    async function prefundCoreVault(from: string, amount: BNish) {
        const wallet = new MockChainWallet(mockChain);
        const rtx = await wallet.addTransaction(from, coreVaultUnderlyingAddress, amount, null);
        const proof = await context.attestationProvider.provePayment(rtx, from, coreVaultUnderlyingAddress);
        await coreVaultManager.confirmPayment(proof);
    }

    it("request return from core vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        await prefundCoreVault(minter.underlyingAddress, 1e6);
        // allow CV manager addresses
        await coreVaultManager.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
        await agent2.depositCollateralLotsAndMakeAvailable(100);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 10);
        // agent requests transfer for some backing to core vault
        const transferAmount = context.lotSize().muln(5);
        const remainingTicketAmount = context.lotSize().muln(5);
        await agent.transferToCoreVault(transferAmount);
        // check that available amount is enough for return of 5 lots
        const { 0: immediatelyAvailable, 1: totalAvailable } = await context.assetManager.coreVaultAvailableAmount();
        assert.isTrue(immediatelyAvailable.gte(context.convertLotsToUBA(5)));
        assert.isTrue(totalAvailable.gte(context.convertLotsToUBA(5)));
        // second agent requests return from CV
        const rres = await context.assetManager.requestReturnFromCoreVault(agent2.vaultAddress, 5, { from: agent2.ownerWorkAddress });
        const returnReq = requiredEventArgs(rres, "ReturnFromCoreVaultRequested");
        assert.isTrue(toBN(returnReq.requestId).gten(1));
        assertWeb3Equal(returnReq.agentVault, agent2.vaultAddress);
        assertWeb3Equal(returnReq.valueUBA, context.convertLotsToUBA(5));
        assert.isTrue(PaymentReference.isValid(returnReq.paymentReference));
        assertWeb3Equal(PaymentReference.decodeType(returnReq.paymentReference), PaymentReference.RETURN_FROM_CORE_VAULT);
        // check transfer requested event from core vault
        const transferRequested = requiredEventArgsFrom(rres, coreVaultManager, "TransferRequested");
        assert.equal(transferRequested.cancelable, true);
        assert.equal(transferRequested.destinationAddress, agent2.underlyingAddress);
        assert.equal(transferRequested.paymentReference, returnReq.paymentReference);
        assertWeb3Equal(transferRequested.amount, context.lotSize().muln(5));
        // trigger CV requests
        const trigRes = await coreVaultManager.triggerInstructions({ from: triggeringAccount });
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
        await agent.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: expectRemainingMinted, redeemingUBA: 0 });
        // second agent has approx the other half
        await agent2.checkAgentInfo({ status: AgentStatus.NORMAL, reservedUBA: 0, mintedUBA: transferRequested.amount, redeemingUBA: 0 });
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
        await coreVaultManager.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
        await agent2.depositCollateralLotsAndMakeAvailable(100);
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
        const trigRes = await coreVaultManager.triggerInstructions({ from: triggeringAccount });
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
        await coreVaultManager.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
        await agent2.depositCollateralLotsAndMakeAvailable(100);
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
        await coreVaultManager.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
        await agent2.depositCollateralLotsAndMakeAvailable(100);
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
        await coreVaultManager.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
        await agent2.depositCollateralLotsAndMakeAvailable(100);
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
        await coreVaultManager.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
        await agent2.depositCollateralLotsAndMakeAvailable(9);
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
        await coreVaultManager.addAllowedDestinationAddresses([agent2.underlyingAddress], { from: governance });
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
        await agent2.depositCollateralLotsAndMakeAvailable(100);
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
        const trigRes = await coreVaultManager.triggerInstructions({ from: triggeringAccount });
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
        await coreVaultManager.addAllowedDestinationAddresses([redeemer.underlyingAddress], { from: governance });
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
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
        const trigRes = await coreVaultManager.triggerInstructions({ from: triggeringAccount });
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
        await coreVaultManager.addAllowedDestinationAddresses([redeemer.underlyingAddress], { from: governance });
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(100);
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
        let res = await context.assetManager.setCoreVaultManager(accounts[31], { from: context.governance });
        expectEvent(res, "ContractChanged", { name: "coreVaultManager", value: accounts[31] })
        assertWeb3Equal(await context.assetManager.getCoreVaultManager(), accounts[31]);
        // update vault native address (collects fees)
        res = await context.assetManager.setCoreVaultNativeAddress(accounts[32], { from: context.governance });
        expectEvent(res, "ContractChanged", { name: "coreVaultNativeAddress", value: accounts[32] })
        assertWeb3Equal(await context.assetManager.getCoreVaultNativeAddress(), accounts[32]);
        // update transfer-to-vault fee
        res = await context.assetManager.setCoreVaultTransferFeeBIPS(123, { from: context.governance });
        expectEvent(res, "SettingChanged", { name: "coreVaultTransferFeeBIPS", value: "123" })
        assertWeb3Equal(await context.assetManager.getCoreVaultTransferFeeBIPS(), 123);
        // update transfer-to-vault payment time extension
        res = await context.assetManager.setCoreVaultTransferTimeExtensionSeconds(1800, { from: context.governance });
        expectEvent(res, "SettingChanged", { name: "coreVaultTransferTimeExtensionSeconds", value: "1800" })
        assertWeb3Equal(await context.assetManager.getCoreVaultTransferTimeExtensionSeconds(), 1800);
        // update minimum amount left after transfer to vault
        res = await context.assetManager.setCoreVaultMinimumAmountLeftBIPS(1234, { from: context.governance });
        expectEvent(res, "SettingChanged", { name: "coreVaultMinimumAmountLeftBIPS", value: "1234" })
        assertWeb3Equal(await context.assetManager.getCoreVaultMinimumAmountLeftBIPS(), 1234);
        // update direct-redemption-from-vault fee
        res = await context.assetManager.setCoreVaultRedemptionFeeBIPS(211, { from: context.governance });
        expectEvent(res, "SettingChanged", { name: "coreVaultRedemptionFeeBIPS", value: "211" })
        assertWeb3Equal(await context.assetManager.getCoreVaultRedemptionFeeBIPS(), 211);
        // update minimum redem lots
        res = await context.assetManager.setCoreVaultMinimumRedeemLots(3, { from: context.governance });
        expectEvent(res, "SettingChanged", { name: "coreVaultMinimumRedeemLots", value: "3" })
        assertWeb3Equal(await context.assetManager.getCoreVaultMinimumRedeemLots(), 3);
    });

    it("revert if modifying core vault settings with invalid values", async () => {
        await expectRevert(context.assetManager.setCoreVaultTransferFeeBIPS(MAX_BIPS + 1, { from: context.governance }), "bips value too high");
        await expectRevert(context.assetManager.setCoreVaultRedemptionFeeBIPS(MAX_BIPS + 1, { from: context.governance }), "bips value too high");
        await expectRevert(context.assetManager.setCoreVaultMinimumAmountLeftBIPS(MAX_BIPS + 1, { from: context.governance }), "bips value too high");
    });

    it("core vault setting modification requires governance call", async () => {
        await expectRevert(context.assetManager.setCoreVaultManager(accounts[31]), "only governance");
        await expectRevert(context.assetManager.setCoreVaultNativeAddress(accounts[32]), "only governance");
        await expectRevert(context.assetManager.setCoreVaultTransferFeeBIPS(123), "only governance");
        await expectRevert(context.assetManager.setCoreVaultTransferTimeExtensionSeconds(1800), "only governance");
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
            (governance) => context.assetManager.setCoreVaultTransferTimeExtensionSeconds(1800, { from: governance }));
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

    it("revert if not called from agent vault owner address", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        // transfer to core vault
        await expectRevert(context.assetManager.transferToCoreVault(agent.vaultAddress, context.lotSize().muln(10)), "only agent vault owner");
        // request return from core vault
        await expectRevert(context.assetManager.requestReturnFromCoreVault(agent.vaultAddress, 10), "only agent vault owner");
        // cancel return from core vault
        await expectRevert(context.assetManager.cancelReturnFromCoreVault(agent.vaultAddress), "only agent vault owner");
        // confirm return from core vault
        const wallet = new MockChainWallet(mockChain);
        const rtx = await wallet.addTransaction(agent.underlyingAddress, coreVaultUnderlyingAddress, 10, null);
        const proof = await context.attestationProvider.provePayment(rtx, agent.underlyingAddress, coreVaultUnderlyingAddress);
        await expectRevert(context.assetManager.confirmReturnFromCoreVault(proof, agent.vaultAddress), "only agent vault owner");
    })

    async function timestampAfterDaysAt(days: number, daytime: number) {
        const curtime = await time.latest();
        const newtime = curtime.addn(days * DAYS); // skip some days
        return newtime.subn(newtime.modn(1 * DAYS)).addn(daytime); // align to daytime
    }

    async function increaseTime(seconds: BNish) {
        await deterministicTimeIncrease(seconds);
        mockChain.skipTime(Number(seconds));
    }

    async function increaseTimeTo(timestamp: BNish) {
        await time.increaseTo(timestamp);
        mockChain.skipTimeTo(Number(timestamp));
    }

    it("should trigger escrow instructions", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.convertLotsToUBA(1000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        await prefundCoreVault(minter.underlyingAddress, 1e6);
        // allow CV manager addresses
        await coreVaultManager.addAllowedDestinationAddresses([redeemer.underlyingAddress], { from: governance });
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(200);
        await agent2.depositCollateralLotsAndMakeAvailable(200);
        // mint
        const [minted1] = await minter.performMinting(agent.vaultAddress, 200);
        const [minted2] = await minter.performMinting(agent2.vaultAddress, 200);
        await minter.transferFAsset(redeemer.address, toBN(minted1.mintedAmountUBA).add(toBN(minted2.mintedAmountUBA)));
        // skip time to 1am to make escrow time-based calclations deterministic
        let newtime = await timestampAfterDaysAt(1, 1 * HOURS); // align to 1am
        await increaseTimeTo(newtime);
        // agent requests transfer for some backing to core vault
        const transferAmount = context.convertLotsToUBA(151);
        await agent.transferToCoreVault(transferAmount);
        // trigger - no escrow should be created yet (escrow amount is 100 lots, minimum left is 100 lots)
        const res = await coreVaultManager.triggerInstructions({ from: triggeringAccount });
        expectEvent.notEmitted(res, "EscrowInstructions");
        // another transfer to core vault
        await agent2.transferToCoreVault(transferAmount);
        // trigger - now 200 lots should be escrowed (there should be 2 escrow requests, 100 lots each)
        const res2 = await coreVaultManager.triggerInstructions({ from: triggeringAccount });
        expectEvent(res2, "EscrowInstructions", { sequence: "1", amount: context.convertLotsToUBA(100), cancelAfterTs: await timestampAfterDaysAt(1, 12 * HOURS) });
        expectEvent(res2, "EscrowInstructions", { sequence: "2", amount: context.convertLotsToUBA(100), cancelAfterTs: await timestampAfterDaysAt(2, 12 * HOURS) });
    });

    it("perform core vault transfer, return and escrow", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.convertLotsToUBA(1000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        const coreVaultBot = new MockCoreVaultBot(context, triggeringAccount);
        await prefundCoreVault(minter.underlyingAddress, 1e6);
        // allow CV manager addresses
        await coreVaultManager.addAllowedDestinationAddresses([agent.underlyingAddress, agent2.underlyingAddress], { from: governance });
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(200);
        await agent2.depositCollateralLotsAndMakeAvailable(200);
        // mint
        const [minted1] = await minter.performMinting(agent.vaultAddress, 200);
        const [minted2] = await minter.performMinting(agent2.vaultAddress, 200);
        await minter.transferFAsset(redeemer.address, toBN(minted1.mintedAmountUBA).add(toBN(minted2.mintedAmountUBA)));
        // skip time to 1am to make escrow time-based calclations deterministic
        const newtime = await timestampAfterDaysAt(1, 1 * HOURS); // align to 1am
        await increaseTimeTo(newtime);
        // agent requests transfer for some backing to core vault
        const transferLots = 151;
        const transferAmount = context.convertLotsToUBA(transferLots);
        await agent.transferToCoreVault(transferAmount);
        // trigger - no escrow should be created yet (escrow amont is 100 lots, minimum left is 100 lots)
        const handled1 = await coreVaultBot.triggerAndPerformActions();
        assert.equal(handled1.createdEscrows.length, 0);
        // another transfer to core vault
        await agent2.transferToCoreVault(transferAmount);
        // trigger - now 200 lots should be escrowed (escrow amont is 100 lots, minimum left is 100 lots)
        const handled2 = await coreVaultBot.triggerAndPerformActions();
        assert.equal(handled2.createdEscrows.length, 2);
        // trigger expiration - there should be no change
        await coreVaultBot.escrow.expireEscrows();
        assert.equal(coreVaultBot.escrow.escrows.size, 2);
        // request for return
        await context.assetManager.requestReturnFromCoreVault(agent.vaultAddress, transferLots, { from: agent.ownerWorkAddress });
        await context.assetManager.requestReturnFromCoreVault(agent2.vaultAddress, transferLots, { from: agent2.ownerWorkAddress });
        // it won't get fulfilled immediately
        const handled3 = await coreVaultBot.triggerAndPerformActions();
        assert.equal(handled3.expiredEscrows.length, 0);
        assert.equal(handled3.payments.length, 0);
        // and not after 1 day
        await increaseTime(1 * DAYS);
        const handled4 = await coreVaultBot.triggerAndPerformActions();
        assert.equal(handled4.expiredEscrows.length, 0);
        assert.equal(handled4.payments.length, 0);
        // after 3 days, 1 escrow is released
        await increaseTime(1 * DAYS);
        const handled5 = await coreVaultBot.triggerAndPerformActions();
        assert.equal(handled5.expiredEscrows.length, 1);
        assert.equal(handled5.payments.length, 1);
        // must confirm payment to have minted amount back
        const pmt1 = handled5.payments[0];
        assert.equal(pmt1.to, agent.underlyingAddress);
        await agent.confirmReturnFromCoreVault(pmt1.txHash);
        await agent.checkAgentInfo({ mintedUBA: context.convertLotsToUBA(200).add(toBN(minted1.poolFeeUBA)) });
        // after 4 days, 1 more escrow is released
        await increaseTime(1 * DAYS);
        const handled6 = await coreVaultBot.triggerAndPerformActions();
        assert.equal(handled6.expiredEscrows.length, 1);
        assert.equal(handled6.payments.length, 1);
        const pmt2 = handled6.payments[0];
        await agent2.confirmReturnFromCoreVault(pmt2.txHash);
        await agent2.checkAgentInfo({ mintedUBA: context.convertLotsToUBA(200).add(toBN(minted2.poolFeeUBA)) });
    });

    it("perform core vault transfer, return, large redemption and release escrows", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.convertLotsToUBA(1000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        const coreVaultBot = new MockCoreVaultBot(context, triggeringAccount);
        await prefundCoreVault(minter.underlyingAddress, 1e6);
        // allow CV manager addresses
        await coreVaultManager.addAllowedDestinationAddresses([agent.underlyingAddress, redeemer.underlyingAddress], { from: governance });
        // make agent available
        await agent.depositCollateralLotsAndMakeAvailable(400);
        // mint
        const [minted] = await minter.performMinting(agent.vaultAddress, 400);
        await minter.transferFAsset(redeemer.address, toBN(minted.mintedAmountUBA));
        // skip time to 1am to make escrow time-based calclations deterministic
        const newtime = await timestampAfterDaysAt(1, 1 * HOURS); // align to 1am
        await increaseTimeTo(newtime);
        // agent requests transfer for some backing to core vault
        const transferLots = 400;
        const transferAmount = context.convertLotsToUBA(transferLots);
        await agent.transferToCoreVault(transferAmount);
        // trigger - 300 lots should be escrowed (escrow amont is 100 lots, minimum left is 100 lots)
        const handled2 = await coreVaultBot.triggerAndPerformActions();
        assert.equal(handled2.createdEscrows.length, 3);
        // trigger expiration - there should be no change
        await coreVaultBot.escrow.expireEscrows();
        assert.equal(coreVaultBot.escrow.escrows.size, 3);
        // agent requests for return, redeemer tries to redeem the rest
        await context.assetManager.requestReturnFromCoreVault(agent.vaultAddress, 50, { from: agent.ownerWorkAddress });
        await context.assetManager.redeemFromCoreVault(350, redeemer.underlyingAddress, { from: redeemer.address });
        // agent's request is within daily amount, so it is handled immediately; the redeemer's isn't
        const handled3 = await coreVaultBot.triggerAndPerformActions();
        assert.equal(handled3.createdEscrows.length, 0);
        assert.equal(handled3.expiredEscrows.length, 0);
        assert.equal(handled3.payments.length, 1);
        // agent must confirm payment to have minted amount back
        const pmt1 = handled3.payments[0];
        assert.equal(pmt1.to, agent.underlyingAddress);
        assertWeb3Equal(pmt1.amount, context.convertLotsToUBA(50));
        await agent.confirmReturnFromCoreVault(pmt1.txHash);
        await agent.checkAgentInfo({ mintedUBA: context.convertLotsToUBA(50).add(toBN(minted.poolFeeUBA)) });
        // trigger release of two escrows so that the redeemer can be paid
        const releasedHashes: string[] = [];
        for (let i = 2; i >= 0; i--) {
            const escrow = await coreVaultBot.escrow.releaseEscrow(preimages[i]);
            assert.isTrue(escrow != null);
            releasedHashes.push(escrow.preimageHash);
        }
        // console.log(deepFormat({ available: await coreVaultManager.availableFunds(), escrowed: await coreVaultManager.escrowedFunds() }));
        await coreVaultManager.setEscrowsFinished(releasedHashes, { from: governance });
        // transfer from custodian address to core vault and prove the transfer
        const wallet = new MockChainWallet(mockChain);
        assertWeb3Equal(await mockChain.getBalance(coreVaultCustodianAddress), context.convertLotsToUBA(300));
        const txHash = await wallet.addTransaction(coreVaultCustodianAddress, coreVaultUnderlyingAddress, context.convertLotsToUBA(300), null);
        const proof = await context.attestationProvider.provePayment(txHash, coreVaultCustodianAddress, coreVaultUnderlyingAddress);
        await coreVaultManager.confirmPayment(proof);
        // redeemer can now be paid
        const handled4 = await coreVaultBot.triggerAndPerformActions();
        assert.equal(handled4.createdEscrows.length, 0);
        assert.equal(handled4.expiredEscrows.length, 0);
        assert.equal(handled4.payments.length, 1);
        assertApproximatelyEqual(await mockChain.getBalance(redeemer.underlyingAddress), context.convertLotsToUBA(350), 'relative', 0.01);
    });

    it("let the agent transfer to core vault after after failed payment on transfer", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        // request transfer to core vault
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        await minter.performMinting(agent.vaultAddress, 10);
        // update time
        await context.updateUnderlyingBlock();
        // agent requests transfer for all backing to core vault
        const info = await agent.getAgentInfo();
        const transferAmount = info.mintedUBA;
        // transfer to core vault
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = await context.assetManager.transferToCoreVault(agent.agentVault.address, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee })
        // wait for proof unavailability
        const rdreqs = filterEvents(res, "RedemptionRequested").map(evt => evt.args);
        const request = rdreqs[0];
        const txHash = await agent.performPayment(request.paymentAddress, 1, request.paymentReference);
        const proof = await context.attestationProvider.provePayment(txHash, agent.underlyingAddress, request.paymentAddress);
        const rdres = await context.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: agent.ownerWorkAddress });
        expectEvent(rdres, "RedemptionPaymentFailed");
        expectEvent(rdres, "TransferToCoreVaultDefaulted");
        // request transfer to core vault again
        await context.assetManager.transferToCoreVault(agent.agentVault.address, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee })
    })

    it("let the agent transfer to core vault after after default the previous transfer", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        // request transfer to core vault
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        await minter.performMinting(agent.vaultAddress, 10);
        // update time
        await context.updateUnderlyingBlock();
        // agent requests transfer for all backing to core vault
        const info = await agent.getAgentInfo();
        const transferAmount = info.mintedUBA;
        // transfer to core vault
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = await context.assetManager.transferToCoreVault(agent.agentVault.address, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee })
        // wait for proof unavailability
        const rdreqs = filterEvents(res, "RedemptionRequested").map(evt => evt.args);
        context.skipToExpiration(rdreqs[0].lastUnderlyingBlock, rdreqs[0].lastUnderlyingTimestamp);
        await agent.transferToCoreVaultDefault(rdreqs[0]);
        // request transfer to core vault again
        await context.assetManager.transferToCoreVault(agent.agentVault.address, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee })
    })

    it("let the agent transfer to core vault after after failure to perform or default the previous transfer", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1000000));
        // request transfer to core vault
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mint
        await minter.performMinting(agent.vaultAddress, 10);
        // update time
        await context.updateUnderlyingBlock();
        // agent requests transfer for all backing to core vault
        const info = await agent.getAgentInfo();
        const transferAmount = info.mintedUBA;
        // transfer to core vault
        const cbTransferFee = await context.assetManager.transferToCoreVaultFee(transferAmount);
        const res = await context.assetManager.transferToCoreVault(agent.agentVault.address, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee })
        // wait for proof unavailability
        const rdreqs = filterEvents(res, "RedemptionRequested").map(evt => evt.args);
        context.skipToProofUnavailability(rdreqs[0].lastUnderlyingBlock, rdreqs[0].lastUnderlyingTimestamp)
        // finish redemption without payment
        const { 0: currentBlock } = await context.assetManager.currentUnderlyingBlock();
        const proof = await context.attestationProvider.proveConfirmedBlockHeightExists(currentBlock.toNumber())
        await context.assetManager.finishRedemptionWithoutPayment(proof, rdreqs[0].requestId, { from: agent.ownerWorkAddress })
        // request transfer to core vault again
        await context.assetManager.transferToCoreVault(agent.agentVault.address, transferAmount, { from: agent.ownerWorkAddress, value: cbTransferFee })
    })
});
