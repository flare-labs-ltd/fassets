import { expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentStatus } from "../../../lib/fasset/AssetManagerTypes";
import { BN_ZERO, MAX_BIPS, toBN, toBNExp, toWei } from "../../../lib/utils/helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockFlareDataConnectorClient } from "../../utils/fasset/MockFlareDataConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Liquidator } from "../utils/Liquidator";
import { Minter } from "../utils/Minter";
import { testChainInfo } from "../utils/TestChainInfo";

contract(`AssetManagerSimulation.sol; ${getTestFile(__filename)}; Asset manager simulations`, async accounts => {
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

    describe("simple scenarios - price change liquidation", () => {
        it("ccb due to price change (turns into liquidation after time) (NAT price change, pool collateral ratio unsafe)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
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
            // price change
            await context.priceStore.setCurrentPrice("NAT", 100, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 100, 0);
            // start ccb
            const [ccb, ccbStartTimestamp] = await liquidator.startLiquidation(agent);
            assert.isTrue(ccb);
            const info = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                status: AgentStatus.CCB
            });
            assertWeb3Equal(info.ccbStartTimestamp, ccbStartTimestamp);
            const ccbTimeSeconds = (await context.assetManager.getSettings()).ccbTimeSeconds;
            assertWeb3Equal(info.liquidationStartTimestamp, toBN(ccbStartTimestamp).add(toBN(ccbTimeSeconds)));
            // ccb status should show in available agent info
            const { 0: availableAgentInfos1 } = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(Number(availableAgentInfos1[0].status), AgentStatus.CCB);
            // skip some time
            await time.increase(300);
            // now the agent should be in liquidation
            await agent.checkAgentInfo({
                status: AgentStatus.LIQUIDATION
            });
            const { 0: availableAgentInfos2 } = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(Number(availableAgentInfos2[0].status), AgentStatus.LIQUIDATION);
            // do a complete safe-close
            await context.fAsset.transfer(agent.ownerWorkAddress, minted.mintedAmountUBA, { from: minter.address });
            await agent.selfClose(minted.mintedAmountUBA);
            // now the status should be normal again
            await agent.checkAgentInfo({
                status: AgentStatus.NORMAL,
                mintedUBA: minted.poolFeeUBA,
                freeUnderlyingBalanceUBA: toBN(minted.agentFeeUBA).add(toBN(minted.mintedAmountUBA))
            });
            const { 0: availableAgentInfos3 } = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(Number(availableAgentInfos3[0].status), AgentStatus.NORMAL);
            // agent can exit now
            await agent.exitAndDestroy();
        });

        it("ccb due to price change (turns into liquidation after time by calling startLiquidation again)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const [minted] = await minter.performMinting(agent.vaultAddress, lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            // price change
            await context.priceStore.setCurrentPrice("NAT", 100, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 100, 0);
            // start ccb
            const ccbTimeSeconds = toBN(context.settings.ccbTimeSeconds);
            const [ccb, ccbStartTimestamp] = await liquidator.startLiquidation(agent);
            assert.isTrue(ccb);
            const info = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                ccbStartTimestamp: ccbStartTimestamp,
                status: AgentStatus.CCB
            });
            assertWeb3Equal(info.liquidationStartTimestamp, toBN(ccbStartTimestamp).add(ccbTimeSeconds));
            // startLiquidation after 10 seconds should fail
            await time.increase(10);
            await expectRevert(liquidator.startLiquidation(agent), "liquidation not started");
            // after ccb time we can switch to liquidation (and liquidation event should be sent)
            await time.increase(ccbTimeSeconds);
            const [ccb2, liquidationStartTimestamp] = await liquidator.startLiquidation(agent);
            assert.isFalse(ccb2);
            await agent.checkAgentInfo({
                ccbStartTimestamp: 0,
                liquidationStartTimestamp: liquidationStartTimestamp,
                status: AgentStatus.LIQUIDATION
            });
            // do a complete safe-close
            await context.fAsset.transfer(agent.ownerWorkAddress, minted.mintedAmountUBA, { from: minter.address });
            await agent.selfClose(minted.mintedAmountUBA);
            // agent can exit now
            await agent.exitAndDestroy();
        });

        it("ccb due to price change (no liquidation due to collateral deposit)(NAT price change, pool collateral ratio unsafe)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
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
            // price change
            await context.priceStore.setCurrentPrice("NAT", 100, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 100, 0);
            // start ccb
            const [ccb, ccbStartTimestamp] = await liquidator.startLiquidation(agent);
            assert.isTrue(ccb);
            const info = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                status: AgentStatus.CCB });
            assertWeb3Equal(info.ccbStartTimestamp, ccbStartTimestamp);
            const ccbTimeSeconds = (await context.assetManager.getSettings()).ccbTimeSeconds;
            assertWeb3Equal(info.liquidationStartTimestamp, toBN(ccbStartTimestamp).add(toBN(ccbTimeSeconds)));
            // ccb status should show in available agent info
            const { 0: availableAgentInfos } = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(Number(availableAgentInfos[0].status), AgentStatus.CCB);
            // deposit collateral
            const additionalCollateral = toWei(4e6);
            await agent.depositVaultCollateral(additionalCollateral);
            await agent.buyCollateralPoolTokens(additionalCollateral);
            // test that ccb cancelled due to collateral deposit
            assert.equal((await agent.getAgentInfo()).status,toBN(0));
            const collateralRatioBIPS = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const collateralTypes = (await context.assetManager.getCollateralTypes())[0];
            assert(toBN(collateralRatioBIPS).gte(toBN(collateralTypes.ccbMinCollateralRatioBIPS)));
            assert(toBN(collateralRatioBIPS).lt(toBN(collateralTypes.safetyMinCollateralRatioBIPS)));

            const info2 = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral.add(additionalCollateral),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerWorkAddress, minted.mintedAmountUBA, { from: minter.address });
            await agent.selfClose(minted.mintedAmountUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.add(additionalCollateral));
        });

        it("ccb due to price change (no liquidation due to collateral deposit)(VaultCollateral price change, vault collateral ratio unsafe)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            const poolFullAgentCollateral = toWei(5e12);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, poolFullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            // price change
            await agent.setVaultCollateralRatioByChangingAssetPrice(13000);
            // start ccb
            const [ccb, ccbStartTimestamp] = await liquidator.startLiquidation(agent);
            assert.isTrue(ccb);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0,
                status: AgentStatus.CCB });

            assertWeb3Equal(info.ccbStartTimestamp, ccbStartTimestamp);
            const ccbTimeSeconds = (await context.assetManager.getSettings()).ccbTimeSeconds;
            assertWeb3Equal(info.liquidationStartTimestamp, toBN(ccbStartTimestamp).add(toBN(ccbTimeSeconds)));
            // deposit collateral
            const additionalCollateral = toWei(4e12);
            await agent.depositVaultCollateral(additionalCollateral);
            await agent.buyCollateralPoolTokens(additionalCollateral);
            // test that ccb cancelled due to collateral deposit and collateral ratio is higher than safety and ccb min
            assert.equal((await agent.getAgentInfo()).status,toBN(0));
            const collateralRatioBIPS = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralTypes = (await context.assetManager.getCollateralTypes())[1];
            assert(toBN(collateralRatioBIPS).gte(toBN(collateralTypes.ccbMinCollateralRatioBIPS)));
            assert(toBN(collateralRatioBIPS).gte(toBN(collateralTypes.safetyMinCollateralRatioBIPS)));
            const info2 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.add(additionalCollateral),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0,
                status: AgentStatus.NORMAL });

            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerWorkAddress, minted.mintedAmountUBA, { from: minter.address });
            await agent.selfClose(minted.mintedAmountUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.add(additionalCollateral));
        });

        it("ccb due to price change (no liquidation due to partial self close) (pool CR unsafe)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
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
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await context.priceStore.setCurrentPrice("NAT", 100, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 100, 0);
            // start ccb
            const [ccb, ccbStartTimestamp] = await liquidator.startLiquidation(agent);
            assert.isTrue(ccb);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0,
                announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.CCB });
            assertWeb3Equal(info.ccbStartTimestamp, ccbStartTimestamp);
            const ccbTimeSeconds = (await context.assetManager.getSettings()).ccbTimeSeconds;
            assertWeb3Equal(info.liquidationStartTimestamp, toBN(ccbStartTimestamp).add(toBN(ccbTimeSeconds)));
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerWorkAddress, minted.mintedAmountUBA, { from: minter.address });
            // perform partial self close
            const selfCloseAmountUBA = context.convertAmgToUBA(5e9);
            const [, selfClosedValueUBA, liquidationCancelledEvent] = await agent.selfClose(selfCloseAmountUBA);
            // test that ccb cancelled due to self close
            assert.equal(liquidationCancelledEvent.agentVault, agent.agentVault.address);
            const collateralRatioBIPS = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const collateralTypes = (await context.assetManager.getCollateralTypes())[0];
            assert(toBN(collateralRatioBIPS).gte(toBN(collateralTypes.ccbMinCollateralRatioBIPS)));
            assert(toBN(collateralRatioBIPS).lt(toBN(collateralTypes.safetyMinCollateralRatioBIPS)));
            const info2 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(selfClosedValueUBA),
                mintedUBA: minted.mintedAmountUBA.sub(selfClosedValueUBA).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0,
                announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // agent "buys" f-assets
            await agent.selfClose(minted.mintedAmountUBA.sub(selfClosedValueUBA));
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("ccb due to price change (no liquidation due to partial self close) (vault CR unsafe)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            const poolFullAgentCollateral = toWei(5e12);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, poolFullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await agent.setVaultCollateralRatioByChangingAssetPrice(13000);
            // start ccb
            const [ccb, ccbStartTimestamp] = await liquidator.startLiquidation(agent);
            assert.isTrue(ccb);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0,
                announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.CCB });
            assertWeb3Equal(info.ccbStartTimestamp, ccbStartTimestamp);
            const ccbTimeSeconds = (await context.assetManager.getSettings()).ccbTimeSeconds;
            assertWeb3Equal(info.liquidationStartTimestamp, toBN(ccbStartTimestamp).add(toBN(ccbTimeSeconds)));
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerWorkAddress, minted.mintedAmountUBA, { from: minter.address });
            // perform partial self close, that puts CR above min CR
            const selfCloseAmountUBA = context.convertAmgToUBA(1e10);
            const [, selfClosedValueUBA, liquidationCancelledEvent] = await agent.selfClose(selfCloseAmountUBA);
            // test that ccb cancelled due to self close
            assert.equal(liquidationCancelledEvent.agentVault, agent.agentVault.address);
            const collateralRatioBIPS = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralTypes = (await context.assetManager.getCollateralTypes())[1];
            assert(toBN(collateralRatioBIPS).gte(toBN(collateralTypes.ccbMinCollateralRatioBIPS)));
            assert(toBN(collateralRatioBIPS).lt(toBN(collateralTypes.safetyMinCollateralRatioBIPS)));
            const info2 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(selfClosedValueUBA),
                mintedUBA: minted.mintedAmountUBA.sub(selfClosedValueUBA).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0,
                announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // agent "buys" f-assets
            await agent.selfClose(minted.mintedAmountUBA.sub(selfClosedValueUBA));
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("liquidation due to price change (agent can be safe again) (pool CR too low)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            const fullPoolCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullPoolCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await context.priceStore.setCurrentPrice("NAT", 10, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 10, 0);
            await context.priceStore.setCurrentPrice(context.chainInfo.symbol,  toBNExp(10, 6), 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol,  toBNExp(10, 6), 0);
            // start liquidation
            const [isCCB, liquidationStartTs] = await liquidator.startLiquidation(agent);   // should put agent to liquidation mode
            await agent.checkAgentInfo({
                status: AgentStatus.LIQUIDATION,
                maxLiquidationAmountUBA: context.convertLotsToUBA(2),
                liquidationPaymentFactorVaultBIPS: 10000,
                liquidationPaymentFactorPoolBIPS: 2000,
            });
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = context.convertLotsToUBA(1);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.isUndefined(liquidationStarted1);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding from pool and agent

            const poolCollateralRatioBIPS1 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS1, liquidationStartTs, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationStartTs, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);

            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                maxLiquidationAmountUBA: context.convertLotsToUBA(1),   // 1 lot still remaining
                liquidationPaymentFactorVaultBIPS: 10000,
                liquidationPaymentFactorPoolBIPS: 2000,
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0,
                status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationStartTs);
            // liquidation cannot be stopped if agent not safe
            await expectRevert(agent.endLiquidation(), "cannot stop liquidation");
            await expectRevert(liquidator.endLiquidation(agent), "cannot stop liquidation");
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (second part)
            const liquidateMaxUBA2 = context.convertLotsToUBA(1);
            const startBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA2);
            const endBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assert(liquidatedUBA2.eq(liquidateMaxUBA2));
            assertWeb3Equal(context.convertLotsToUBA(context.convertUBAToLots(liquidatedUBA2)), liquidatedUBA2);
            assert.isUndefined(liquidationStarted2);
            assert.equal(liquidationCancelled2.agentVault, agent.agentVault.address);
            // test rewarding
            const poolCollateralRatioBIPS2 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS2, liquidationStartTs, liquidationTimestamp2);
            const poolLiquidationReward2 = await liquidator.getLiquidationRewardPool(liquidatedUBA2, poolLiquidationFactorBIPS2);
            const vaultCollateralRatioBIPS2 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS2, liquidationStartTs, liquidationTimestamp2);
            const vaultCollateralLiquidationReward2 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA2, collateralVaultLiquidationFactorBIPS2);

            assertWeb3Equal(endBalanceLiquidator2VaultCollateral.sub(startBalanceLiquidator2VaultCollateral), vaultCollateralLiquidationReward2);
            assertWeb3Equal(endBalanceLiquidator2NAT.sub(startBalanceLiquidator2NAT), poolLiquidationReward2);
            const info2 = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1).sub(poolLiquidationReward2),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1).add(liquidatedUBA2),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2).add(minted.poolFeeUBA),
                maxLiquidationAmountUBA: 0,
                liquidationPaymentFactorVaultBIPS: 0,
                liquidationPaymentFactorPoolBIPS: 0,
                status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // final tests
            assert(poolLiquidationFactorBIPS1.lt(poolLiquidationFactorBIPS2));
            assert(collateralVaultLiquidationFactorBIPS1.lte(collateralVaultLiquidationFactorBIPS2));
            const poolCollateralRatioBIPS3 = toBN((await agent.getAgentInfo()).poolCollateralRatioBIPS);
            const poolCollateralTypes = (await context.assetManager.getCollateralTypes())[0];
            assert(poolCollateralRatioBIPS3.gte(toBN(poolCollateralTypes.safetyMinCollateralRatioBIPS)));
            const vaultCollateralRatioBIPS3 = toBN((await agent.getAgentInfo()).vaultCollateralRatioBIPS);
            const vaultCollateralTypes = (await context.assetManager.getCollateralTypes())[1];
            assert(vaultCollateralRatioBIPS3.gte(toBN(vaultCollateralTypes.safetyMinCollateralRatioBIPS)));
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2);
            await context.fAsset.transfer(agent.ownerWorkAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2));
        });

        it("ccb due to collateral ratios change (no liquidation due to collateral deposit)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(1e6);
            const poolFullAgentCollateral = toWei(3e6);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, poolFullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0 });
            // Collateral ratios for class1 token change and that puts agent into ccb
            await context.setCollateralRatiosForToken(2, context.usdc.address, toBN(context.collaterals[1].minCollateralRatioBIPS).addn(53000),
                toBN(context.collaterals[1].ccbMinCollateralRatioBIPS).addn(53000), toBN(context.collaterals[1].safetyMinCollateralRatioBIPS).addn(53000));
            // start ccb
            const [ccb, ccbStartTimestamp] = await liquidator.startLiquidation(agent);
            assert.isTrue(ccb);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0,
                announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.CCB });
            assertWeb3Equal(info.ccbStartTimestamp, ccbStartTimestamp);
            const ccbTimeSeconds = (await context.assetManager.getSettings()).ccbTimeSeconds;
            assertWeb3Equal(info.liquidationStartTimestamp, toBN(ccbStartTimestamp).add(toBN(ccbTimeSeconds)));
            // Owner deposits more collateral
            await agent.depositVaultCollateral(fullAgentCollateral);
            const info2 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.add(fullAgentCollateral),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0,
                announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerWorkAddress, minted.mintedAmountUBA, { from: minter.address });
            // agent "buys" f-assets
            await agent.selfClose(minted.mintedAmountUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.add(fullAgentCollateral));
        });

        it("liquidation due to price change (agent can be safe again) (vault CR too low)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            const fullPoolCollateral = toWei(3e9);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullPoolCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await agent.setVaultCollateralRatioByChangingAssetPrice(12000);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding from pool and agent

            const poolCollateralRatioBIPS1 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);

            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0,
                status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // liquidation cannot be stopped if agent not safe
            await expectRevert(agent.endLiquidation(), "cannot stop liquidation");
            await expectRevert(liquidator.endLiquidation(agent), "cannot stop liquidation");
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (second part)
            const liquidateMaxUBA2 = minted.mintedAmountUBA.sub(liquidatedUBA1);
            const startBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA2);
            const endBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assert(liquidatedUBA2.lt(liquidateMaxUBA2)); // agent is safe again
            assertWeb3Equal(context.convertLotsToUBA(context.convertUBAToLots(liquidatedUBA2)), liquidatedUBA2);
            assert.isUndefined(liquidationStarted2);
            assert.equal(liquidationCancelled2.agentVault, agent.agentVault.address);
            // test rewarding
            const poolCollateralRatioBIPS2 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const poolLiquidationReward2 = await liquidator.getLiquidationRewardPool(liquidatedUBA2, poolLiquidationFactorBIPS2);
            const vaultCollateralRatioBIPS2 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const vaultCollateralLiquidationReward2 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA2, collateralVaultLiquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2VaultCollateral.sub(startBalanceLiquidator2VaultCollateral), vaultCollateralLiquidationReward2);
            assertWeb3Equal(endBalanceLiquidator2NAT.sub(startBalanceLiquidator2NAT), poolLiquidationReward2);
            const info2 = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1).sub(poolLiquidationReward2),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1).add(liquidatedUBA2),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2).add(minted.poolFeeUBA),
                status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // final tests
            assert(poolLiquidationFactorBIPS1.lt(poolLiquidationFactorBIPS2));
            assert(collateralVaultLiquidationFactorBIPS1.lte(collateralVaultLiquidationFactorBIPS2));
            const poolCollateralRatioBIPS3 = toBN((await agent.getAgentInfo()).poolCollateralRatioBIPS);
            const poolCollateralTypes = (await context.assetManager.getCollateralTypes())[0];
            assert(poolCollateralRatioBIPS3.gte(toBN(poolCollateralTypes.safetyMinCollateralRatioBIPS)));
            const vaultCollateralRatioBIPS3 = toBN((await agent.getAgentInfo()).vaultCollateralRatioBIPS);
            const vaultCollateralTypes = (await context.assetManager.getCollateralTypes())[1];
            assert(vaultCollateralRatioBIPS3.gte(toBN(vaultCollateralTypes.safetyMinCollateralRatioBIPS)));
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2);
            await context.fAsset.transfer(agent.ownerWorkAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2));
        });

        it("liquidation due to price change (pool CR unsafe) (agent cannot be safe again)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
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
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA), reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await context.priceStore.setCurrentPrice("NAT", 50, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 50, 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const poolCollateralRatioBIPS1 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);

            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0,
                status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (second part)

            const startBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA2, liquidateMaxUBA);
            assert.isUndefined(liquidationStarted2);
            assert.isUndefined(liquidationCancelled2);
            // test rewarding
            const poolCollateralRatioBIPS2 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const poolLiquidationReward2 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS2);
            const vaultCollateralRatioBIPS2 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const vaultCollateralLiquidationReward2 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA2, collateralVaultLiquidationFactorBIPS2);

            assertWeb3Equal(endBalanceLiquidator2VaultCollateral.sub(startBalanceLiquidator2VaultCollateral), vaultCollateralLiquidationReward2);
            assertWeb3Equal(endBalanceLiquidator2NAT.sub(startBalanceLiquidator2NAT), poolLiquidationReward2);
            const info2 = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1).sub(poolLiquidationReward2),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1).add(liquidatedUBA2),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2).add(minted.poolFeeUBA),
                status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, liquidationTimestamp1);
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (last part)
            const startBalanceLiquidator3NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator3VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA3, liquidationTimestamp3, liquidationStarted3, liquidationCancelled3] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator3NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator3VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA3, liquidateMaxUBA);
            assert.isUndefined(liquidationStarted3);
            assert.equal(liquidationCancelled3.agentVault, agent.agentVault.address);
            // test rewarding
            const poolCollateralRatioBIPS3 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS3 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS3, liquidationTimestamp1, liquidationTimestamp3);
            const poolLiquidationReward3 = await liquidator.getLiquidationRewardPool(liquidatedUBA3, poolLiquidationFactorBIPS3);
            const vaultCollateralRatioBIPS3 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS3 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS3, liquidationTimestamp1, liquidationTimestamp3);
            const vaultCollateralLiquidationReward3 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA3, collateralVaultLiquidationFactorBIPS3);
            assertWeb3Equal(endBalanceLiquidator3NAT.sub(startBalanceLiquidator3NAT), poolLiquidationReward3);
            assertWeb3Equal(endBalanceLiquidator3VaultCollateral.sub(startBalanceLiquidator3VaultCollateral), vaultCollateralLiquidationReward3);
            const info3 = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2).sub(vaultCollateralLiquidationReward3),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1).sub(poolLiquidationReward2).sub(poolLiquidationReward3),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1).add(liquidatedUBA2).add(liquidatedUBA3),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2).sub(liquidatedUBA3).add(minted.poolFeeUBA),
                status: AgentStatus.NORMAL });
            assertWeb3Equal(info3.ccbStartTimestamp, 0);
            assertWeb3Equal(info3.liquidationStartTimestamp, 0);
            // final tests
            assertWeb3Equal(liquidatedUBA1, liquidatedUBA2);
            assertWeb3Equal(liquidatedUBA2, liquidatedUBA3);
            assert(poolLiquidationFactorBIPS1.lte(poolLiquidationFactorBIPS2));
            assert(poolLiquidationFactorBIPS2.lte(poolLiquidationFactorBIPS3));
            assert(poolLiquidationReward1.lte(poolLiquidationReward2));
            assert(poolLiquidationReward2.lte(poolLiquidationReward3));

            assert(collateralVaultLiquidationFactorBIPS1.lte(collateralVaultLiquidationFactorBIPS2));
            assert(collateralVaultLiquidationFactorBIPS2.lte(collateralVaultLiquidationFactorBIPS3));
            assert(vaultCollateralLiquidationReward1.lte(vaultCollateralLiquidationReward2));
            assert(vaultCollateralLiquidationReward2.lte(vaultCollateralLiquidationReward3));
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2).sub(vaultCollateralLiquidationReward3));
        });

        it("liquidation due to price change (vault CR unsafe) (agent cannot be safe again)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            const fullPoolCollateral = toWei(3e9);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullPoolCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA), reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await agent.setVaultCollateralRatioByChangingAssetPrice(11000);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const poolCollateralRatioBIPS1 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);

            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0,
                status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (second part)

            const startBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA2, liquidateMaxUBA);
            assert.isUndefined(liquidationStarted2);
            assert.isUndefined(liquidationCancelled2);
            // test rewarding
            const poolCollateralRatioBIPS2 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const poolLiquidationReward2 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS2);
            const vaultCollateralRatioBIPS2 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const vaultCollateralLiquidationReward2 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA2, collateralVaultLiquidationFactorBIPS2);

            assertWeb3Equal(endBalanceLiquidator2VaultCollateral.sub(startBalanceLiquidator2VaultCollateral), vaultCollateralLiquidationReward2);
            assertWeb3Equal(endBalanceLiquidator2NAT.sub(startBalanceLiquidator2NAT), poolLiquidationReward2);
            const info2 = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1).sub(poolLiquidationReward2),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1).add(liquidatedUBA2),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2).add(minted.poolFeeUBA),
                status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, liquidationTimestamp1);
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (last part)
            const startBalanceLiquidator3NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator3VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA3, liquidationTimestamp3, liquidationStarted3, liquidationCancelled3] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator3NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator3VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA3, liquidateMaxUBA);
            assert.isUndefined(liquidationStarted3);
            assert.equal(liquidationCancelled3.agentVault, agent.agentVault.address);
            // test rewarding
            const poolCollateralRatioBIPS3 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS3 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS3, liquidationTimestamp1, liquidationTimestamp3);
            const poolLiquidationReward3 = await liquidator.getLiquidationRewardPool(liquidatedUBA3, poolLiquidationFactorBIPS3);
            const vaultCollateralRatioBIPS3 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS3 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS3, liquidationTimestamp1, liquidationTimestamp3);
            const vaultCollateralLiquidationReward3 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA3, collateralVaultLiquidationFactorBIPS3);
            assertWeb3Equal(endBalanceLiquidator3NAT.sub(startBalanceLiquidator3NAT), poolLiquidationReward3);
            assertWeb3Equal(endBalanceLiquidator3VaultCollateral.sub(startBalanceLiquidator3VaultCollateral), vaultCollateralLiquidationReward3);
            const info3 = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2).sub(vaultCollateralLiquidationReward3),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1).sub(poolLiquidationReward2).sub(poolLiquidationReward3),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1).add(liquidatedUBA2).add(liquidatedUBA3),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2).sub(liquidatedUBA3).add(minted.poolFeeUBA),
                status: AgentStatus.NORMAL });
            assertWeb3Equal(info3.ccbStartTimestamp, 0);
            assertWeb3Equal(info3.liquidationStartTimestamp, 0);
            // final tests
            assertWeb3Equal(liquidatedUBA1, liquidatedUBA2);
            assertWeb3Equal(liquidatedUBA2, liquidatedUBA3);
            assert(poolLiquidationFactorBIPS1.lte(poolLiquidationFactorBIPS2));
            assert(poolLiquidationFactorBIPS2.lte(poolLiquidationFactorBIPS3));
            assert(poolLiquidationReward1.lte(poolLiquidationReward2));
            assert(poolLiquidationReward2.lte(poolLiquidationReward3));

            assert(collateralVaultLiquidationFactorBIPS1.lte(collateralVaultLiquidationFactorBIPS2));
            assert(collateralVaultLiquidationFactorBIPS2.lte(collateralVaultLiquidationFactorBIPS3));
            assert(vaultCollateralLiquidationReward1.lte(vaultCollateralLiquidationReward2));
            assert(vaultCollateralLiquidationReward2.lte(vaultCollateralLiquidationReward3));
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2).sub(vaultCollateralLiquidationReward3));
        });

        it("liquidation due to price change (pool CR unsafe) (agent can end liquidation after new price change)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA), reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await context.priceStore.setCurrentPrice("NAT", 10, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 10, 0);
            await context.priceStore.setCurrentPrice(context.chainInfo.symbol,  toBNExp(10, 6), 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol,  toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const poolCollateralRatioBIPS1 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);


            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // price change after some time
            await time.increase(90);
            await context.priceStore.setCurrentPrice("NAT", 100, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 100, 0);
            await context.priceStore.setCurrentPrice(context.chainInfo.symbol,  toBNExp(10, 5), 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol,  toBNExp(10, 5), 0);
            // agent still in liquidation status
            const info1 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info1.ccbStartTimestamp, 0);
            assertWeb3Equal(info1.liquidationStartTimestamp, liquidationTimestamp1);
            // agent can end liquidation
            await agent.endLiquidation();
            // final tests
            const info2 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(poolLiquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const collateralTypes = (await context.assetManager.getCollateralTypes())[0];
            assert(collateralRatioBIPS2.gte(toBN(collateralTypes.safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1);
            await context.fAsset.transfer(agent.ownerWorkAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1));
        });

        it("liquidation due to price change (vault CR unsafe) (agent can end liquidation after new price change)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            const fullPoolCollateral = toWei(3e9);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullPoolCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA), reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await agent.setVaultCollateralRatioByChangingAssetPrice(11000);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const poolCollateralRatioBIPS1 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);


            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // price change after some time
            await time.increase(90);
            await agent.setVaultCollateralRatioByChangingAssetPrice(20000);
            // agent still in liquidation status
            const info1 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info1.ccbStartTimestamp, 0);
            assertWeb3Equal(info1.liquidationStartTimestamp, liquidationTimestamp1);
            // agent can end liquidation
            await agent.endLiquidation();
            // final tests
            const info2 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullPoolCollateral.sub(vaultCollateralLiquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const collateralTypes = (await context.assetManager.getCollateralTypes())[1];
            assert(collateralRatioBIPS2.gte(toBN(collateralTypes.safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1);
            await context.fAsset.transfer(agent.ownerWorkAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1));
        });

        it("liquidation due to price change (pool CR unsafe) (others can end liquidation after new price change)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await context.priceStore.setCurrentPrice("NAT", 10, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 10, 0);
            await context.priceStore.setCurrentPrice(context.chainInfo.symbol,  toBNExp(10, 6), 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol,  toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const poolCollateralRatioBIPS1 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);

            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // price change after some time
            await time.increase(90);
            await context.priceStore.setCurrentPrice("NAT", 100, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 100, 0);
            await context.priceStore.setCurrentPrice(context.chainInfo.symbol,  toBNExp(10, 5), 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol,  toBNExp(10, 5), 0);
            // agent still in liquidation status
            const info1 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info1.ccbStartTimestamp, 0);
            assertWeb3Equal(info1.liquidationStartTimestamp, liquidationTimestamp1);
            // others can end liquidation
            await liquidator.endLiquidation(agent);
            // final tests
            const info2 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(poolLiquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const collateralTypes = (await context.assetManager.getCollateralTypes())[0];
            assert(collateralRatioBIPS2.gte(toBN(collateralTypes.safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1);
            await context.fAsset.transfer(agent.ownerWorkAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1));
        });

        it("liquidation due to price change (vault CR unsafe) (others can end liquidation after new price change)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            const fullPoolCollateral = toWei(3e9);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullPoolCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await agent.setVaultCollateralRatioByChangingAssetPrice(12000);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const poolCollateralRatioBIPS1 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);

            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // price change after some time
            await time.increase(90);
            await context.priceStore.setCurrentPrice("NAT", 100, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 100, 0);
            await context.priceStore.setCurrentPrice(context.chainInfo.symbol,  toBNExp(10, 5), 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol,  toBNExp(10, 5), 0);
            // agent still in liquidation status
            const info1 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info1.ccbStartTimestamp, 0);
            assertWeb3Equal(info1.liquidationStartTimestamp, liquidationTimestamp1);
            // others can end liquidation
            await liquidator.endLiquidation(agent);
            // final tests
            const info2 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(vaultCollateralLiquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const collateralTypes = (await context.assetManager.getCollateralTypes())[1];
            assert(collateralRatioBIPS2.gte(toBN(collateralTypes.safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1);
            await context.fAsset.transfer(agent.ownerWorkAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1));
        });

        it("liquidation due to price change (pool CR unsafe) (cannot liquidate anything after new price change if agent is safe again)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA), reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await context.priceStore.setCurrentPrice("NAT", 10, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 10, 0);
            await context.priceStore.setCurrentPrice(context.chainInfo.symbol,  toBNExp(10, 6), 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol,  toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const poolCollateralRatioBIPS1 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // price change after some time
            await time.increase(90);
            await context.priceStore.setCurrentPrice("NAT", 100, 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders("NAT", 100, 0);
            await context.priceStore.setCurrentPrice(context.chainInfo.symbol,  toBNExp(10, 5), 0);
            await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol,  toBNExp(10, 5), 0);
            // wait some time to get next premium
            await time.increase(90);
            // agent still in liquidation status
            const info1 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info1.ccbStartTimestamp, 0);
            assertWeb3Equal(info1.liquidationStartTimestamp, liquidationTimestamp1);
            // liquidate agent (second part) - cannot liquidate anything as agent is safe again due to price change
            const liquidateMaxUBA2 = minted.mintedAmountUBA.sub(liquidatedUBA1);
            const startBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA2);
            const endBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA2, 0);
            assert.isUndefined(liquidationStarted2);
            assert.equal(liquidationCancelled2.agentVault, agent.agentVault.address);
            // test rewarding
            const poolCollateralRatioBIPS2 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const poolLiquidationReward2 = await liquidator.getLiquidationRewardPool(liquidatedUBA2, poolLiquidationFactorBIPS2);

            const vaultCollateralRatioBIPS2 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const vaultCollateralLiquidationReward2 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA2, collateralVaultLiquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2NAT.sub(startBalanceLiquidator2NAT), poolLiquidationReward2);
            assertWeb3Equal(endBalanceLiquidator2VaultCollateral.sub(startBalanceLiquidator2VaultCollateral), vaultCollateralLiquidationReward2);
            assertWeb3Equal(vaultCollateralLiquidationReward2, 0);
            assertWeb3Equal(poolLiquidationReward2, 0);
            const info2 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullAgentCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // final tests
            assert(poolLiquidationFactorBIPS1.lt(poolLiquidationFactorBIPS2));
            assert(collateralVaultLiquidationFactorBIPS1.lte(collateralVaultLiquidationFactorBIPS2));
            const collateralRatioBIPS3 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(poolLiquidationReward1).sub(vaultCollateralLiquidationReward2), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const collateralTypes = (await context.assetManager.getCollateralTypes())[0];
            assert(collateralRatioBIPS3.gte(toBN(collateralTypes.safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2);
            await context.fAsset.transfer(agent.ownerWorkAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2));
        });

        it("liquidation due to price change (vault CR unsafe) (cannot liquidate anything after new price change if agent is safe again)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            const fullPoolCollateral = toWei(3e9);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullPoolCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA), reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await agent.setVaultCollateralRatioByChangingAssetPrice(12000);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const poolCollateralRatioBIPS1 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // price change after some time
            await time.increase(90);
            await agent.setVaultCollateralRatioByChangingAssetPrice(30000);
            // wait some time to get next premium
            await time.increase(90);
            // agent still in liquidation status
            const info1 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info1.ccbStartTimestamp, 0);
            assertWeb3Equal(info1.liquidationStartTimestamp, liquidationTimestamp1);
            // liquidate agent (second part) - cannot liquidate anything as agent is safe again due to price change
            const liquidateMaxUBA2 = minted.mintedAmountUBA.sub(liquidatedUBA1);
            const startBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA2);
            const endBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA2, 0);
            assert.isUndefined(liquidationStarted2);
            assert.equal(liquidationCancelled2.agentVault, agent.agentVault.address);
            // test rewarding
            const poolCollateralRatioBIPS2 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const poolLiquidationReward2 = await liquidator.getLiquidationRewardPool(liquidatedUBA2, poolLiquidationFactorBIPS2);

            const vaultCollateralRatioBIPS2 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const vaultCollateralLiquidationReward2 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA2, collateralVaultLiquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2NAT.sub(startBalanceLiquidator2NAT), poolLiquidationReward2);
            assertWeb3Equal(endBalanceLiquidator2VaultCollateral.sub(startBalanceLiquidator2VaultCollateral), vaultCollateralLiquidationReward2);
            assertWeb3Equal(vaultCollateralLiquidationReward2, 0);
            assertWeb3Equal(poolLiquidationReward2, 0);
            const info2 = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0, status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // final tests
            assert(poolLiquidationFactorBIPS1.lt(poolLiquidationFactorBIPS2));
            assert(collateralVaultLiquidationFactorBIPS1.lte(collateralVaultLiquidationFactorBIPS2));
            const collateralRatioBIPS3 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const collateralTypes = (await context.assetManager.getCollateralTypes())[1];
            assert(collateralRatioBIPS3.gte(toBN(collateralTypes.safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2);
            await context.fAsset.transfer(agent.ownerWorkAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2));
        });

        it("liquidation due to price change (agent can be safe again) (vault + pool CR little both too low)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            const fullPoolCollateral = toWei(5e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullPoolCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await agent.setVaultCollateralRatioByChangingAssetPrice(18000);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding from pool and agent
            const poolCollateralRatioBIPS1 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);

            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0,
                status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // liquidation cannot be stopped if agent not safe
            await expectRevert(agent.endLiquidation(), "cannot stop liquidation");
            await expectRevert(liquidator.endLiquidation(agent), "cannot stop liquidation");
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (second part)
            const liquidateMaxUBA2 = minted.mintedAmountUBA.sub(liquidatedUBA1);
            const startBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA2);
            const endBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assert(liquidatedUBA2.lt(liquidateMaxUBA2)); // agent is safe again
            assertWeb3Equal(context.convertLotsToUBA(context.convertUBAToLots(liquidatedUBA2)), liquidatedUBA2);
            assert.isUndefined(liquidationStarted2);
            assert.equal(liquidationCancelled2.agentVault, agent.agentVault.address);
            // test rewarding
            const poolCollateralRatioBIPS2 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const poolLiquidationReward2 = await liquidator.getLiquidationRewardPool(liquidatedUBA2, poolLiquidationFactorBIPS2);
            const vaultCollateralRatioBIPS2 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const vaultCollateralLiquidationReward2 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA2, collateralVaultLiquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2VaultCollateral.sub(startBalanceLiquidator2VaultCollateral), vaultCollateralLiquidationReward2);
            assertWeb3Equal(endBalanceLiquidator2NAT.sub(startBalanceLiquidator2NAT), poolLiquidationReward2);
            const info2 = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1).sub(poolLiquidationReward2),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1).add(liquidatedUBA2),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2).add(minted.poolFeeUBA),
                status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // final tests
            assert(poolLiquidationFactorBIPS1.lt(poolLiquidationFactorBIPS2));
            assert(collateralVaultLiquidationFactorBIPS1.lte(collateralVaultLiquidationFactorBIPS2));
            const poolCollateralRatioBIPS3 = toBN((await agent.getAgentInfo()).poolCollateralRatioBIPS);
            const poolCollateralTypes = (await context.assetManager.getCollateralTypes())[0];
            assert(poolCollateralRatioBIPS3.gte(toBN(poolCollateralTypes.safetyMinCollateralRatioBIPS)));
            const vaultCollateralRatioBIPS3 = toBN((await agent.getAgentInfo()).vaultCollateralRatioBIPS);
            const vaultCollateralTypes = (await context.assetManager.getCollateralTypes())[1];
            assert(vaultCollateralRatioBIPS3.gte(toBN(vaultCollateralTypes.safetyMinCollateralRatioBIPS)));
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2);
            await context.fAsset.transfer(agent.ownerWorkAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2));
        });

        it("liquidation due to price change (agent can be safe again) (vault + pool CR both very low)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            const fullPoolCollateral = toWei(9e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullPoolCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await agent.setVaultCollateralRatioByChangingAssetPrice(11000);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding from pool and agent
            const poolCollateralRatioBIPS1 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);

            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0,
                status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // liquidation cannot be stopped if agent not safe
            await expectRevert(agent.endLiquidation(), "cannot stop liquidation");
            await expectRevert(liquidator.endLiquidation(agent), "cannot stop liquidation");
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (second part)
            const liquidateMaxUBA2 = minted.mintedAmountUBA.sub(liquidatedUBA1);
            const startBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA2);
            const endBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assert(liquidatedUBA2.lt(liquidateMaxUBA2)); // agent is safe again
            assertWeb3Equal(context.convertLotsToUBA(context.convertUBAToLots(liquidatedUBA2)), liquidatedUBA2);
            assert.isUndefined(liquidationStarted2);
            assert.equal(liquidationCancelled2.agentVault, agent.agentVault.address);
            // test rewarding
            const poolCollateralRatioBIPS2 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const poolLiquidationReward2 = await liquidator.getLiquidationRewardPool(liquidatedUBA2, poolLiquidationFactorBIPS2);
            const vaultCollateralRatioBIPS2 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const vaultCollateralLiquidationReward2 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA2, collateralVaultLiquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2VaultCollateral.sub(startBalanceLiquidator2VaultCollateral), vaultCollateralLiquidationReward2);
            assertWeb3Equal(endBalanceLiquidator2NAT.sub(startBalanceLiquidator2NAT), poolLiquidationReward2);
            const info2 = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1).sub(poolLiquidationReward2),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1).add(liquidatedUBA2),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2).add(minted.poolFeeUBA),
                status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // final tests
            assert(poolLiquidationFactorBIPS1.lt(poolLiquidationFactorBIPS2));
            assert(collateralVaultLiquidationFactorBIPS1.lte(collateralVaultLiquidationFactorBIPS2));
            const poolCollateralRatioBIPS3 = toBN((await agent.getAgentInfo()).poolCollateralRatioBIPS);
            const poolCollateralTypes = (await context.assetManager.getCollateralTypes())[0];
            assert(poolCollateralRatioBIPS3.gte(toBN(poolCollateralTypes.safetyMinCollateralRatioBIPS)));
            const vaultCollateralRatioBIPS3 = toBN((await agent.getAgentInfo()).vaultCollateralRatioBIPS);
            const vaultCollateralTypes = (await context.assetManager.getCollateralTypes())[1];
            assert(vaultCollateralRatioBIPS3.gte(toBN(vaultCollateralTypes.safetyMinCollateralRatioBIPS)));
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2);
            await context.fAsset.transfer(agent.ownerWorkAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2));
        });

        it("liquidation due to price change (agent can be safe again) (vault + pool CR both very low, pool CR lower than vault CR)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            const fullPoolCollateral = toWei(5e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullPoolCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            const poolCRFee = await agent.poolCRFee(lots);
            assertWeb3Equal(minted.mintedAmountUBA, context.convertLotsToUBA(lots));
            await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: minted.agentFeeUBA,
                mintedUBA: minted.mintedAmountUBA.add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0 });
            // price change
            await agent.setVaultCollateralRatioByChangingAssetPrice(11000);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator1VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding from pool and agent

            const vaultCollateralRatioBIPS1 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const vaultCollateralLiquidationReward1 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA1, collateralVaultLiquidationFactorBIPS1);

            //Pool reward calculation is a little different when pool CR lower than vault CR
            const poolLiquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPSPool(vaultCollateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const poolLiquidationReward1 = await liquidator.getLiquidationRewardPool(liquidatedUBA1, poolLiquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1NAT.sub(startBalanceLiquidator1NAT), poolLiquidationReward1);
            assertWeb3Equal(endBalanceLiquidator1VaultCollateral.sub(startBalanceLiquidator1VaultCollateral), vaultCollateralLiquidationReward1);
            const info = await agent.checkAgentInfo({ totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).add(minted.poolFeeUBA),
                reservedUBA: 0, redeemingUBA: 0, announcedVaultCollateralWithdrawalWei: 0,
                status: AgentStatus.LIQUIDATION });
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // liquidation cannot be stopped if agent not safe
            await expectRevert(agent.endLiquidation(), "cannot stop liquidation");
            await expectRevert(liquidator.endLiquidation(agent), "cannot stop liquidation");
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (second part)
            const liquidateMaxUBA2 = minted.mintedAmountUBA.sub(liquidatedUBA1);
            const startBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const startBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA2);
            const endBalanceLiquidator2NAT = await context.wNat.balanceOf(liquidator.address);
            const endBalanceLiquidator2VaultCollateral = await agent.vaultCollateralToken().balanceOf(liquidator.address);
            assert(liquidatedUBA2.lte(liquidateMaxUBA2)); // agent is safe again
            assertWeb3Equal(context.convertLotsToUBA(context.convertUBAToLots(liquidatedUBA2)), liquidatedUBA2);
            assert.isUndefined(liquidationStarted2);
            assert.equal(liquidationCancelled2.agentVault, agent.agentVault.address);
            // test rewarding
            const poolCollateralRatioBIPS2 = (await agent.getAgentInfo()).poolCollateralRatioBIPS;
            const poolLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSPool(poolCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const poolLiquidationReward2 = await liquidator.getLiquidationRewardPool(liquidatedUBA2, poolLiquidationFactorBIPS2);
            const vaultCollateralRatioBIPS2 = (await agent.getAgentInfo()).vaultCollateralRatioBIPS;
            const collateralVaultLiquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPSVaultCollateral(vaultCollateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const vaultCollateralLiquidationReward2 = await liquidator.getLiquidationRewardVaultCollateral(liquidatedUBA2, collateralVaultLiquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2VaultCollateral.sub(startBalanceLiquidator2VaultCollateral), vaultCollateralLiquidationReward2);
            assertWeb3Equal(endBalanceLiquidator2NAT.sub(startBalanceLiquidator2NAT), poolLiquidationReward2);
            const info2 = await agent.checkAgentInfo({
                totalVaultCollateralWei: fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2),
                totalPoolCollateralNATWei: fullPoolCollateral.add(poolCRFee).sub(poolLiquidationReward1).sub(poolLiquidationReward2),
                freeUnderlyingBalanceUBA: minted.agentFeeUBA.add(liquidatedUBA1).add(liquidatedUBA2),
                mintedUBA: minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2).add(minted.poolFeeUBA),
                status: AgentStatus.NORMAL });
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // final tests
            assert(poolLiquidationFactorBIPS1.lt(poolLiquidationFactorBIPS2));
            assert(collateralVaultLiquidationFactorBIPS1.lte(collateralVaultLiquidationFactorBIPS2));
            const poolCollateralRatioBIPS3 = toBN((await agent.getAgentInfo()).poolCollateralRatioBIPS);
            const poolCollateralTypes = (await context.assetManager.getCollateralTypes())[0];
            assert(poolCollateralRatioBIPS3.gte(toBN(poolCollateralTypes.safetyMinCollateralRatioBIPS)));
            const vaultCollateralRatioBIPS3 = toBN((await agent.getAgentInfo()).vaultCollateralRatioBIPS);
            const vaultCollateralTypes = (await context.assetManager.getCollateralTypes())[1];
            assert(vaultCollateralRatioBIPS3.gte(toBN(vaultCollateralTypes.safetyMinCollateralRatioBIPS)));
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2);
            await context.fAsset.transfer(agent.ownerWorkAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.eq(BN_ZERO));
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(vaultCollateralLiquidationReward1).sub(vaultCollateralLiquidationReward2));
        });
    });
});
