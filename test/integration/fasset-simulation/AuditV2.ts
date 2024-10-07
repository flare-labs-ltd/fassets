import { expectRevert, time } from "@openzeppelin/test-helpers";
import { BN_ZERO, BNish, MAX_BIPS, toBN, toBNExp, toWei } from "../../../lib/utils/helpers";
import { impersonateContract, stopImpersonatingContract } from "../../utils/contract-test-helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo } from "../utils/TestChainInfo";

const WNat = artifacts.require("WNat");
const AgentVault = artifacts.require('AgentVault');
const CollateralPool = artifacts.require('CollateralPool');
const CollateralPoolToken = artifacts.require('CollateralPoolToken');

contract(`AuditV2.ts; ${getTestFile(__filename)}; FAsset V2 audit tests`, async accounts => {
    const governance = accounts[10];
    const agentOwner1 = accounts[20];
    const minterAddress1 = accounts[30];
    const redeemerAddress1 = accounts[40];
    const challengerAddress1 = accounts[50];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
    const underlyingOwner1 = "Owner1";
    const underlyingMinter1 = "Minter1";
    const underlyingRedeemer1 = "Redeemer1";

    let commonContext: CommonContext;
    let context: AssetContext;

    async function initialize() {
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
        return { commonContext, context };
    }

    beforeEach(async () => {
        ({ commonContext, context } = await loadFixtureCopyVars(initialize));
    });

    it("cannot withdraw when CR is too low", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1,
            context.underlyingAmount(10000));
        // make agent available
        await agent.depositCollateralsAndMakeAvailable(toWei(5e5), toWei(1e6));
        // update block
        await context.updateUnderlyingBlock();
        // perform minting
        const lots = 3;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash);
        // console.log(deepFormat(await agent.getAgentInfo()));
        // announce withdrawal - should succeed
        const withdrawAmount = toWei(2e5);
        const announce = await agent.announceVaultCollateralWithdrawal(withdrawAmount);
        await time.increaseTo(announce.withdrawalAllowedAt);
        // change vault collateral price
        await context.ftsos['USDC'].setCurrentPrice(0.5e5, 0);
        await context.ftsos['USDC'].setCurrentPriceFromTrustedProviders(0.5e5, 0);
        // try to withdraw - should fail because CR is too low
        await expectRevert(agent.withdrawVaultCollateral(withdrawAmount), "withdrawal: CR too low");
    });

    it("should be able to redeem after changing WNat address", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        // make agent available
        const fullAgentCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
        // mine some blocks to skip the agent creation time
        (context.chain as MockChain).mine(5);
        // update block
        const blockNumber = await context.updateUnderlyingBlock();
        const currentUnderlyingBlock = await context.assetManager.currentUnderlyingBlock();
        assertWeb3Equal(currentUnderlyingBlock[0], blockNumber);
        assertWeb3Equal(currentUnderlyingBlock[1], (await context.chain.getBlockAt(blockNumber))?.timestamp);
        // perform minting
        const lots = 3;
        const crFee = await minter.getCollateralReservationFee(lots);
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        const lotsUBA = context.convertLotsToUBA(lots);
        await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral, reservedUBA: lotsUBA.add(agent.poolFeeShare(crt.feeUBA)), });
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
        // check that fee was burned
        assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), crFee);
        // redeemer "buys" f-assets
        await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
        // perform redemption
        const [redemptionRequests, remainingLots, dustChanges] = await redeemer.requestRedemption(lots);
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare, mintedUBA: poolFeeShare, redeemingUBA: lotsUBA, });
        assertWeb3Equal(remainingLots, 0);
        assert.equal(dustChanges.length, 0);
        assert.equal(redemptionRequests.length, 1);
        const request = redemptionRequests[0];
        assert.equal(request.agentVault, agent.vaultAddress);
        const tx1Hash = await agent.performRedemptionPayment(request);
        await agent.confirmActiveRedemptionPayment(request, tx1Hash);
        await agent.checkAgentInfo({ freeUnderlyingBalanceUBA: agentFeeShare.add(request.feeUBA), redeemingUBA: 0, });
        // deploy new WNAT contract
        const newWNAT = await WNat.new(context.governance, "WNAT2", "WNAT2");
        // Update wnat contract
        // removed access control from assetManager.updateSettings() for this test
        await impersonateContract(context.assetManagerController.address, toBNExp(1, 18), accounts[0]);
        await context.assetManager.updateSystemContracts(context.assetManagerController.address, newWNAT.address,
            { from: context.assetManagerController.address });
        await stopImpersonatingContract(context.assetManagerController.address);
        const res = await context.assetManager.upgradeWNatContract(agent.vaultAddress, { from: agentOwner1 });
        // agent can't redeem collateral pool tokens because it reverts
        // as withdraws from WNat1 and the Pool sends WNat2
        await selfCloseAndRedeemCollateralPoolTokensRevert(agent, fullAgentCollateral);
    });

    async function selfCloseAndRedeemCollateralPoolTokensRevert(agent: Agent, collateral: BNish) {
        // exit available
        await agent.exitAvailable();
        // withdraw pool fees
        const poolFeeBalance = await agent.poolFeeBalance();
        const ownerFAssetBalance = await context.fAsset.balanceOf(agent.ownerWorkAddress);
        if (poolFeeBalance.gt(BN_ZERO)) await agent.withdrawPoolFees(poolFeeBalance);
        const ownerFAssetBalanceAfter = await context.fAsset.balanceOf(agent.ownerWorkAddress);
        // check that we received exactly the agent vault's fees in fasset
        assertWeb3Equal(await agent.poolFeeBalance(), 0);
        assertWeb3Equal(ownerFAssetBalanceAfter.sub(ownerFAssetBalance), poolFeeBalance);
        // self close all received pool fees - otherwise we cannot withdraw all pool collateral
        if (poolFeeBalance.gt(BN_ZERO)) await agent.selfClose(poolFeeBalance);
        // nothing must be minted now
        const info = await agent.getAgentInfo();
        if (toBN(info.mintedUBA).gt(BN_ZERO)) {
            throw new Error("agent still backing f-assets");
        }
        // redeem pool tokens to empty the pool (agent only works in tests where there are no other pool token holders)
        const poolTokenBalance = await agent.poolTokenBalance();
        await time.increase(await context.assetManager.getCollateralPoolTokenTimelockSeconds()); // wait for token timelock
        const { withdrawalAllowedAt } = await agent.announcePoolTokenRedemption(poolTokenBalance);
        console.log(`Pool Token Balance to Redeem: ${poolTokenBalance}`);
        await time.increaseTo(withdrawalAllowedAt);
        // === the redemption shouldn't revert anymore ===
        // await expectRevert(agent.redeemCollateralPoolTokens(poolTokenBalance), "ERC20: transfer amount exceeds balance");
        await agent.redeemCollateralPoolTokens(poolTokenBalance);
    }

});
