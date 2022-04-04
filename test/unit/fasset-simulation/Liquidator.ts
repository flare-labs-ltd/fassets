import { AgentVaultInstance } from "../../../typechain-truffle";
import { AllowedPaymentAnnounced, DustChanged, RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { eventArgs, EventArgs, filterEvents, findEvent, findRequiredEvent, requiredEventArgs } from "../../utils/events";
import { PaymentReference } from "../../utils/fasset/PaymentReference";
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
    
    async startLiquidation(agent: Agent) {
        const res = await this.assetManager.startLiquidation(agent.agentVault.address, { from: this.address });
        const liquidationStarted = requiredEventArgs(res, 'LiquidationStarted');
        assert.equal(liquidationStarted.agentVault, agent.agentVault.address);
        assert.isFalse(liquidationStarted.fullLiquidation);
        return liquidationStarted.collateralCallBand;
    }

    async liquidate(agent: Agent, amountUBA: BNish) {
        const res = await this.assetManager.liquidate(agent.agentVault.address, amountUBA, { from: this.address });
        const liquidationPerformed = requiredEventArgs(res, 'LiquidationPerformed');
        assert.equal(liquidationPerformed.agentVault, agent.agentVault.address);
        assert.equal(liquidationPerformed.liquidator, this.address);
        return liquidationPerformed.valueUBA;
    }

    async cancelLiquidation(agent: Agent) {
        const res = await this.assetManager.cancelLiquidation(agent.agentVault.address, { from: this.address });
        assert.equal(requiredEventArgs(res, 'LiquidationCancelled').agentVault, agent.agentVault.address);
    }

    async getLiquidationReward(liquidatedAmountAMG: BNish, factorBIPS: BNish) {
        const amgToNATWeiPrice = await this.context.currentAmgToNATWeiPrice();
        return this.context.convertAmgToNATWei(toBN(liquidatedAmountAMG).mul(toBN(factorBIPS)).divn(10_000), amgToNATWeiPrice);
    }

    async getLiquidationFactorBIPS(collateralRatioBIPS: BNish, liquidationStartedAt: BNish, ccb: boolean = false) {
        // calculate premium step based on time since liquidation started
        const settings = await this.assetManager.getSettings();
        const ccbTime = ccb ? settings.ccbTimeSeconds : BN_ZERO;
        const liquidationStart = toBN(liquidationStartedAt).add(ccbTime);
        let currentBlock = await web3.eth.getBlock(await web3.eth.getBlockNumber());
        const startTs = toBN(currentBlock.timestamp);
        const step = Math.min(settings.liquidationCollateralFactorBIPS.length - 1,
            startTs.sub(liquidationStart).div(toBN(settings.liquidationStepSeconds)).toNumber());
        // premiums are expressed as percentage of minCollateralRatio
        const factorBIPS = toBN(settings.liquidationCollateralFactorBIPS[step]);
        // max premium is equal to agents collateral ratio (so that all liquidators get at least this much)
        return factorBIPS.lt(toBN(collateralRatioBIPS)) ? factorBIPS : toBN(collateralRatioBIPS);
    }

    async getChallengerReward(backingAMGAtChallenge: BNish) {
        return toBN(this.context.settings.paymentChallengeRewardNATWei)
            .add(
                this.context.convertAmgToNATWei(
                    toBN(backingAMGAtChallenge)
                    .mul(toBN(this.context.settings.paymentChallengeRewardBIPS))
                    .divn(10_000),
                    await this.context.currentAmgToNATWeiPrice()
                )
            );
    }
}
