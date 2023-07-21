import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { DAYS, MAX_BIPS, toBN, toWei } from "../../../lib/utils/helpers";
import { requiredEventArgsFrom } from "../../utils/Web3EventDecoder";
import { impersonateContract, stopImpersonatingContract } from "../../utils/contract-test-helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Liquidator } from "../utils/Liquidator";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo } from "../utils/TestChainInfo";


contract(`ContingencyPoolOperations.sol; ${getTestFile(__filename)}; Collateral pool operations`, async accounts => {
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
    let mockStateConnectorClient: MockStateConnectorClient;

    async function initialize() {
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.xrp);
        return { commonContext, context };
    }

    beforeEach(async () => {
        ({ commonContext, context } = await loadFixtureCopyVars(initialize));
        mockChain = context.chain as MockChain;
        mockStateConnectorClient = context.stateConnectorClient as MockStateConnectorClient;
    });

    it("should test minter entering the pool, then redeeming and agent collecting pool fees", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1e8));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        // make agent available one lot worth of pool collateral
        const fullAgentVaultCollateral = toWei(3e8);
        const fullAgentPoolCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentVaultCollateral, fullAgentPoolCollateral);
        // minter mints
        const lots = 100;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash1 = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash1);
        // agent collects pool fees
        await agent.agentVault.withdrawPoolFees(minted.poolFeeUBA, agent.ownerWorkAddress, { from: agent.ownerWorkAddress });
        assertWeb3Equal(await context.fAsset.balanceOf(agent.ownerWorkAddress), minted.poolFeeUBA);
        // minter transfers f-assets
        await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
        // redeemer redeems
        const [[redemptionRequest],,] = await redeemer.requestRedemption(lots);
        const txHash2 = await agent.performRedemptionPayment(redemptionRequest);
        await agent.confirmActiveRedemptionPayment(redemptionRequest, txHash2);
        // agent self-closes pool fees and exits
        await agent.selfClose(minted.poolFeeUBA);
        await agent.exitAndDestroy(fullAgentVaultCollateral);
    });

    it("should test for pool collateral payout in the case of liquidation (agent can cover total liquidation value)", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1e8));
        const liquidator = await Liquidator.create(context, minterAddress1);
        // make agent available
        const fullAgentVaultCollateral = toWei(3e8);
        const fullAgentPoolCollateral = toWei(3e12); // need to be enough to cover asset price increase
        await agent.depositCollateralsAndMakeAvailable(fullAgentVaultCollateral, fullAgentPoolCollateral);
        // minter mints
        const lots = 10;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash);
        // minter enters the pool with the value of agent's collateral and deposits pool's worth of f-assets
        await context.fAsset.increaseAllowance(agent.contingencyPool.address, minted.mintedAmountUBA, { from: minter.address });
        await agent.contingencyPool.enter(0, true, { from: minter.address, value: fullAgentPoolCollateral });
        const minterPoolTokens = await agent.contingencyPoolToken.balanceOf(minter.address);
        const agentPoolTokens = await agent.contingencyPoolToken.balanceOf(agent.agentVault.address);
        const minterPoolFAsset = await agent.contingencyPool.fAssetFeesOf(minter.address);
        const agentPoolFAsset = await agent.contingencyPool.fAssetFeesOf(agent.agentVault.address);
        assertWeb3Equal(minterPoolTokens, agentPoolTokens);
        assertWeb3Equal(minterPoolFAsset, minted.poolFeeUBA);
        assertWeb3Equal(agentPoolFAsset, minted.poolFeeUBA);
        // get agent's collateral ratio to 0.5 by increasing asset price
        await agent.setVaultCollateralRatioByChangingAssetPrice(MAX_BIPS / 2);
        assertWeb3Equal(await agent.getCurrentVaultCollateralRatioBIPS(), MAX_BIPS / 2);
        // minter triggers liquidation
        const poolCollateralBefore = await context.wNat.balanceOf(agent.contingencyPool.address);
        const tokenSupplyBefore = await agent.contingencyPoolToken.totalSupply();
        const agentPoolTokensBefore = await agent.contingencyPoolToken.balanceOf(agent.agentVault.address);
        const minterPoolTokensBefore = await agent.contingencyPoolToken.balanceOf(minter.address);
        const liquidateUBA = context.convertLotsToUBA(lots).sub(minterPoolFAsset);
        const [liquidatedUBA,,,] = await liquidator.liquidate(agent, liquidateUBA);
        const poolCollateralAfter = await context.wNat.balanceOf(agent.contingencyPool.address);
        const tokenSupplyAfter = await agent.contingencyPoolToken.totalSupply();
        const agentPoolTokensAfter = await agent.contingencyPoolToken.balanceOf(agent.agentVault.address);
        const minterPoolTokensAfter = await agent.contingencyPoolToken.balanceOf(minter.address);
        assertWeb3Equal(liquidatedUBA, liquidateUBA);
        assertWeb3Equal(await context.fAsset.balanceOf(minter.address), 0);
        // check that collateral pool helped agent cover all of minter's liquidation
        const vaultCollateralPrice = await context.getCollateralPrice(agent.vaultCollateral());
        const wNatPrice = await context.getCollateralPrice(context.collaterals[0]);
        const minterVaultCollateralReward = await agent.vaultCollateralToken().balanceOf(minter.address);
        const minterWNatReward = await context.wNat.balanceOf(minter.address);
        const minterRewardUBA = vaultCollateralPrice.convertTokenWeiToUBA(minterVaultCollateralReward).add(wNatPrice.convertTokenWeiToUBA(minterWNatReward));
        const expectedRewardUBA = liquidatedUBA.mul(toBN(context.liquidationSettings.liquidationCollateralFactorBIPS[0])).divn(MAX_BIPS);
        assert(minterRewardUBA.sub(expectedRewardUBA).abs().lten(2)); // numerical error is at most 2
        // check that agent's tokens covered the liquidation
        assertWeb3Equal(poolCollateralBefore.sub(poolCollateralAfter), minterWNatReward);
        assertWeb3Equal(tokenSupplyBefore.sub(tokenSupplyAfter), agentPoolTokensBefore.sub(agentPoolTokensAfter));
        assertWeb3Equal(minterPoolTokensBefore, minterPoolTokensAfter);
        const minterPoolFees = await agent.contingencyPool.fAssetFeesOf(minter.address);
        assert(minterPoolFees.gt(minted.poolFeeUBA));
        // minter exits the pool
        await agent.contingencyPool.exit(minterPoolTokens, 0, { from: minter.address });
    });

    it("should test for pool covering liquidation, when agent's pool tokens are not enough", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1e8));
        const liquidator = await Liquidator.create(context, minterAddress1);
        const poolContributor = accounts[70];
        // make agent available
        const lots = 10;
        const uba = context.convertLotsToUBA(lots);
        const agentFeeUBA = uba.mul(toBN(agent.settings.feeBIPS)).divn(MAX_BIPS);
        const poolFeeUBA = agentFeeUBA.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
        const mintedUBA = uba.add(poolFeeUBA);
        const fullAgentVaultCollateral = await agent.getVaultCollateralToMakeCollateralRatioEqualTo(30_000, mintedUBA);
        const fullAgentPoolCollateral = await agent.getPoolCollateralToMakeCollateralRatioEqualTo(30_000, mintedUBA);
        await agent.depositCollateralsAndMakeAvailable(fullAgentVaultCollateral, fullAgentPoolCollateral);
        // minter mints
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash);
        // pool contributor enters the pool with the value of agent's collateral and without f-assets
        const poolContributorPoolDeposit = await agent.getPoolCollateralToMakeCollateralRatioEqualTo(100_000, mintedUBA);
        await agent.contingencyPool.enter(0, false, { from: poolContributor, value: poolContributorPoolDeposit });
        const poolContributorPoolTokens = await agent.contingencyPoolToken.balanceOf(poolContributor);
        // asset price increases by a factor of 10
        await agent.multiplyAssetPriceWithBIPS(100_000);
        const poolCollateralBefore = await context.wNat.balanceOf(agent.contingencyPool.address);
        const [liquidatedUBA,,,] = await liquidator.liquidate(agent, uba);
        const poolCollateralAfter = await context.wNat.balanceOf(agent.contingencyPool.address);
        assertWeb3Equal(liquidatedUBA, uba);
        // check that collateral pool helped agent cover all of minter's liquidation
        const vaultCollateralPrice = await context.getCollateralPrice(agent.vaultCollateral());
        const wNatPrice = await context.getCollateralPrice(context.collaterals[0]);
        const minterVaultCollateralReward = await agent.vaultCollateralToken().balanceOf(minter.address);
        const minterWNatReward = await context.wNat.balanceOf(minter.address);
        const minterRewardUBA = vaultCollateralPrice.convertTokenWeiToUBA(minterVaultCollateralReward).add(wNatPrice.convertTokenWeiToUBA(minterWNatReward));
        const expectedRewardUBA = liquidatedUBA.mul(toBN(context.liquidationSettings.liquidationCollateralFactorBIPS[0])).divn(MAX_BIPS);
        assert(minterRewardUBA.sub(expectedRewardUBA).abs().lten(2)); // numerical error is at most 2
        assertWeb3Equal(poolCollateralBefore.sub(poolCollateralAfter), minterWNatReward);
        // check that all of agent's tokens and none of poolContributor were spent
        const agentPoolTokens = await agent.contingencyPoolToken.balanceOf(agent.agentVault.address);
        assertWeb3Equal(agentPoolTokens, 0);
        assertWeb3Equal(await agent.contingencyPoolToken.balanceOf(poolContributor), poolContributorPoolTokens);
    });

    it("should test redemption default payout from pool", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1e8));
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        // make agent available
        const fullAgentVaultCollateral = toWei(3e8);
        const fullAgentPoolCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentVaultCollateral, fullAgentPoolCollateral);
        // minter mints
        const lots = 3;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash);
        // minter enters the pool without f-assets
        const minterPoolDeposit = toWei(3e8);
        await agent.contingencyPool.enter(0, false, { from: minter.address, value: minterPoolDeposit });
        assertWeb3Equal(await agent.contingencyPool.fAssetFeesOf(minter.address), 0);
        // minter makes and defaults redemption
        const [[redemptionRequest],,] = await redeemer.requestRedemption(lots);
        for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment+100; i++) {
            await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
        }
        const poolCollateralBefore = await context.wNat.balanceOf(agent.contingencyPool.address);
        const agentWNatBefore = await agent.poolCollateralBalance();
        const agentFAssetFeesBefore = await agent.contingencyPool.fAssetFeesOf(agent.agentVault.address);
        const redeemerFAssetFeesBefore = await agent.contingencyPool.fAssetFeesOf(redeemer.address);
        const res = await redeemer.redemptionPaymentDefault(redemptionRequest);
        const poolCollateralAfter = await context.wNat.balanceOf(agent.contingencyPool.address);
        const agentWNatAfter = await agent.poolCollateralBalance();
        const agentFAssetFeesAfter = await agent.contingencyPool.fAssetFeesOf(agent.agentVault.address);
        const redeemerFAssetFeesAfter = await agent.contingencyPool.fAssetFeesOf(redeemer.address);
        assert(res.redeemedPoolCollateralWei.gtn(0));
        const [,redeemedPoolCollateralWei] = await agent.getRedemptionPaymentDefaultValue(lots);
        assertWeb3Equal(res.redeemedPoolCollateralWei, redeemedPoolCollateralWei);
        assertWeb3Equal(agentWNatBefore.sub(agentWNatAfter), redeemedPoolCollateralWei); // agent's tokens covered whole redemption
        assertWeb3Equal(poolCollateralAfter, fullAgentPoolCollateral.add(minterPoolDeposit).sub(redeemedPoolCollateralWei));
        assertWeb3Equal(poolCollateralBefore.sub(poolCollateralAfter), redeemedPoolCollateralWei);
        assert(redeemerFAssetFeesAfter.sub(redeemerFAssetFeesBefore).gtn(0));
        assertWeb3Equal(agentFAssetFeesBefore.sub(agentFAssetFeesAfter).subn(1), redeemerFAssetFeesAfter.sub(redeemerFAssetFeesBefore));
        // minter withdraws fees from pool and later exits
        await agent.contingencyPool.withdrawFees(redeemerFAssetFeesAfter, { from: minter.address });
        assertWeb3Equal(await context.fAsset.balanceOf(redeemer.address), redeemerFAssetFeesAfter);
        const minterPoolTokens = await agent.contingencyPoolToken.balanceOf(minter.address);
        await agent.contingencyPool.exit(minterPoolTokens, 0, { from: minter.address });
        assertWeb3Equal(await context.wNat.balanceOf(minter.address), minterPoolDeposit.add(redeemedPoolCollateralWei));
    });

    it("should simulate a situation in which minter virtual f-asset is larger than his f-asset debt", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1e10));
        // agent deposits into the pool
        const fullAgentVaultCollateral = toWei(1e7);
        const fullAgentPoolCollateral = toWei(1e7);
        await agent.depositCollateralsAndMakeAvailable(fullAgentVaultCollateral, fullAgentPoolCollateral);
        // minter mints
        const lots1 = 259;
        const crt1 = await minter.reserveCollateral(agent.vaultAddress, lots1);
        const txHash = await minter.performMintingPayment(crt1);
        const minted1 = await minter.executeMinting(crt1, txHash);
        // minter enters the pool
        const minterPoolDeposit1 = toWei(34_730);
        await agent.contingencyPool.enter(0, false, { from: minter.address, value: minterPoolDeposit1 });
        // minter mints again
        const lots2 = 15;
        const crt2 = await minter.reserveCollateral(agent.vaultAddress, lots2);
        const txHash2 = await minter.performMintingPayment(crt2);
        const minted2 = await minter.executeMinting(crt2, txHash2);
        // minter does redemption default
        const redeemLots = 106;
        const redeemer = await Redeemer.create(context, minterAddress1, underlyingMinter1);
        const [redemptionRequests,,] = await redeemer.requestRedemption(redeemLots);
        for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment+100; i++) {
            await agent.wallet.addTransaction(agent.underlyingAddress, agent.underlyingAddress, 1, null);
        }
        await agent.redemptionPaymentDefault(redemptionRequests[0]);
        await agent.finishRedemptionWithoutPayment(redemptionRequests[0]);
        // minter partially exits the pool
        const exitTokens1 = toWei(22_200);
        await agent.contingencyPool.exit(exitTokens1, 0, { from: minter.address });
        // minter enters the pool again
        const minterPoolDeposit2 = toWei(11_544);
        await agent.contingencyPool.enter(0, false, { from: minter.address, value: minterPoolDeposit2 });
        // see that minter's debt-fasset is virtual-fasset + 1
        const minterDebtFAsset = await agent.contingencyPool.fAssetFeeDebtOf(minter.address);
        const minterVirtualFAsset = await agent.contingencyPool.virtualFAssetOf(minter.address);
        assertWeb3Equal(minterDebtFAsset, minterVirtualFAsset.addn(1));
    });

    it("self close exit test", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1e8));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        // make agent available one lot worth of pool collateral
        const fullAgentVaultCollateral = toWei(1e7);
        const fullAgentPoolCollateral = toWei(1e7);
        await agent.depositCollateralsAndMakeAvailable(fullAgentVaultCollateral, fullAgentPoolCollateral);
        // minter mints
        const lots = 300;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash1 = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash1);
        // minter enters the pool
        const minterPoolDeposit1 = toWei(90000);
        //Approve enough fassets that will be needed in self close exit.
        await context.fAsset.approve(agent.contingencyPool.address, 100000000000, { from: minter.address });
        await agent.contingencyPool.enter(0, false, { from: minter.address, value: minterPoolDeposit1 });
        const fAssetBalanceBefore = await context.fAsset.balanceOf(minter.address);
        const fAssetReqForClose = await agent.contingencyPool.fAssetRequiredForSelfCloseExit(toWei(90000));
        const resp = await agent.contingencyPool.selfCloseExit(toWei(90000), false, underlyingMinter1, { from: minter.address });
        const fAssetBalanceAfter = await context.fAsset.balanceOf(minter.address);
        assertWeb3Equal(fAssetBalanceBefore.sub(fAssetBalanceAfter),fAssetReqForClose);
        const info = await agent.getAgentInfo();
        const natShare = toBN(info.totalPoolCollateralNATWei).mul(minterPoolDeposit1).div(await agent.contingencyPoolToken.totalSupply());
        //Check for redemption request
        assert.equal((await agent.contingencyPoolToken.balanceOf(minter.address)).toString(),"0");
        await expectEvent.inTransaction(resp.tx, context.assetManager, "RedemptionRequested");
        assert.equal((await context.wNat.balanceOf(minter.address)).toString(), natShare.toString());
        expectEvent(resp, "Exited");
    });

    it("self close exit test, incomplete self close", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1, { poolExitCollateralRatioBIPS: 1000000 });
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1e8));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        // make agent available one lot worth of pool collateral
        const fullAgentVaultCollateral = toWei(3e8);
        const fullAgentPoolCollateral = toWei(3e8);
        await agent.depositCollateralsAndMakeAvailable(fullAgentVaultCollateral, fullAgentPoolCollateral);
        // minter mints multiple times to create a lot of tickets
        for (let i = 0; i <= 30; i++) {
            const lots = 1;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash1 = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash1);
        }
        //Mint a big amount
        const lots = 500;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash1 = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash1);
        const minterPoolDeposit1 = toWei(100000000);
        await context.fAsset.approve(agent.contingencyPool.address, toWei(5e12), { from: minter.address });
        await agent.contingencyPool.enter(0, false, { from: minter.address, value: minterPoolDeposit1 });
        const resp = await agent.contingencyPool.selfCloseExit(toWei(100000000), false, underlyingMinter1, { from: minter.address });
        const info = await agent.getAgentInfo();
        //Check for redemption request and incomplete self close
        await expectEvent.inTransaction(resp.tx, context.assetManager, "RedemptionRequested");
        await expectEvent.inTransaction(resp.tx, agent.contingencyPool, "IncompleteSelfCloseExit");
        expectEvent(resp, "Exited");
    });

    it("self close exit test payout in vault collateral", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1e8));
        const redeemer = await Redeemer.create(context, redeemerAddress1, underlyingRedeemer1);
        // make agent available one lot worth of pool collateral
        const fullAgentVaultCollateral = toWei(1e7);
        const fullAgentPoolCollateral = toWei(1e7);
        await agent.depositCollateralsAndMakeAvailable(fullAgentVaultCollateral, fullAgentPoolCollateral);
        // minter mints
        const lots = 300;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash1 = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash1);
        // minter enters the pool
        const minterPoolDeposit1 = toWei(10000);
        //Approve enough fassets that will be needed in self close exit.
        await context.fAsset.approve(agent.contingencyPool.address, 10000000000, { from: minter.address });
        await agent.contingencyPool.enter(0, false, { from: minter.address, value: minterPoolDeposit1 });

        const vaultCollateralBalanceAgentBefore = await context.usdc.balanceOf(agent.agentVault.address);
        const vaultCollateralBalanceRedeemerBefore = await context.usdc.balanceOf(minter.address);

        //Self close exit with vault collateral payout
        const selfCloseAmount = toWei(10000);
        const fAssetBalanceBefore = await context.fAsset.balanceOf(minter.address);
        const fAssetReqForClose = await agent.contingencyPool.fAssetRequiredForSelfCloseExit(selfCloseAmount);
        const resp = await agent.contingencyPool.selfCloseExit(selfCloseAmount, true, underlyingMinter1, { from: minter.address });
        const fAssetBalanceAfter = await context.fAsset.balanceOf(minter.address);
        assertWeb3Equal(fAssetBalanceBefore.sub(fAssetBalanceAfter),fAssetReqForClose);
        const info = await agent.getAgentInfo();
        const natShare = toBN(info.totalPoolCollateralNATWei).mul(selfCloseAmount).div(await agent.contingencyPoolToken.totalSupply());
        const vaultCollateralBalanceAgentAfter = await context.usdc.balanceOf(agent.agentVault.address);
        const vaultCollateralBalanceRedeemerAfter = await context.usdc.balanceOf(minter.address);
        assert.equal(vaultCollateralBalanceRedeemerAfter.sub(vaultCollateralBalanceRedeemerBefore).toString(), vaultCollateralBalanceAgentBefore.sub(vaultCollateralBalanceAgentAfter).toString());
        assert.equal((await context.wNat.balanceOf(minter.address)).toString(), natShare.toString());
        expectEvent(resp, "Exited");
    });

    it("withdraw collateral when FAsset is terminated", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1e8));
        // make agent available
        const fullAgentVaultCollateral = toWei(1e7);
        const fullAgentPoolCollateral = toWei(1e7);
        await agent.depositCollateralsAndMakeAvailable(fullAgentVaultCollateral, fullAgentPoolCollateral);
        // minter mints
        const lots = 300;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash1 = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash1);
        // minter enters the pool
        const minterPoolDeposit1 = toWei(10000);
        await agent.contingencyPool.enter(0, false, { from: minter.address, value: minterPoolDeposit1 });
        // Cant withdraw collateral if fasset is not terminated
        let res = agent.contingencyPool.withdrawCollateralWhenFAssetTerminated({ from: minter.address });
        await expectRevert(res, "f-asset not terminated");
        await impersonateContract(context.assetManager.address, toBN(512526332000000000), accounts[0]);
        await context.fAsset.terminate({ from: context.assetManager.address });
        await stopImpersonatingContract(context.assetManager.address);
        const natBalanceBefore = await context.wNat.balanceOf(minter.address);
        await agent.contingencyPool.withdrawCollateralWhenFAssetTerminated({ from: minter.address });
        const natBalanceAfter = await context.wNat.balanceOf(minter.address);
        assertWeb3Equal(natBalanceAfter.sub(natBalanceBefore), minterPoolDeposit1);
        //Should revert if there is no collateral to withdraw
        res = agent.contingencyPool.withdrawCollateralWhenFAssetTerminated({ from: minter.address });
        await expectRevert(res, "nothing to withdraw");
    });

    it("should check if agent doesn't pay underlying - the redeemer must only get vault collateral (special case for pool redemptions)", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(1e8));
        // make agent available
        const fullAgentVaultCollateral = toWei(1e7);
        const fullAgentPoolCollateral = toWei(1e7);
        await agent.depositCollateralsAndMakeAvailable(fullAgentVaultCollateral, fullAgentPoolCollateral);
        // minter mints
        const lots = 100;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash1 = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash1);
        // minter enters the pool
        const minterPoolDeposit = toWei(1e7);
        await context.fAsset.approve(agent.contingencyPool.address, context.convertLotsToUBA(lots), { from: minter.address });
        await agent.contingencyPool.enter(0, false, { from: minter.address, value: minterPoolDeposit });
        // pool collateral drops below exitCR (e.g. to 1) so that minter will have to pay at least one lot of f-assets
        // (in fact he needs to pay ~50 lots because math)
        await agent.setPoolCollateralRatioByChangingAssetPrice(10_000);
        // minters triggers self-close exit
        const minterTokens = await agent.contingencyPoolToken.balanceOf(minter.address);
        const resp = await agent.contingencyPool.selfCloseExit(minterTokens, false, minter.underlyingAddress, { from: minter.address });
        assertWeb3Equal(await context.wNat.balanceOf(minter.address), minterPoolDeposit);
        // get redemption request
        await expectEvent.inTransaction(resp.tx, context.assetManager, "RedemptionRequested");
        const request = requiredEventArgsFrom(resp, context.assetManager, 'RedemptionRequested');
        assert(request.valueUBA.gte(context.convertLotsToUBA(1)));
        assertWeb3Equal(request.paymentAddress, minter.underlyingAddress);
        assertWeb3Equal(request.agentVault, agent.vaultAddress);
        // mine some blocks to create overflow blocka
        for (let i = 0; i <= 2 * context.chainInfo.underlyingBlocksForPayment; i++) {
            await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
        }
        // do default
        const redeemedLots = context.convertUBAToLots(request.valueUBA);
        const [redemptionDefaultValueVaultCollateral, redemptionDefaultValuePool] = await agent.getRedemptionPaymentDefaultValue(redeemedLots, true);
        const redDef = await agent.redemptionPaymentDefault(request);
        assertWeb3Equal(redDef.redeemedPoolCollateralWei, redemptionDefaultValuePool);
        assertWeb3Equal(redDef.redeemedPoolCollateralWei, 0);
        assertWeb3Equal(redDef.redemptionAmountUBA, request.valueUBA);
        assertWeb3Equal(redDef.redeemedVaultCollateralWei, redemptionDefaultValueVaultCollateral);
        // check that the redeemer got only vault collateral
        assertWeb3Equal(await context.usdc.balanceOf(minter.address), redemptionDefaultValueVaultCollateral);
        assertWeb3Equal(await context.wNat.balanceOf(minter.address), minterPoolDeposit);
    });

    it("should delegate and undelegate collateral pool's wNat", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        // make agent available
        const fullAgentVaultCollateral = toWei(1e7);
        const fullAgentPoolCollateral = toWei(1e7);
        await agent.depositCollateralsAndMakeAvailable(fullAgentVaultCollateral, fullAgentPoolCollateral);
        // delegate
        await agent.contingencyPool.delegate([accounts[2], accounts[3]], [6_000, 4_000], { from: agentOwner1 });
        const delegations1 = await context.wNat.delegatesOf(agent.contingencyPool.address) as any;
        assertWeb3Equal(delegations1._delegateAddresses[0], accounts[2]);
        assertWeb3Equal(delegations1._bips[0], 6000);
        const votePower1 = await context.wNat.votePowerOf(accounts[2]);
        assertWeb3Equal(votePower1, fullAgentVaultCollateral.muln(6_000).divn(10_000));
        // undelegate at block
        const blockNumber = await web3.eth.getBlockNumber();
        await agent.contingencyPool.revokeDelegationAt(accounts[2], blockNumber, { from: agentOwner1 });
        const votePower2 = await context.wNat.votePowerOfAt(accounts[2], blockNumber);
        assertWeb3Equal(votePower2, 0);
        const votePower3 = await context.wNat.votePowerOfAt(accounts[3], blockNumber);
        assertWeb3Equal(votePower3, fullAgentVaultCollateral.muln(4_000).divn(10_000));
        // undelegate
        await agent.contingencyPool.undelegateAll({ from: agentOwner1 });
        const delegations2 = await context.wNat.delegatesOf(agent.contingencyPool.address) as any;
        assert.equal(delegations2._delegateAddresses.length, 0);
        const votePower4 = await context.wNat.votePowerOf(accounts[2]);
        assertWeb3Equal(votePower4, 0);
        const votePower5 = await context.wNat.votePowerOf(accounts[3]);
        assertWeb3Equal(votePower5, 0);
    });

    it("should delegate governance vote power and undelegate", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        // make agent available
        const fullAgentVaultCollateral = toWei(1e7);
        const fullAgentPoolCollateral = toWei(1e7);
        await agent.depositCollateralsAndMakeAvailable(fullAgentVaultCollateral, fullAgentPoolCollateral);
        // set governance vote power
        const governanceVP = await context.createGovernanceVP();
        await context.wNat.setGovernanceVotePower(governanceVP.address, { from: governance });
        // delegate
        await agent.contingencyPool.delegateGovernance(accounts[5], { from: agent.ownerWorkAddress });
        // undelegate
        await agent.contingencyPool.undelegateGovernance({ from: agent.ownerWorkAddress });
    });

});
