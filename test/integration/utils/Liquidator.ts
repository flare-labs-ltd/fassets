import { expectEvent } from "@openzeppelin/test-helpers";
import { AgentInCCB, LiquidationEnded, LiquidationStarted } from "../../../typechain-truffle/AssetManager";
import { eventArgs, filterEvents, findEvent, requiredEventArgs } from "../../../lib/utils/events/truffle";
import { EventArgs } from "../../../lib/utils/events/common";
import { BNish, BN_ZERO, toBN } from "../../../lib/utils/helpers";
import { Agent } from "./Agent";
import { AssetContext, AssetContextClient } from "./AssetContext";

const AgentVault = artifacts.require('AgentVault');

export class Liquidator extends AssetContextClient {
    static deepCopyWithObjectCreate = true;

    constructor(
        context: AssetContext,
        public address: string
    ) {
        super(context);
    }

    static async create(ctx: AssetContext, address: string) {
        // creater object
        return new Liquidator(ctx, address);
    }

    async startLiquidation(agent: Agent): Promise<[ccb: boolean, blockTimestamp: BNish]> {
        const res = await this.assetManager.startLiquidation(agent.agentVault.address, { from: this.address });
        const liquidationStarted = findEvent(res, 'LiquidationStarted') ?? findEvent(res, 'AgentInCCB');
        if (!liquidationStarted) assert.fail("Missing liquidation start or CCB event");
        assert.equal(liquidationStarted.args.agentVault, agent.agentVault.address);
        return [liquidationStarted.event === 'AgentInCCB', liquidationStarted.args.timestamp];
    }

    async liquidate(agent: Agent, amountUBA: BNish): Promise<[liquidatedValueUBA: BN, blockTimestamp: BNish, liquidationStarted: EventArgs<LiquidationStarted>, liquidationCancelled: EventArgs<LiquidationEnded>, dustChangesUBA: BN[]]> {
        const res = await this.assetManager.liquidate(agent.agentVault.address, amountUBA, { from: this.address });
        expectEvent.notEmitted(res, 'AgentInCCB');
        const liquidationPerformed = requiredEventArgs(res, 'LiquidationPerformed');
        const dustChangedEvents = filterEvents(res, 'DustChanged').map(e => e.args);
        assert.equal(liquidationPerformed.agentVault, agent.agentVault.address);
        assert.equal(liquidationPerformed.liquidator, this.address);
        const tr = await web3.eth.getTransaction(res.tx);
        const block = await web3.eth.getBlock(tr.blockHash!);
        return [liquidationPerformed.valueUBA, block.timestamp, eventArgs(res, 'LiquidationStarted'), eventArgs(res, 'LiquidationEnded'), dustChangedEvents.map(dc => dc.dustUBA)];
    }

    async endLiquidation(agent: Agent) {
        const res = await this.assetManager.endLiquidation(agent.agentVault.address, { from: this.address });
        assert.equal(requiredEventArgs(res, 'LiquidationEnded').agentVault, agent.agentVault.address);
    }

    async getLiquidationRewardPool(liquidatedAmountUBA: BNish, factorBIPS: BNish) {
        const liquidatedAmountAMG = this.context.convertUBAToAmg(liquidatedAmountUBA);
        const priceNAT = await this.context.getCollateralPrice(this.context.collaterals[0]);
        return priceNAT.convertAmgToTokenWei(toBN(liquidatedAmountAMG).mul(toBN(factorBIPS)).divn(10_000));
    }

    async getLiquidationFactorBIPS(liquidationStartedAt: BNish, liquidationPerformedAt: BNish, ccb: boolean = false) {
        // calculate premium step based on time since liquidation started
        const settings = await this.assetManager.getSettings();
        const ccbTime = ccb ? toBN(settings.ccbTimeSeconds) : BN_ZERO;
        const liquidationStart = toBN(liquidationStartedAt).add(ccbTime);
        const startTs = toBN(liquidationPerformedAt);
        const step = Math.min(this.context.liquidationSettings.liquidationCollateralFactorBIPS.length - 1,
            startTs.sub(liquidationStart).div(toBN(this.context.liquidationSettings.liquidationStepSeconds)).toNumber());
        // premiums are expressed as percentage of minCollateralRatio
        return toBN(this.context.liquidationSettings.liquidationCollateralFactorBIPS[step]);
    }

    async getLiquidationRewardClass1(liquidatedAmountUBA: BNish, factorBIPS: BNish) {
        const liquidatedAmountAMG = this.context.convertUBAToAmg(liquidatedAmountUBA);
        const priceClass1 = await this.context.getCollateralPrice(this.context.collaterals[1]);
        return priceClass1.convertAmgToTokenWei(toBN(liquidatedAmountAMG).mul(toBN(factorBIPS)).divn(10_000));
    }

    async getLiquidationFactorBIPSClass1(collateralRatioBIPS: BNish, liquidationStartedAt: BNish, liquidationPerformedAt: BNish, ccb: boolean = false) {
        // calculate premium step based on time since liquidation started
        const settings = await this.assetManager.getSettings();
        const ccbTime = ccb ? toBN(settings.ccbTimeSeconds) : BN_ZERO;
        const liquidationStart = toBN(liquidationStartedAt).add(ccbTime);
        const startTs = toBN(liquidationPerformedAt);
        const step = Math.min(this.context.liquidationSettings.liquidationFactorClass1BIPS.length - 1,
            startTs.sub(liquidationStart).div(toBN(this.context.liquidationSettings.liquidationStepSeconds)).toNumber());
        // premiums are expressed as percentage of minCollateralRatio
        const factorBIPS = toBN(this.context.liquidationSettings.liquidationFactorClass1BIPS[step]);
        // max premium is equal to agents collateral ratio (so that all liquidators get at least this much)
        return factorBIPS.lt(toBN(collateralRatioBIPS)) ? factorBIPS : toBN(collateralRatioBIPS);
    }

    // notice: doesn't cap the factor at pool's CR
    async getLiquidationFactorBIPSPool(collateralRatioBIPS: BNish, liquidationStartedAt: BNish, liquidationPerformedAt: BNish, ccb: boolean = false) {
        const liquidationFactor = await this.getLiquidationFactorBIPS(liquidationStartedAt, liquidationPerformedAt, ccb);
        const liquidationFactorClass1 = await this.getLiquidationFactorBIPSClass1(collateralRatioBIPS, liquidationStartedAt, liquidationPerformedAt, ccb);
        return liquidationFactor.sub(liquidationFactorClass1);
    }
}
