import { expectRevert } from "@openzeppelin/test-helpers";
import { requiredEventArgs } from "../../../lib/utils/events/truffle";
import { MAX_BIPS, toBN, toWei } from "../../../lib/utils/helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo } from "../utils/TestChainInfo";

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

    let commonContext: CommonContext;
    let context: AssetContext;
    let mockChain: MockChain;

    async function initialize() {
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.btc);
        return { commonContext, context };
    }

    beforeEach(async () => {
        ({ commonContext, context } = await loadFixtureCopyVars(initialize));
        mockChain = context.chain as MockChain;
    });

    it("should approve collateral reservation, mint and redeem f-assets", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1, { handshakeType: 1 });
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mine some blocks to skip the agent creation time
        mockChain.mine(5);
        // update block
        const blockNumber = await context.updateUnderlyingBlock();
        const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
        assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
        assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);
        // perform minting (hand-shake is required)
        const lots = 3;
        const crFee = await minter.getCollateralReservationFee(lots);
        const crtHs = await minter.reserveCollateralHSRequired(agent.vaultAddress, lots, [minter.underlyingAddress]);
        // approve collateral reservation
        const tx1 = await context.assetManager.approveCollateralReservation(crtHs.collateralReservationId, { from: agentOwner1 });
        const crt = requiredEventArgs(tx1, "CollateralReserved");
        const txHash = await minter.performMintingPayment(crt);
        const lotsUBA = context.convertLotsToUBA(lots);
        await agent.checkAgentInfo({
            totalVaultCollateralWei: fullAgentCollateral,
            reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA))
        });
        const burnAddress = context.settings.burnAddress;
        const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
        const minted = await minter.executeMinting(crt, txHash);
        const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
        assertWeb3Equal(minted.mintedAmountUBA, lotsUBA);
        const poolFeeShare = crt.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
        assertWeb3Equal(poolFeeShare, minted.poolFeeUBA);
        const agentFeeShare = crt.feeUBA.sub(poolFeeShare);
        assertWeb3Equal(agentFeeShare, minted.agentFeeUBA);
        const mintedUBA = crt.valueUBA.add(poolFeeShare);
        await agent.checkAgentInfo({ mintedUBA: mintedUBA, reservedUBA: 0 });
        // redeemer "buys" f-assets
        await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
        // perform redemption
        const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare, mintedUBA: poolFeeShare, redeemingUBA: lotsUBA });
        assertWeb3Equal(remainingLots, 0);
        assert.equal(dustChanges.length, 0);
        assert.equal(redemptionRequests.length, 1);
        const request = redemptionRequests[0];
        assert.equal(request.agentVault, agent.vaultAddress);
        const tx1Hash = await agent.performRedemptionPayment(request);
        await agent.confirmActiveRedemptionPayment(request, tx1Hash);
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request.feeUBA), redeemingUBA: 0 });
        // agent can exit now
        await agent.exitAndDestroy(fullAgentCollateral);
    });

    it("should approve collateral reservation, mint, reject redemption request, take over and redeem f-assets", async () => {
        // create users
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1, { handshakeType: 1 });
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2, { handshakeType: 0 });
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
        const minter2 = await Minter.createTest(context, minterAddress2, underlyingMinter2, context.underlyingAmount(10000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        const redeemer2 = await Redeemer.create(context, redeemerAddress2, underlyingRedeemer2);
        // make agents available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mine some blocks to skip the agent creation time
        mockChain.mine(5);
        // update block
        const blockNumber = await context.updateUnderlyingBlock();
        const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
        assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
        assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);

        //// perform minting for minter1 (hand-shake is required)
        const lots = 3;
        const crFee = await minter.getCollateralReservationFee(lots);
        const crtHs = await minter.reserveCollateralHSRequired(agent.vaultAddress, lots, [minter.underlyingAddress]);
        // approve collateral reservation
        const tx1 = await context.assetManager.approveCollateralReservation(crtHs.collateralReservationId, { from: agentOwner1 });
        const crt = requiredEventArgs(tx1, "CollateralReserved");
        const txHash = await minter.performMintingPayment(crt);
        const lotsUBA = context.convertLotsToUBA(lots);
        await agent.checkAgentInfo({
            totalVaultCollateralWei: fullAgentCollateral,
            reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA))
        });
        const burnAddress = context.settings.burnAddress;
        const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
        const minted = await minter.executeMinting(crt, txHash);
        const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
        assertWeb3Equal(minted.mintedAmountUBA, lotsUBA);
        const poolFeeShare = crt.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
        assertWeb3Equal(poolFeeShare, minted.poolFeeUBA);
        const agentFeeShare = crt.feeUBA.sub(poolFeeShare);
        assertWeb3Equal(agentFeeShare, minted.agentFeeUBA);
        const mintedUBA = crt.valueUBA.add(poolFeeShare);
        await agent.checkAgentInfo({ mintedUBA: mintedUBA, reservedUBA: 0 });
        // redeemer "buys" f-assets
        await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });

        //// perform minting for minter2 (hand-shake is not required)
        const crt2 = await minter2.reserveCollateral(agent2.vaultAddress, lots);
        const txHash2 = await minter2.performMintingPayment(crt2);
        await agent2.checkAgentInfo({
            totalVaultCollateralWei: fullAgentCollateral,
            reservedUBA: lotsUBA.add(agent2.poolFeeShare(crt2.feeUBA))
        });
        const startBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
        const minted2 = await minter2.executeMinting(crt2, txHash2);
        const endBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
        assertWeb3Equal(minted2.mintedAmountUBA, lotsUBA);
        const poolFeeShare2 = crt2.feeUBA.mul(toBN(agent2.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
        assertWeb3Equal(poolFeeShare2, minted2.poolFeeUBA);
        const agentFeeShare2 = crt2.feeUBA.sub(poolFeeShare2);
        assertWeb3Equal(agentFeeShare2, minted2.agentFeeUBA);
        const mintedUBA2 = crt2.valueUBA.add(poolFeeShare2);
        await agent2.checkAgentInfo({ mintedUBA: mintedUBA2, reservedUBA: 0 });
        // redeemer "buys" f-assets
        await context.fAsset.transfer(redeemer2.address, minted2.mintedAmountUBA, { from: minter2.address });

        // redeemer1 requests redemption
        const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
        const request = redemptionRequests[0];
        // agent rejects redemption request
        const resRejected = await context.assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        requiredEventArgs(resRejected, 'RedemptionRequestRejected');

        // agent2 takes over the redemption request
        const resTakeOver = await context.assetManager.takeOverRedemptionRequest(agent2.agentVault.address, request.requestId, { from: agentOwner2 });
        const newRequest = requiredEventArgs(resTakeOver, 'RedemptionRequested');

        await agent2.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2, mintedUBA: poolFeeShare2, redeemingUBA: lotsUBA });
        assertWeb3Equal(remainingLots, 0);
        assert.equal(dustChanges.length, 0);
        assert.equal(redemptionRequests.length, 1);
        assert.equal(request.agentVault, agent.vaultAddress);
        assert.equal(newRequest.agentVault, agent2.vaultAddress);
        // agent2 performs redemption payment
        const tx1Hash = await agent2.performRedemptionPayment(newRequest);
        // redemption for old request can't be confirmed because it was rejected and deleted
        await expectRevert(agent2.confirmActiveRedemptionPayment(request, tx1Hash), "invalid request id");
        // agent2 confirms redemption
        await agent2.confirmActiveRedemptionPayment(newRequest, tx1Hash);
        await agent2.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2.add(newRequest.feeUBA), redeemingUBA: 0 });
        // agent can exit now
        await agent2.exitAndDestroy(fullAgentCollateral);

        // redeemer2 requests redemption
        const [redemptionRequests2, remainingLots2, dustChanges2] = await redeemer2.requestRedemption(lots);
        const request2 = redemptionRequests2[0];
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare, mintedUBA: poolFeeShare, redeemingUBA: lotsUBA });
        assertWeb3Equal(remainingLots2, 0);
        assert.equal(dustChanges2.length, 0);
        assert.equal(redemptionRequests2.length, 1);
        assert.equal(request2.agentVault, agent.vaultAddress);
        const tx2Hash = await agent.performRedemptionPayment(request2);
        await agent.confirmActiveRedemptionPayment(request2, tx2Hash);
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request2.feeUBA), redeemingUBA: 0 });
        // agent can exit now
        await agent.exitAndDestroy(fullAgentCollateral);
    });

    it("should approve collateral reservation, mint, reject redemption request, partially take over and default for the remaining", async () => {
        // create users
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1, { handshakeType: 1 });
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2, { handshakeType: 0 });
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
        const minter2 = await Minter.createTest(context, minterAddress2, underlyingMinter2, context.underlyingAmount(10000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        const redeemer2 = await Redeemer.create(context, redeemerAddress2, underlyingRedeemer2);
        // make agents available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mine some blocks to skip the agent creation time
        mockChain.mine(5);
        // update block
        const blockNumber = await context.updateUnderlyingBlock();
        const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
        assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
        assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);

        //// perform minting for minter1 (hand-shake is required)
        const lots1 = 3;
        const crFee1 = await minter.getCollateralReservationFee(lots1);
        const crtHs = await minter.reserveCollateralHSRequired(agent.vaultAddress, lots1, [minter.underlyingAddress]);
        // approve collateral reservation
        const tx1 = await context.assetManager.approveCollateralReservation(crtHs.collateralReservationId, { from: agentOwner1 });
        const crt = requiredEventArgs(tx1, "CollateralReserved");
        const txHash = await minter.performMintingPayment(crt);
        const lotsUBA1 = context.convertLotsToUBA(lots1);
        await agent.checkAgentInfo({
            totalVaultCollateralWei: fullAgentCollateral,
            reservedUBA: lotsUBA1.add(agent.poolFeeShare(crt.feeUBA))
        });
        const burnAddress = context.settings.burnAddress;
        const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
        const minted = await minter.executeMinting(crt, txHash);
        const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
        assertWeb3Equal(minted.mintedAmountUBA, lotsUBA1);
        const poolFeeShare = crt.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
        assertWeb3Equal(poolFeeShare, minted.poolFeeUBA);
        const agentFeeShare = crt.feeUBA.sub(poolFeeShare);
        assertWeb3Equal(agentFeeShare, minted.agentFeeUBA);
        const mintedUBA = crt.valueUBA.add(poolFeeShare);
        await agent.checkAgentInfo({ mintedUBA: mintedUBA, reservedUBA: 0 });
        // redeemer "buys" f-assets
        await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });

        //// perform minting for minter2 (hand-shake is not required)
        const lots2 = 2;
        const lotsUBA2 = context.convertLotsToUBA(lots2);
        const crFee2 = await minter2.getCollateralReservationFee(lots2);
        const crt2 = await minter2.reserveCollateral(agent2.vaultAddress, lots2);
        const txHash2 = await minter2.performMintingPayment(crt2);
        await agent2.checkAgentInfo({
            totalVaultCollateralWei: fullAgentCollateral,
            reservedUBA: lotsUBA2.add(agent2.poolFeeShare(crt2.feeUBA))
        });
        const startBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
        const minted2 = await minter2.executeMinting(crt2, txHash2);
        const endBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
        assertWeb3Equal(minted2.mintedAmountUBA, lotsUBA2);
        const poolFeeShare2 = crt2.feeUBA.mul(toBN(agent2.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
        assertWeb3Equal(poolFeeShare2, minted2.poolFeeUBA);
        const agentFeeShare2 = crt2.feeUBA.sub(poolFeeShare2);
        assertWeb3Equal(agentFeeShare2, minted2.agentFeeUBA);
        const mintedUBA2 = crt2.valueUBA.add(poolFeeShare2);
        await agent2.checkAgentInfo({ mintedUBA: mintedUBA2, reservedUBA: 0 });
        // redeemer "buys" f-assets
        await context.fAsset.transfer(redeemer2.address, minted2.mintedAmountUBA, { from: minter2.address });

        // redeemer1 requests redemption (3 lots)
        const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots1);
        const request = redemptionRequests[0];
        // agent rejects redemption request
        const resRejected = await context.assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        requiredEventArgs(resRejected, 'RedemptionRequestRejected');

        // agent2 takes over the redemption request
        // agent2 minted only 2 lots, so it can't fulfill the request entirely
        const resTakeOver = await context.assetManager.takeOverRedemptionRequest(agent2.agentVault.address, request.requestId, { from: agentOwner2 });
        const newRequest = requiredEventArgs(resTakeOver, 'RedemptionRequested');
        const newRedemptionTicket = requiredEventArgs(resTakeOver, 'RedemptionTicketCreated');
        const requestTakenOver = requiredEventArgs(resTakeOver, 'RedemptionRequestTakenOver');
        assertWeb3Equal(newRedemptionTicket.agentVault, agent.vaultAddress);
        // agent2 closed 2 lots
        assertWeb3Equal(newRedemptionTicket.ticketValueUBA, requestTakenOver.valueTakenOverUBA);

        await agent2.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2, mintedUBA: poolFeeShare2, redeemingUBA: lotsUBA2 });
        assertWeb3Equal(remainingLots, 0);
        assert.equal(dustChanges.length, 0);
        assert.equal(redemptionRequests.length, 1);
        assert.equal(request.agentVault, agent.vaultAddress);
        assert.equal(newRequest.agentVault, agent2.vaultAddress);
        // agent2 performs redemption payment
        const tx1Hash = await agent2.performRedemptionPayment(newRequest);
        // agent2 confirms redemption
        await agent2.confirmActiveRedemptionPayment(newRequest, tx1Hash);
        await agent2.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2.add(newRequest.feeUBA), redeemingUBA: 0 });
        // agent can exit now
        await agent2.exitAndDestroy(fullAgentCollateral);

        // redeemer2 requests redemption (2 lots)
        const [redemptionRequests2, remainingLots2, dustChanges2] = await redeemer2.requestRedemption(lots2);
        const request2 = redemptionRequests2[0];

        const lots1UBA = context.convertLotsToUBA(1);
        // redeemingUBA = 2 lots + 1 remaining lot from the previous request which was not taken over entirely
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare, mintedUBA: poolFeeShare, redeemingUBA: lotsUBA2.add(lots1UBA) });
        assertWeb3Equal(remainingLots2, 0);
        assert.equal(dustChanges2.length, 0);
        assert.equal(redemptionRequests2.length, 1);
        assert.equal(request2.agentVault, agent.vaultAddress);
        const tx2Hash = await agent.performRedemptionPayment(request2);
        await agent.confirmActiveRedemptionPayment(request2, tx2Hash);
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request2.feeUBA), redeemingUBA: lots1UBA });

        // agent can't exit yet because it has 1 lot remaining
        // it can either wait that another agent takes over the remaining lot or until it calls rejectedRedemptionPaymentDefault
        const defaultsRes = await context.assetManager.rejectedRedemptionPaymentDefault(request.requestId, { from: agentOwner1 });
        const defaultArgs = requiredEventArgs(defaultsRes, 'RedemptionDefault')
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request2.feeUBA).add(lots1UBA), redeemingUBA: 0, totalVaultCollateralWei: fullAgentCollateral.sub(defaultArgs.redeemedVaultCollateralWei) });

        await agent.exitAndDestroy(fullAgentCollateral.sub(defaultArgs.redeemedVaultCollateralWei));
    });

    it("should approve collateral reservation, mint, reject redemption request, partially take over and another agent take over the remaining", async () => {
        // create users
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1, { handshakeType: 1 });
        const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2, { handshakeType: 0 });
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
        const minter2 = await Minter.createTest(context, minterAddress2, underlyingMinter2, context.underlyingAmount(10000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        const redeemer2 = await Redeemer.create(context, redeemerAddress2, underlyingRedeemer2);
        const agent3 = await Agent.createTest(context, agentOwner3, underlyingAgent3, { handshakeType: 0 });
        const minter3 = await Minter.createTest(context, minterAddress3, underlyingMinter3, context.underlyingAmount(10000));
        const redeemer3 = await Redeemer.create(context, redeemerAddress3, underlyingRedeemer3);

        // make agents available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        await agent2.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        await agent3.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mine some blocks to skip the agent creation time
        mockChain.mine(5);
        // update block
        const blockNumber = await context.updateUnderlyingBlock();
        const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
        assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
        assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);

        //// perform minting for minter1 (hand-shake is required)
        const lots1 = 3;
        const crFee1 = await minter.getCollateralReservationFee(lots1);
        const crtHs = await minter.reserveCollateralHSRequired(agent.vaultAddress, lots1, [minter.underlyingAddress]);
        // approve collateral reservation
        const tx1 = await context.assetManager.approveCollateralReservation(crtHs.collateralReservationId, { from: agentOwner1 });
        const crt = requiredEventArgs(tx1, "CollateralReserved");
        const txHash = await minter.performMintingPayment(crt);
        const lotsUBA1 = context.convertLotsToUBA(lots1);
        await agent.checkAgentInfo({
            totalVaultCollateralWei: fullAgentCollateral,
            reservedUBA: lotsUBA1.add(agent.poolFeeShare(crt.feeUBA))
        });
        const burnAddress = context.settings.burnAddress;
        const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
        const minted = await minter.executeMinting(crt, txHash);
        const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
        assertWeb3Equal(minted.mintedAmountUBA, lotsUBA1);
        const poolFeeShare = crt.feeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
        assertWeb3Equal(poolFeeShare, minted.poolFeeUBA);
        const agentFeeShare = crt.feeUBA.sub(poolFeeShare);
        assertWeb3Equal(agentFeeShare, minted.agentFeeUBA);
        const mintedUBA = crt.valueUBA.add(poolFeeShare);
        await agent.checkAgentInfo({ mintedUBA: mintedUBA, reservedUBA: 0 });
        // redeemer "buys" f-assets
        await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });

        //// perform minting for minter2 (hand-shake is not required)
        const lots2 = 2;
        const lotsUBA2 = context.convertLotsToUBA(lots2);
        const crFee2 = await minter2.getCollateralReservationFee(lots2);
        const crt2 = await minter2.reserveCollateral(agent2.vaultAddress, lots2);
        const txHash2 = await minter2.performMintingPayment(crt2);
        await agent2.checkAgentInfo({
            totalVaultCollateralWei: fullAgentCollateral,
            reservedUBA: lotsUBA2.add(agent2.poolFeeShare(crt2.feeUBA))
        });
        const startBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
        const minted2 = await minter2.executeMinting(crt2, txHash2);
        const endBalanceBurnAddress2 = toBN(await web3.eth.getBalance(burnAddress));
        assertWeb3Equal(minted2.mintedAmountUBA, lotsUBA2);
        const poolFeeShare2 = crt2.feeUBA.mul(toBN(agent2.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
        assertWeb3Equal(poolFeeShare2, minted2.poolFeeUBA);
        const agentFeeShare2 = crt2.feeUBA.sub(poolFeeShare2);
        assertWeb3Equal(agentFeeShare2, minted2.agentFeeUBA);
        const mintedUBA2 = crt2.valueUBA.add(poolFeeShare2);
        await agent2.checkAgentInfo({ mintedUBA: mintedUBA2, reservedUBA: 0 });
        // redeemer "buys" f-assets
        await context.fAsset.transfer(redeemer2.address, minted2.mintedAmountUBA, { from: minter2.address });

        // perform minting for minter3 (hand-shake is not required)
        const lots3 = 1;
        const lotsUBA3 = context.convertLotsToUBA(lots3);
        const crFee3 = await minter3.getCollateralReservationFee(lots3);
        const crt3 = await minter3.reserveCollateral(agent3.vaultAddress, lots3);
        const txHash3 = await minter3.performMintingPayment(crt3);
        await agent3.checkAgentInfo({
            totalVaultCollateralWei: fullAgentCollateral,
            reservedUBA: lotsUBA3.add(agent3.poolFeeShare(crt3.feeUBA))
        });
        const startBalanceBurnAddress3 = toBN(await web3.eth.getBalance(burnAddress));
        const minted3 = await minter3.executeMinting(crt3, txHash3);
        const endBalanceBurnAddress3 = toBN(await web3.eth.getBalance(burnAddress));
        assertWeb3Equal(minted3.mintedAmountUBA, lotsUBA3);
        const poolFeeShare3 = crt3.feeUBA.mul(toBN(agent3.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
        assertWeb3Equal(poolFeeShare3, minted3.poolFeeUBA);
        const agentFeeShare3 = crt3.feeUBA.sub(poolFeeShare3);
        assertWeb3Equal(agentFeeShare3, minted3.agentFeeUBA);
        const mintedUBA3 = crt3.valueUBA.add(poolFeeShare3);
        await agent3.checkAgentInfo({ mintedUBA: mintedUBA3, reservedUBA: 0 });
        // redeemer "buys" f-assets
        await context.fAsset.transfer(redeemer3.address, minted3.mintedAmountUBA, { from: minter3.address });

        // redeemer1 requests redemption (3 lots)
        const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots1);
        const request = redemptionRequests[0];
        // agent rejects redemption request
        const resRejected = await context.assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        requiredEventArgs(resRejected, 'RedemptionRequestRejected');


        await agent.checkAgentInfo({ mintedUBA: poolFeeShare, redeemingUBA: lotsUBA1 });
        // agent2 takes over the redemption request
        // agent2 minted only 2 lots, so it can't fulfill the request entirely
        const resTakeOver = await context.assetManager.takeOverRedemptionRequest(agent2.agentVault.address, request.requestId, { from: agentOwner2 });
        await agent.checkAgentInfo({ mintedUBA: poolFeeShare.add(lotsUBA2), redeemingUBA: lotsUBA1.sub(lotsUBA2) });
        // agent3 takes over the remaining redemption request (1 lot)
        const takeOverLots3 = context.convertLotsToUBA(1);
        const resTakeOver3 = await context.assetManager.takeOverRedemptionRequest(agent3.agentVault.address, request.requestId, { from: agentOwner3 });
        await agent.checkAgentInfo({ mintedUBA: poolFeeShare.add(lotsUBA2).add(takeOverLots3), redeemingUBA: lotsUBA1.sub(lotsUBA2).sub(takeOverLots3) });
        const newRequest = requiredEventArgs(resTakeOver, 'RedemptionRequested');
        const newRedemptionTicket = requiredEventArgs(resTakeOver, 'RedemptionTicketCreated');
        const requestTakenOver = requiredEventArgs(resTakeOver, 'RedemptionRequestTakenOver');
        assertWeb3Equal(newRedemptionTicket.agentVault, agent.vaultAddress);
        // agent2 closed 2 lots
        assertWeb3Equal(newRedemptionTicket.ticketValueUBA, requestTakenOver.valueTakenOverUBA);

        await agent2.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2, mintedUBA: poolFeeShare2, redeemingUBA: lotsUBA2 });
        assertWeb3Equal(remainingLots, 0);
        assert.equal(dustChanges.length, 0);
        assert.equal(redemptionRequests.length, 1);
        assert.equal(request.agentVault, agent.vaultAddress);
        assert.equal(newRequest.agentVault, agent2.vaultAddress);
        // agent2 performs redemption payment
        const tx1Hash = await agent2.performRedemptionPayment(newRequest);
        // agent2 confirms redemption
        await agent2.confirmActiveRedemptionPayment(newRequest, tx1Hash);
        await agent2.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare2.add(newRequest.feeUBA), redeemingUBA: 0 });
        // agent2 can exit now
        await agent2.exitAndDestroy(fullAgentCollateral);

        const newRequest1 = requiredEventArgs(resTakeOver3, 'RedemptionRequested');
        const newRedemptionTicket1 = requiredEventArgs(resTakeOver3, 'RedemptionTicketUpdated');
        const requestTakenOver1 = requiredEventArgs(resTakeOver3, 'RedemptionRequestTakenOver');
        assertWeb3Equal(newRedemptionTicket1.agentVault, agent.vaultAddress);
        // agent2 closed 2 lots
        // ticket from second take-over was merged with ticket from first take-over
        assertWeb3Equal(newRedemptionTicket1.ticketValueUBA, toBN(requestTakenOver.valueTakenOverUBA).add(requestTakenOver1.valueTakenOverUBA));
        assertWeb3Equal(newRedemptionTicket1.redemptionTicketId, newRedemptionTicket.redemptionTicketId);

        await agent3.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare3, mintedUBA: poolFeeShare3, redeemingUBA: lotsUBA3 });
        assertWeb3Equal(remainingLots, 0);
        assert.equal(dustChanges.length, 0);
        assert.equal(redemptionRequests.length, 1);
        assert.equal(request.agentVault, agent.vaultAddress);
        assert.equal(newRequest.agentVault, agent2.vaultAddress);
        // agent2 performs redemption payment
        const tx3Hash = await agent3.performRedemptionPayment(newRequest1);
        // agent2 confirms redemption
        await agent3.confirmActiveRedemptionPayment(newRequest1, tx3Hash);
        await agent3.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare3.add(newRequest1.feeUBA), redeemingUBA: 0 });
        // agent3 can exit now
        await agent3.exitAndDestroy(fullAgentCollateral);

        // redeemer2 requests redemption (2 lots)
        // agent1 will send 2 lots to redeemer2
        const [redemptionRequests2, remainingLots2, dustChanges2] = await redeemer2.requestRedemption(lots2);
        const request2 = redemptionRequests2[0];
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare, mintedUBA: poolFeeShare.add(lotsUBA3), redeemingUBA: lotsUBA2 });
        assertWeb3Equal(remainingLots2, 0);
        assert.equal(dustChanges2.length, 0);
        assert.equal(redemptionRequests2.length, 1);
        assert.equal(request2.agentVault, agent.vaultAddress);
        const tx2Hash = await agent.performRedemptionPayment(request2);
        await agent.confirmActiveRedemptionPayment(request2, tx2Hash);
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request2.feeUBA), redeemingUBA: 0 });

        // redeemer 3 requests redemption (1 lot)
        // agent1 will send 1 lot to redeemer3
        const [redemptionRequests3, remainingLots3, dustChanges3] = await redeemer3.requestRedemption(lots3);
        const request3 = redemptionRequests3[0];
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request2.feeUBA), mintedUBA: poolFeeShare, redeemingUBA: lotsUBA3 });
        assertWeb3Equal(remainingLots3, 0);
        assert.equal(dustChanges3.length, 0);
        assert.equal(redemptionRequests2.length, 1);
        assert.equal(request3.agentVault, agent.vaultAddress);
        const tx4Hash = await agent.performRedemptionPayment(request3);
        await agent.confirmActiveRedemptionPayment(request3, tx4Hash);
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request2.feeUBA).add(request3.feeUBA), redeemingUBA: 0 });

        // agent1 can now exit
        await agent.exitAndDestroy(fullAgentCollateral);
    });
});
