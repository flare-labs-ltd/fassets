import { expectRevert } from "@openzeppelin/test-helpers";
import { toBNExp, toWei } from "../../../lib/utils/helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockFlareDataConnectorClient } from "../../utils/fasset/MockFlareDataConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo } from "../utils/TestChainInfo";
import { filterEvents } from "../../../lib/utils/events/truffle";


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

    it.only("HaliPot-force-default", async () => {
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
});
