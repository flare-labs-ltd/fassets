import { expectRevert, time } from "@openzeppelin/test-helpers";
import { BN_ZERO, toBN, toBNExp, toWei } from "../../../lib/utils/helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Liquidator } from "../utils/Liquidator";
import { Minter } from "../utils/Minter";
import { testChainInfo, testNatInfo } from "../utils/TestChainInfo";

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
    let mockStateConnectorClient: MockStateConnectorClient;

    beforeEach(async () => {
        commonContext = await CommonContext.createTest(governance, testNatInfo);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
        mockChain = context.chain as MockChain;
        mockStateConnectorClient = context.stateConnectorClient as MockStateConnectorClient;
    });

    describe("simple scenarios - price change liquidation", () => {

        it("ccb due to price change (no liquidation due to collateral deposit)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            // price change
            await context.natFtso.setCurrentPrice(6, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // start ccb
            const [ccb, ccbStartTimestamp] = await liquidator.startLiquidation(agent);
            assert.isTrue(ccb);
            const info = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0, 0, 1);
            assertWeb3Equal(info.ccbStartTimestamp, ccbStartTimestamp);
            const ccbTimeSeconds = (await context.assetManager.getSettings()).ccbTimeSeconds;
            assertWeb3Equal(info.liquidationStartTimestamp, toBN(ccbStartTimestamp).add(toBN(ccbTimeSeconds)));
            // deposit collateral
            const additionalCollateral = toWei(5e7);
            const liquidationCancelled = await agent.depositCollateral(additionalCollateral);
            // test that ccb cancelled due to collateral deposit
            assert.equal(liquidationCancelled!.agentVault, agent.agentVault.address);
            const collateralRatioBIPS = await agent.getCollateralRatioBIPS(fullAgentCollateral.add(additionalCollateral), minted.mintedAmountUBA);
            assert(collateralRatioBIPS.gte(toBN((await context.assetManager.getSettings()).minCollateralRatioBIPS)));
            assert(collateralRatioBIPS.lt(toBN((await context.assetManager.getSettings()).safetyMinCollateralRatioBIPS)));
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.add(additionalCollateral), crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0, 0, 0);
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerAddress, minted.mintedAmountUBA, { from: minter.address });
            await agent.selfClose(minted.mintedAmountUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.add(additionalCollateral));
        });

        it("ccb due to price change (no liquidation due to partial self close)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0);
            // price change
            await context.natFtso.setCurrentPrice(6, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // start ccb
            const [ccb, ccbStartTimestamp] = await liquidator.startLiquidation(agent);
            assert.isTrue(ccb);
            const info = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0, 0, 1);
            assertWeb3Equal(info.ccbStartTimestamp, ccbStartTimestamp);
            const ccbTimeSeconds = (await context.assetManager.getSettings()).ccbTimeSeconds;
            assertWeb3Equal(info.liquidationStartTimestamp, toBN(ccbStartTimestamp).add(toBN(ccbTimeSeconds)));
            // agent "buys" f-assets
            await context.fAsset.transfer(agent.ownerAddress, minted.mintedAmountUBA, { from: minter.address });
            // perform partial self close
            const selfCloseAmountUBA = context.convertAmgToUBA(1e10);
            const [, selfClosedValueUBA, liquidationCancelledEvent] = await agent.selfClose(selfCloseAmountUBA);
            // test that ccb cancelled due to self close
            assert.equal(liquidationCancelledEvent.agentVault, agent.agentVault.address);
            const collateralRatioBIPS = await agent.getCollateralRatioBIPS(fullAgentCollateral, minted.mintedAmountUBA.sub(selfClosedValueUBA));
            assert(collateralRatioBIPS.gte(toBN((await context.assetManager.getSettings()).minCollateralRatioBIPS)));
            assert(collateralRatioBIPS.lt(toBN((await context.assetManager.getSettings()).safetyMinCollateralRatioBIPS)));
            const info2 = await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA.add(selfClosedValueUBA), crt.valueUBA.sub(selfClosedValueUBA), minted.mintedAmountUBA.sub(selfClosedValueUBA), 0, 0, 0, 0);
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // agent "buys" f-assets
            await agent.selfClose(minted.mintedAmountUBA.sub(selfClosedValueUBA));
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("liquidation due to price change (agent can be safe again)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0);
            // price change
            await context.natFtso.setCurrentPrice(11, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1 = await context.wNat.balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1 = await context.wNat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const collateralRatioBIPS1 = await agent.getCollateralRatioBIPS(fullAgentCollateral, minted.mintedAmountUBA);
            const liquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const liquidationReward1 = await liquidator.getLiquidationReward(liquidatedUBA1, liquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1.sub(startBalanceLiquidator1), liquidationReward1);
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // liquidation cannot be stopped if agent not safe
            await expectRevert(agent.endLiquidation(), "cannot stop liquidation");
            await expectRevert(liquidator.endLiquidation(agent), "cannot stop liquidation");
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (second part)
            const liquidateMaxUBA2 = minted.mintedAmountUBA.sub(liquidatedUBA1);
            const startBalanceLiquidator2 = await context.wNat.balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA2);
            const endBalanceLiquidator2 = await context.wNat.balanceOf(liquidator.address);
            assert(liquidatedUBA2.lt(liquidateMaxUBA2)); // agent is safe again
            assertWeb3Equal(await context.convertLotsToUBA(await context.convertUBAToLots(liquidatedUBA2)), liquidatedUBA2);
            assert.isUndefined(liquidationStarted2);
            assert.equal(liquidationCancelled2.agentVault, agent.agentVault.address);
            // test rewarding
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const liquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const liquidationReward2 = await liquidator.getLiquidationReward(liquidatedUBA2, liquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2.sub(startBalanceLiquidator2), liquidationReward2);
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2), crt.feeUBA.add(liquidatedUBA1).add(liquidatedUBA2), crt.valueUBA.sub(liquidatedUBA1).sub(liquidatedUBA2), minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2));
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // final tests
            assert(liquidationFactorBIPS1.lt(liquidationFactorBIPS2));
            const collateralRatioBIPS3 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2), minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2));
            assert(collateralRatioBIPS3.gte(toBN((await context.assetManager.getSettings()).safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2);
            await context.fAsset.transfer(agent.ownerAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2));
        });

        it("liquidation due to price change (agent cannot be safe again)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0);
            // price change
            await context.natFtso.setCurrentPrice(1, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1 = await context.wNat.balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator1 = await context.wNat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const collateralRatioBIPS1 = await agent.getCollateralRatioBIPS(fullAgentCollateral, minted.mintedAmountUBA);
            const liquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const liquidationReward1 = await liquidator.getLiquidationReward(liquidatedUBA1, liquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1.sub(startBalanceLiquidator1), liquidationReward1);
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (second part)
            const startBalanceLiquidator2 = await context.wNat.balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator2 = await context.wNat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA2, liquidateMaxUBA);
            assert.isUndefined(liquidationStarted2);
            assert.isUndefined(liquidationCancelled2);
            // test rewarding
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const liquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const liquidationReward2 = await liquidator.getLiquidationReward(liquidatedUBA2, liquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2.sub(startBalanceLiquidator2), liquidationReward2);
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2), crt.feeUBA.add(liquidatedUBA1).add(liquidatedUBA2), crt.valueUBA.sub(liquidatedUBA1).sub(liquidatedUBA2), minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2), 0, 0, 0, 2);
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, liquidationTimestamp1);
            // wait some time to get next premium
            await time.increase(90);
            // liquidate agent (last part)
            const startBalanceLiquidator3 = await context.wNat.balanceOf(liquidator.address);
            const [liquidatedUBA3, liquidationTimestamp3, liquidationStarted3, liquidationCancelled3] = await liquidator.liquidate(agent, liquidateMaxUBA);
            const endBalanceLiquidator3 = await context.wNat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA3, liquidateMaxUBA);
            assert.isUndefined(liquidationStarted3);
            assert.equal(liquidationCancelled3.agentVault, agent.agentVault.address);
            // test rewarding
            const collateralRatioBIPS3 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2), minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2));
            const liquidationFactorBIPS3 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS3, liquidationTimestamp1, liquidationTimestamp3);
            const liquidationReward3 = await liquidator.getLiquidationReward(liquidatedUBA3, liquidationFactorBIPS3);
            assertWeb3Equal(endBalanceLiquidator3.sub(startBalanceLiquidator3), liquidationReward3);
            const info3 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2).sub(liquidationReward3), crt.feeUBA.add(crt.valueUBA), 0, 0);
            assertWeb3Equal(info3.ccbStartTimestamp, 0);
            assertWeb3Equal(info3.liquidationStartTimestamp, 0);
            // final tests
            assertWeb3Equal(liquidatedUBA1, liquidatedUBA2);
            assertWeb3Equal(liquidatedUBA2, liquidatedUBA3);
            assert(liquidationFactorBIPS1.lte(liquidationFactorBIPS2));
            assert(liquidationFactorBIPS2.lte(liquidationFactorBIPS3));
            assert(liquidationReward1.lte(liquidationReward2));
            assert(liquidationReward2.lte(liquidationReward3));
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2).sub(liquidationReward3));
        });

        it("liquidation due to price change (agent can end liquidation after new price change)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0);
            // price change
            await context.natFtso.setCurrentPrice(11, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1 = await context.wNat.balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1 = await context.wNat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const collateralRatioBIPS1 = await agent.getCollateralRatioBIPS(fullAgentCollateral, minted.mintedAmountUBA);
            const liquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const liquidationReward1 = await liquidator.getLiquidationReward(liquidatedUBA1, liquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1.sub(startBalanceLiquidator1), liquidationReward1);
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // price change after some time
            await time.increase(90);
            await context.natFtso.setCurrentPrice(100, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
            // agent still in liquidation status
            const info1 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info1.ccbStartTimestamp, 0);
            assertWeb3Equal(info1.liquidationStartTimestamp, liquidationTimestamp1);
            // agent can end liquidation
            await agent.endLiquidation();
            // final tests
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            assert(collateralRatioBIPS2.gte(toBN((await context.assetManager.getSettings()).safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1);
            await context.fAsset.transfer(agent.ownerAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(liquidationReward1));
        });

        it("liquidation due to price change (others can end liquidation after new price change)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0);
            // price change
            await context.natFtso.setCurrentPrice(11, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1 = await context.wNat.balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1 = await context.wNat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const collateralRatioBIPS1 = await agent.getCollateralRatioBIPS(fullAgentCollateral, minted.mintedAmountUBA);
            const liquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const liquidationReward1 = await liquidator.getLiquidationReward(liquidatedUBA1, liquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1.sub(startBalanceLiquidator1), liquidationReward1);
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // price change after some time
            await time.increase(90);
            await context.natFtso.setCurrentPrice(100, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
            // agent still in liquidation status
            const info1 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info1.ccbStartTimestamp, 0);
            assertWeb3Equal(info1.liquidationStartTimestamp, liquidationTimestamp1);
            // others can end liquidation
            await liquidator.endLiquidation(agent);
            // final tests
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            assert(collateralRatioBIPS2.gte(toBN((await context.assetManager.getSettings()).safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1);
            await context.fAsset.transfer(agent.ownerAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(liquidationReward1));
        });

        it("liquidation due to price change (cannot liquidate anything after new price change if agent is safe again)", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            const liquidator = await Liquidator.create(context, liquidatorAddress1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000);
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 6;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const txHash = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, txHash);
            assertWeb3Equal(minted.mintedAmountUBA, await context.convertLotsToUBA(lots));
            await agent.checkAgentInfo(fullAgentCollateral, crt.feeUBA, crt.valueUBA, minted.mintedAmountUBA, 0, 0);
            // price change
            await context.natFtso.setCurrentPrice(11, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
            // liquidator "buys" f-assets
            await context.fAsset.transfer(liquidator.address, minted.mintedAmountUBA, { from: minter.address });
            // liquidate agent (partially)
            const liquidateMaxUBA1 = minted.mintedAmountUBA.divn(lots);
            const startBalanceLiquidator1 = await context.wNat.balanceOf(liquidator.address);
            const [liquidatedUBA1, liquidationTimestamp1, liquidationStarted1, liquidationCancelled1] = await liquidator.liquidate(agent, liquidateMaxUBA1);
            const endBalanceLiquidator1 = await context.wNat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA1, liquidateMaxUBA1);
            assert.equal(liquidationStarted1.agentVault, agent.agentVault.address);
            assert.isUndefined(liquidationCancelled1);
            // test rewarding
            const collateralRatioBIPS1 = await agent.getCollateralRatioBIPS(fullAgentCollateral, minted.mintedAmountUBA);
            const liquidationFactorBIPS1 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS1, liquidationTimestamp1, liquidationTimestamp1);
            const liquidationReward1 = await liquidator.getLiquidationReward(liquidatedUBA1, liquidationFactorBIPS1);
            assertWeb3Equal(endBalanceLiquidator1.sub(startBalanceLiquidator1), liquidationReward1);
            const info = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, liquidationTimestamp1);
            // price change after some time
            await time.increase(90);
            await context.natFtso.setCurrentPrice(100, 0);
            await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
            // wait some time to get next premium
            await time.increase(90);
            // agent still in liquidation status
            const info1 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1), 0, 0, 0, 2);
            assertWeb3Equal(info1.ccbStartTimestamp, 0);
            assertWeb3Equal(info1.liquidationStartTimestamp, liquidationTimestamp1);
            // liquidate agent (second part) - cannot liquidate anything as agent is safe again due to price change
            const liquidateMaxUBA2 = minted.mintedAmountUBA.sub(liquidatedUBA1);
            const startBalanceLiquidator2 = await context.wNat.balanceOf(liquidator.address);
            const [liquidatedUBA2, liquidationTimestamp2, liquidationStarted2, liquidationCancelled2] = await liquidator.liquidate(agent, liquidateMaxUBA2);
            const endBalanceLiquidator2 = await context.wNat.balanceOf(liquidator.address);
            assertWeb3Equal(liquidatedUBA2, 0);
            assert.isUndefined(liquidationStarted2);
            assert.equal(liquidationCancelled2.agentVault, agent.agentVault.address);
            // test rewarding
            const collateralRatioBIPS2 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            const liquidationFactorBIPS2 = await liquidator.getLiquidationFactorBIPS(collateralRatioBIPS2, liquidationTimestamp1, liquidationTimestamp2);
            const liquidationReward2 = await liquidator.getLiquidationReward(liquidatedUBA2, liquidationFactorBIPS2);
            assertWeb3Equal(endBalanceLiquidator2.sub(startBalanceLiquidator2), liquidationReward2);
            assertWeb3Equal(liquidationReward2, 0);
            const info2 = await agent.checkAgentInfo(fullAgentCollateral.sub(liquidationReward1), crt.feeUBA.add(liquidatedUBA1), crt.valueUBA.sub(liquidatedUBA1), minted.mintedAmountUBA.sub(liquidatedUBA1));
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            // final tests
            assert(liquidationFactorBIPS1.lt(liquidationFactorBIPS2));
            const collateralRatioBIPS3 = await agent.getCollateralRatioBIPS(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2), minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2));
            assert(collateralRatioBIPS3.gte(toBN((await context.assetManager.getSettings()).safetyMinCollateralRatioBIPS)))
            // agent "buys" f-assets
            const remainingUBA = minted.mintedAmountUBA.sub(liquidatedUBA1).sub(liquidatedUBA2);
            await context.fAsset.transfer(agent.ownerAddress, remainingUBA, { from: liquidator.address });
            assert(remainingUBA.gt(BN_ZERO));
            await agent.selfClose(remainingUBA);
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(liquidationReward1).sub(liquidationReward2));
        });
    });
});
