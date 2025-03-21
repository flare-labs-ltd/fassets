import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { DAYS, toBN, toBNExp, toWei } from "../../../lib/utils/helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockFlareDataConnectorClient } from "../../utils/fasset/MockFlareDataConnectorClient";
import { deterministicTimeIncrease, getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo } from "../utils/TestChainInfo";
import { filterEvents } from "../../../lib/utils/events/truffle";
import { PaymentReference } from "../../../lib/fasset/PaymentReference";
import { Challenger } from "../utils/Challenger";


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

    it("nnez-default-reentrancy - fixed", async () => {
        // Create all essential actors
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        const redeemer2 = await Redeemer.create(context, redeemerAddress2, underlyingRedeemer2);

        // Make agent available with collateral
        const fullAgentCollateral = toWei(6e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // update block
        await context.updateUnderlyingBlock();

        // Perform minting for redeemer1 and redeemer2
        const lots = 3;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash);
        await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
        await context.updateUnderlyingBlock();

        const crt2 = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash2 = await minter.performMintingPayment(crt2);
        const minted2 = await minter.executeMinting(crt2, txHash2);
        await context.fAsset.transfer(redeemer2.address, minted2.mintedAmountUBA, { from: minter.address });
        await context.updateUnderlyingBlock();


        // Deploy malicious executor contract
        const executorFee = toBNExp(1, 9); // set at 1 gwei
        const executorFactory = artifacts.require("MaliciousExecutor");
        const executorInstance = await executorFactory.new(context.assetManager.address);
        const executor = executorInstance.address;

        // Make request for redemptions for both redeemer1 and redeemer2
        const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots, executor, executorFee);
        await redeemer2.requestRedemption(lots, executor, executorFee);

        const request = redemptionRequests[0];

        // mine some blocks to create overflow block
        for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment + 10; i++) {
            await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
        }

        // Generate proof of nonpayment for redeem request of redeemer1
        const proof = await context.attestationProvider.proveReferencedPaymentNonexistence(
            request.paymentAddress,
            request.paymentReference,
            request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(),
            request.lastUnderlyingBlock.toNumber(),
            request.lastUnderlyingTimestamp.toNumber());

        let beforeBalance = await executorInstance.howMuchIsMyNativeBalance();
        let vaultCollateralBalanceBefore = await agent.vaultCollateralToken().balanceOf(redeemerAddress1);

        // FIX: did not revert before
        await expectRevert(executorInstance.defaulting(proof, request.requestId, 1),
            "transfer failed")

        let afterBalance = await executorInstance.howMuchIsMyNativeBalance();
        let vaultCollateralBalanceAfter = await agent.vaultCollateralToken().balanceOf(redeemerAddress1);

        console.log("Executor's native balance (executor fee)");
        console.log("before: ", beforeBalance.toString());
        console.log("after: ", afterBalance.toString());
        console.log("----------");

        console.log("Redeemer1's vault collateral balance");
        console.log("before: ", vaultCollateralBalanceBefore.toString());
        console.log("after: ", vaultCollateralBalanceAfter.toString());

        // FIX: must be zero
        assertWeb3Equal(afterBalance, 0);
        assertWeb3Equal(vaultCollateralBalanceAfter, 0);
    });

    it.skip("HaliPot-force-default", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);

        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));

        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
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

        // perform redemption, the receiveUnderlyingAddress param set to agent.underlyingAddress
        const resD = await context.assetManager.redeem(lots, agent.underlyingAddress, "0x0000000000000000000000000000000000000000",
            { from: redeemer.address, value: undefined });
        const redemptionRequests = filterEvents(resD, 'RedemptionRequested').map(e => e.args);

        const request = redemptionRequests[0];

        // the agent make a payment in underlyingchain, but the souceAddress == spendAddress, so recieveAmount == spentAmount == 0,
        // the recieveAmount < request.underlyingValueUBA - request.underlyingFeeUBA, so _validatePament returns false
        const tx1Hash = await agent.performRedemptionPayment(request);
        // malicious reddemer make the payment field, get the agent's collateral plus a redemption default premium
        await agent.confirmFailedRedemptionPayment(request, tx1Hash);
    });

    it("HaliPot-force-default - fixed", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);

        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));

        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
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

        // perform redemption, the receiveUnderlyingAddress param set to agent.underlyingAddress
        await expectRevert(context.assetManager.redeem(lots, agent.underlyingAddress, "0x0000000000000000000000000000000000000000",
            { from: redeemer.address, value: undefined }),
            "cannot redeem to agent's address");
    });

    it("attacker can prevent agent from calling destroy by depositing malcious token to vault", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // deposit malicious token
        const MaliciousToken = artifacts.require("MaliciousToken");
        const maliciousToken = await MaliciousToken.new();
        // previously, this call worked and prevent later calling destroy()
        await expectRevert(agent.agentVault.depositNat(maliciousToken.address, { value: "1" }),
            "only asset manager");
        // close vault should work now
        await agent.exitAndDestroy();
    });

    it.skip("nnez-force-liquidation", async () => {
        // Vault collateral is USDC, 18 decimals
        // USDC price - 1.01
        // NAT price - 0.42
        // BTC price - 25213
        // System CR
        // - minCollateralRatio for vault is 1.4
        // - minCollateralRatio for pool is 2.0
        // Agent CR
        // - mintingVaultCollateralRatioBIPS: toBIPS(2.0)
        // - mintingPoolCollateralRatioBIPS: toBIPS(2.0)
        // To mimic live agent: https://fasset.oracle-daemon.com/sgb/pools/FDOGE/0x2C919bA9a675c213f5e52125933fdD8854714F53

        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1,
            { mintingVaultCollateralRatioBIPS: 20_000, mintingPoolCollateralRatioBIPS: 20_000 });
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
        let agentInfo;

        // [1] Make agent available and deposits some collateral
        await agent.depositCollateralsAndMakeAvailable(toBNExp(400000, 18), toBNExp(1000000, 18));
        // mine some blocks to skip the agent creation time
        mockChain.mine(5);
        // update block
        await context.updateUnderlyingBlock();
        await context.assetManager.currentUnderlyingBlock();

        // [2] Set up executor exploit contract
        const executorFee = toBN(1000000000);
        const executorFactory = artifacts.require("MaliciousMintExecutor");
        const executorInstance = await executorFactory.new(context.assetManager.address, agent.agentVault.address, minter.address, context.fAsset.address);
        const executor = executorInstance.address;
        // [3] Minter approves explolit contract to spend minted FAsset
        await context.fAsset.approve(executor, toBNExp(10000000, 18), { from: minter.address });

        // [4] Perform minting
        // lotSize = 2
        // underlying chain = BTC
        agentInfo = await agent.getAgentInfo();
        const lots = agentInfo.freeCollateralLots; // mint at maximum available
        console.log(">> reserve collateral, lots=", lots);
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots, executor, executorFee);
        console.log(">> perform payment to agent underlying address");
        const txHash = await minter.performMintingPayment(crt);

        agentInfo = await agent.getAgentInfo();
        console.log("free lots: ", agentInfo.freeCollateralLots.toString());
        console.log("vaultCR after reservation: ", agentInfo.vaultCollateralRatioBIPS);
        console.log("poolCR after reservation: ", agentInfo.poolCollateralRatioBIPS);

        // [5] Exploit
        agentInfo = await agent.getAgentInfo();
        console.log("agent vault collateral in wei before exploit: ", agentInfo.totalVaultCollateralWei);
        console.log(">>> executor call executeMinting");
        const proof = await context.attestationProvider.provePayment(txHash, minter.underlyingAddress, crt.paymentAddress);
        await executorInstance.mint(proof, crt.collateralReservationId);

        // [6] Post-expolitation, observe that vault collateral is reduced due to liquidation
        // Also, observe that vaultCR and poolCR is reduced due to double counting while it should be the same as in after reservation
        agentInfo = await agent.getAgentInfo();
        console.log("agent vault collateral in wei after exploit: ", agentInfo.totalVaultCollateralWei);
        console.log("vaultCR while in executor call: ", (await executorInstance.vaultCR()).toString());
        console.log("poolCR while in executor call: ", (await executorInstance.poolCR()).toString());

        agentInfo = await agent.getAgentInfo();
        console.log("free lots: ", agentInfo.freeCollateralLots.toString());
        console.log("vaultCR after exploit: ", agentInfo.vaultCollateralRatioBIPS);
        console.log("poolCR after exploit: ", agentInfo.poolCollateralRatioBIPS);
    });

    it("nnez-double-redemption", async() => {
        // prepare an agent with collateral
        console.log(">> Prepare an agent with collateral");
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        const innocentBystander = redeemerAddress2;

        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        mockChain.mine(5);

        // mint 4 lots of f-asset (1 lot = 2 BTC)
        await context.updateUnderlyingBlock();
        const lots = 4;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash);

        // agent info after minting
        console.log(">> Simulate minting with agent (4 lots occupied)");
        let agentInfo = await agent.getAgentInfo();
        console.log("AgentInfo after minting");
        console.log("minted | redeeming | reserved");
        console.log(agentInfo.mintedUBA, agentInfo.redeemingUBA, agentInfo.reservedUBA);

        console.log(">> Distribute f-asset to agent's redeemer and innocent bystander");
        // agent controlled redeemer gets some f-asset
        await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA.divRound(toBN(2)), { from: minter.address });
        // innocent bystander gets some f-asset
        await context.fAsset.transfer(innocentBystander, minted.mintedAmountUBA.divRound(toBN(2)), { from: minter.address });

        // agent prepares the exploit
        // create a redemption with invalid receiver address
        console.log(">> Agent creates a redemption request with invalid receiver address");
        const res = await context.assetManager.redeem(1, "MY_INVALID_ADDRESS", "0x0000000000000000000000000000000000000000", { from: redeemer.address });
        agentInfo = await agent.getAgentInfo();
        console.log("AgentInfo after redemption request");
        console.log("minted | redeeming | reserved");
        console.log(agentInfo.mintedUBA, agentInfo.redeemingUBA, agentInfo.reservedUBA);

        const redemptionRequests = filterEvents(res, 'RedemptionRequested').map(e => e.args);
        const request = redemptionRequests[0];

        console.log(">> Simulate timeskip for 1 day, passing attestation window");
        // time skip for about one day for both underlying chain and this chain
        // attestation window seconds: 86400
        mockChain.mine(144);
        mockChain.skipTime(87000);
        await deterministicTimeIncrease(87000);
        await context.updateUnderlyingBlock();

        console.log(">> Agent invokes finishRedemptionWithoutPayment on their own redemption");
        // finish redemption without payment
        // mark first redemption as DEFAULTED and payout via vault/pool collateral
        // because agent is in control of redeemer address, we can just deposit those funds back to the vault and pool
        await agent.finishRedemptionWithoutPayment(request);

        agentInfo = await agent.getAgentInfo();
        console.log("AgenInfo after finishRedemptionWithoutPayment");
        console.log("minted | redeeming | reserved");
        console.log(agentInfo.mintedUBA, agentInfo.redeemingUBA, agentInfo.reservedUBA);

        console.log(">> innocentBystander tries to redeem 1 lot of f-asset");
        // innocentBystander happens to redeem
        const res2 = await context.assetManager.redeem(1, underlyingRedeemer2, "0x0000000000000000000000000000000000000000", { from: innocentBystander });
        const redemptionRequests2 = filterEvents(res2, 'RedemptionRequested').map(e => e.args);
        const request2 = redemptionRequests2[0];

        console.log("AgentInfo after innocentBystander redemption request");
        agentInfo = await agent.getAgentInfo();
        console.log("minted | redeeming | reserved");
        console.log(agentInfo.mintedUBA, agentInfo.redeemingUBA, agentInfo.reservedUBA);

        console.log(">> Agent invokes rejectInvalidRedemption again on their own previous redemption request");
        console.log(">> before prove on non-existence is available");
        // agent invokes `rejectInvalidRedemption` on his own DEFAULTED redemption since it has not been deleted to reduce backing redeeming amount
        const proof = await context.attestationProvider.proveAddressValidity(request.paymentAddress);
        await expectRevert(context.assetManager.rejectInvalidRedemption(proof, request.requestId, { from: agentOwner1 }),
            "invalid redemption status");

        agentInfo = await agent.getAgentInfo();
        console.log("AgentInfo after agent rejecting their own redemption");
        console.log("minted | redeeming | reserved");
        console.log(agentInfo.mintedUBA, agentInfo.redeemingUBA, agentInfo.reservedUBA);

        console.log(">> Simluate timeskip to payment expiration");
        // skip to payment expiration
        context.skipToExpiration(request2.lastUnderlyingBlock, request2.lastUnderlyingTimestamp);

        console.log(">> innocentBystander tries to claim collateral with prove of non-existence payment... but fail terribly");
        // since there is no payment from agent, innocentBystander has to invoke redemptionPaymentDefault to claim agent's collateral
        const proof2 = await context.attestationProvider.proveReferencedPaymentNonexistence(
            request2.paymentAddress,
            request2.paymentReference,
            request2.valueUBA.sub(request.feeUBA),
            request2.firstUnderlyingBlock.toNumber(),
            request2.lastUnderlyingBlock.toNumber(),
            request2.lastUnderlyingTimestamp.toNumber());

        // This will revert due to assertion failure while calculating maxRedemptionCollateral in `executeDefaultPayment`
        // because agent.redeemingAMG is less than request.valueAMG
        await context.assetManager.redemptionPaymentDefault(proof2, request2.requestId, { from: innocentBystander });

    });

    it("nnez-double-redemption with confirmation after finish doesn't work", async () => {
        // prepare an agent with collateral
        console.log(">> Prepare an agent with collateral");
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        const innocentBystander = redeemerAddress2;

        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        mockChain.mine(5);

        // mint 4 lots of f-asset (1 lot = 2 BTC)
        await context.updateUnderlyingBlock();
        const lots = 4;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash);

        // agent info after minting
        console.log(">> Simulate minting with agent (4 lots occupied)");
        let agentInfo = await agent.getAgentInfo();
        console.log("AgentInfo after minting");
        console.log("minted | redeeming | reserved");
        console.log(agentInfo.mintedUBA, agentInfo.redeemingUBA, agentInfo.reservedUBA);

        console.log(">> Distribute f-asset to agent's redeemer and innocent bystander");
        // agent controlled redeemer gets some f-asset
        await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA.divRound(toBN(2)), { from: minter.address });
        // innocent bystander gets some f-asset
        await context.fAsset.transfer(innocentBystander, minted.mintedAmountUBA.divRound(toBN(2)), { from: minter.address });

        // agent prepares the exploit
        // create a redemption with invalid receiver address
        console.log(">> Agent creates a redemption request with invalid receiver address");
        const res = await context.assetManager.redeem(1, "MY_INVALID_ADDRESS", "0x0000000000000000000000000000000000000000", { from: redeemer.address });
        agentInfo = await agent.getAgentInfo();
        console.log("AgentInfo after redemption request");
        console.log("minted | redeeming | reserved");
        console.log(agentInfo.mintedUBA, agentInfo.redeemingUBA, agentInfo.reservedUBA);

        const redemptionRequests = filterEvents(res, 'RedemptionRequested').map(e => e.args);
        const request = redemptionRequests[0];

        // pay for redemption
        const rpTx = await agent.performRedemptionPayment(request);

        console.log(">> Simulate timeskip for 1 day, passing attestation window");
        // time skip for about one day for both underlying chain and this chain
        // attestation window seconds: 86400
        mockChain.mine(144);
        mockChain.skipTime(87000);
        await deterministicTimeIncrease(87000);
        await context.updateUnderlyingBlock();

        console.log(">> Agent invokes finishRedemptionWithoutPayment on their own redemption");
        // finish redemption without payment
        // mark first redemption as DEFAULTED and payout via vault/pool collateral
        // because agent is in control of redeemer address, we can just deposit those funds back to the vault and pool
        await agent.finishRedemptionWithoutPayment(request);

        agentInfo = await agent.getAgentInfo();
        console.log("AgenInfo after finishRedemptionWithoutPayment");
        console.log("minted | redeeming | reserved");
        console.log(agentInfo.mintedUBA, agentInfo.redeemingUBA, agentInfo.reservedUBA);

        console.log(">> innocentBystander tries to redeem 1 lot of f-asset");
        // innocentBystander happens to redeem
        const res2 = await context.assetManager.redeem(1, underlyingRedeemer2, "0x0000000000000000000000000000000000000000", { from: innocentBystander });
        const redemptionRequests2 = filterEvents(res2, 'RedemptionRequested').map(e => e.args);
        const request2 = redemptionRequests2[0];

        console.log("AgentInfo after innocentBystander redemption request");
        agentInfo = await agent.getAgentInfo();
        console.log("minted | redeeming | reserved");
        console.log(agentInfo.mintedUBA, agentInfo.redeemingUBA, agentInfo.reservedUBA);

        console.log(">> Agent invokes rejectInvalidRedemption again on their own previous redemption request");
        console.log(">> before prove on non-existence is available");
        // agent invokes `confirmActiveRedemptionPayment` on his own expired redemption since it has not been deleted to reduce backing redeeming amount
        const proof1 = await context.attestationProvider.provePayment(rpTx, agent.underlyingAddress, request.paymentAddress);
        const res1 = await context.assetManager.confirmRedemptionPayment(proof1, request.requestId, { from: agent.ownerWorkAddress });
        expectEvent.notEmitted(res1, "RedemptionPerformed");
        expectEvent(res1, "RedemptionPaymentFailed", { failureReason: "redemption already defaulted" });

        agentInfo = await agent.getAgentInfo();
        console.log("AgentInfo after agent rejecting their own redemption");
        console.log("minted | redeeming | reserved");
        console.log(agentInfo.mintedUBA, agentInfo.redeemingUBA, agentInfo.reservedUBA);

        console.log(">> Simluate timeskip to payment expiration");
        // skip to payment expiration
        context.skipToExpiration(request2.lastUnderlyingBlock, request2.lastUnderlyingTimestamp);

        console.log(">> innocentBystander tries to claim collateral with prove of non-existence payment... but fail terribly");
        // since there is no payment from agent, innocentBystander has to invoke redemptionPaymentDefault to claim agent's collateral
        const proof2 = await context.attestationProvider.proveReferencedPaymentNonexistence(
            request2.paymentAddress,
            request2.paymentReference,
            request2.valueUBA.sub(request.feeUBA),
            request2.firstUnderlyingBlock.toNumber(),
            request2.lastUnderlyingBlock.toNumber(),
            request2.lastUnderlyingTimestamp.toNumber());

        // This will revert due to assertion failure while calculating maxRedemptionCollateral in `executeDefaultPayment`
        // because agent.redeemingAMG is less than request.valueAMG
        await context.assetManager.redemptionPaymentDefault(proof2, request2.requestId, { from: innocentBystander });

    });

    it("nnez-negative-spent-amount-from-another-source - must fail", async() => {

        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
        const minter2 = await Minter.createTest(context, minterAddress2, underlyingMinter2, context.underlyingAmount(10000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);

        // prepare an agent with collateral
        console.log(">> Prepare an agent with collateral");
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        mockChain.mine(5);

        console.log(">> Minting 3 lots of FAsset");
        await context.updateUnderlyingBlock();
        const lots = 3;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash);

        await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });

        console.log(">> Make a redemption request on self");
        const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
        const request = redemptionRequests[0];

        console.log(">> Perform payment that results in negative spentAmont of source");
        const paymentAmount = request.valueUBA.sub(request.feeUBA);
        /**
        inUTXO
        underlyingMinter1 : 1
        underlyingMinter2: 1000+redemptionAmount

        outUTXO
        underlyingMinter1: 1000
        redeemer: redemptionAmount
        */
        let redeemPaymentTxHash = await agent.wallet.addMultiTransaction(
            {
                [underlyingMinter1]: context.underlyingAmount(1),
                [underlyingMinter2]: context.underlyingAmount(1000).add(paymentAmount)
            },
            {
                [redeemer.underlyingAddress]: paymentAmount,
                [underlyingMinter1]: context.underlyingAmount(1000)
            },
            PaymentReference.redemption(request.requestId)
        );

        let underlyingBalanceBefore = (await agent.getAgentInfo()).underlyingBalanceUBA;

        console.log(">> Request proof, specifying underlyingMinter1 as source");
        const proof = await context.attestationProvider.provePayment(redeemPaymentTxHash, underlyingMinter1, request.paymentAddress);
        console.log(">> spentAmount: ", proof.data.responseBody.spentAmount);

        console.log(">> Confirm redemption payment");
        // this was successfull before fix
        await expectRevert(context.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: agent.ownerWorkAddress }),
            "source not agent's underlying address");

        let underlyingBalanceAfter = (await agent.getAgentInfo()).underlyingBalanceUBA;
        console.log(">> underlyingBalance before: ", underlyingBalanceBefore);
        console.log(">> underlyingBalance after: ", underlyingBalanceAfter);
        console.log(">> underlyingBalance on underlying chain: ", (await context.chain.getBalance(agent.underlyingAddress)).toString());

    });

    it("nnez-circumventing-challenges", async () => {
        // Prelim setup
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        const challenger = await Challenger.create(context, challengerAddress1);

        // Make agent available and deposit some collateral
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // update block, passing agent creation block
        await context.updateUnderlyingBlock();

        // Perform minting
        const lots = 3;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash);

        await context.assetManager.announceAgentSettingUpdate(agent.agentVault.address, "handshakeType", 1, {from: agentOwner1});
        // agentFeeChangeTimelockSeconds: 21600
        // skip time to execute change of setting
        await deterministicTimeIncrease(6 * 3600 + 1);
        mockChain.skipTime(6 * 3600 + 12);
        mockChain.mine((6*3600/12) + 1);
        await context.assetManager.executeAgentSettingUpdate(agent.agentVault.address, "handshakeType", {from: agentOwner1});

        // Make a redemption request to agent's owned address
        await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
        const [redemptionRequests,,,] = await redeemer.requestRedemption(lots);
        const request = redemptionRequests[0];

        // Reject redemption so that it cannot be confirmed by any proof of payment
        await context.assetManager.rejectRedemptionRequest(request.requestId, {from: agentOwner1});

        // Assume no one is taking over

        // Perform the first payment
        const paymentAmount = request.valueUBA.sub(request.feeUBA);
        const tx1Hash = await agent.performPayment(request.paymentAddress, paymentAmount, request.paymentReference);

        await deterministicTimeIncrease((await context.assetManager.getSettings()).confirmationByOthersAfterSeconds);
        // No one can confirm this payment because this redemption is already rejected
        await expectRevert(agent.confirmActiveRedemptionPayment(request, tx1Hash), 'rejected redemption cannot be confirmed');

        // Agent waits for 14 days
        await deterministicTimeIncrease(15 * DAYS + 10);
        mockChain.skipTime(14 * DAYS + 10);
        mockChain.mine(100*14);

        // perform double payment to the same payment reference
        const tx2Hash = await agent.performPayment(request.paymentAddress, paymentAmount, request.paymentReference);

        // shows that it's impossible to challenge this act of wrongdoing
        await expectRevert(challenger.doublePaymentChallenge(agent, tx1Hash, tx2Hash), 'verified transaction too old');
        await expectRevert(challenger.illegalPaymentChallenge(agent, tx1Hash), 'verified transaction too old');
        await expectRevert(challenger.illegalPaymentChallenge(agent, tx2Hash), 'matching redemption active')
        await expectRevert(challenger.freeBalanceNegativeChallenge(agent, [tx1Hash, tx2Hash]), 'verified transaction too old');
        await expectRevert(challenger.freeBalanceNegativeChallenge(agent, [tx2Hash]), 'mult chlg: enough balance');

        // After exploitation, agent can close the redemption by calling `rejectedRedemptionPaymentDefault`
        await context.assetManager.rejectedRedemptionPaymentDefault(request.requestId, {from: agentOwner1});
    });
});
