import { LiquidationCancelled, LiquidationStarted } from "../../../typechain-truffle/AssetManager";
import { EventArgs, eventArgs, filterEvents, requiredEventArgs } from "../../utils/events";
import { BNish, BN_ZERO, toBN } from "../../utils/helpers";
import { Agent } from "./Agent";
import { AssetContext, AssetContextClient } from "./AssetContext";

const AgentVault = artifacts.require('AgentVault');

export class Liquidator extends AssetContextClient {
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
        const liquidationStarted = requiredEventArgs(res, 'LiquidationStarted');
        assert.equal(liquidationStarted.agentVault, agent.agentVault.address);
        assert.isFalse(liquidationStarted.fullLiquidation);
        const tr = await web3.eth.getTransaction(res.tx);
        const block = await web3.eth.getBlock(tr.blockHash!);
        return [liquidationStarted.collateralCallBand, block.timestamp];
    }

    async liquidate(agent: Agent, amountUBA: BNish): Promise<[liquidatedValueUBA: BN, blockTimestamp: BNish, liquidationStarted: EventArgs<LiquidationStarted>, liquidationCancelled: EventArgs<LiquidationCancelled>, dustChangesUBA: BN[]]> {
        const res = await this.assetManager.liquidate(agent.agentVault.address, amountUBA, { from: this.address });
        const liquidationPerformed = requiredEventArgs(res, 'LiquidationPerformed');
        const dustChangedEvents = filterEvents(res.logs, 'DustChanged').map(e => e.args);
        assert.equal(liquidationPerformed.agentVault, agent.agentVault.address);
        assert.equal(liquidationPerformed.liquidator, this.address);
        const tr = await web3.eth.getTransaction(res.tx);
        const block = await web3.eth.getBlock(tr.blockHash!);
        return [liquidationPerformed.valueUBA, block.timestamp, eventArgs(res, 'LiquidationStarted'), eventArgs(res, 'LiquidationCancelled'), dustChangedEvents.map(dc => dc.dustUBA)];
    }

    async endLiquidation(agent: Agent) {
        const res = await this.assetManager.endLiquidation(agent.agentVault.address, { from: this.address });
        assert.equal(requiredEventArgs(res, 'LiquidationCancelled').agentVault, agent.agentVault.address);
    }

    async getLiquidationReward(liquidatedAmountUBA: BNish, factorBIPS: BNish) {
        const amgToNATWeiPrice = await this.context.currentAmgToNATWeiPrice();
        const liquidatedAmountAMG = this.context.convertUBAToAmg(liquidatedAmountUBA);
        return this.context.convertAmgToNATWei(toBN(liquidatedAmountAMG).mul(toBN(factorBIPS)).divn(10_000), amgToNATWeiPrice);
    }

    async getLiquidationFactorBIPS(collateralRatioBIPS: BNish, liquidationStartedAt: BNish, liquidationPerformedAt: BNish, ccb: boolean = false) {
        // calculate premium step based on time since liquidation started
        const settings = await this.assetManager.getSettings();
        const ccbTime = ccb ? toBN(settings.ccbTimeSeconds) : BN_ZERO;
        const liquidationStart = toBN(liquidationStartedAt).add(ccbTime);
        const startTs = toBN(liquidationPerformedAt);
        const step = Math.min(settings.liquidationCollateralFactorBIPS.length - 1,
            startTs.sub(liquidationStart).div(toBN(settings.liquidationStepSeconds)).toNumber());
        // premiums are expressed as percentage of minCollateralRatio
        const factorBIPS = toBN(settings.liquidationCollateralFactorBIPS[step]);
        // max premium is equal to agents collateral ratio (so that all liquidators get at least this much)
        return factorBIPS.lt(toBN(collateralRatioBIPS)) ? factorBIPS : toBN(collateralRatioBIPS);
    }
}
