import { time } from "@openzeppelin/test-helpers";
import { expectErrors, toBN } from "../../utils/helpers";
import { FuzzingActor } from "./FuzzingActor";
import { FuzzingRunner } from "./FuzzingRunner";
import { AgentStatus, FuzzingStateAgent } from "./FuzzingStateAgent";

export class FuzzingLiquidator extends FuzzingActor {
    constructor(
        public runner: FuzzingRunner,
        public address: string,
    ) {
        super(runner);
        this.registerForEvents();
    }

    get name() {
        return this.formatAddress(this.address);
    }
    
    registerForEvents() {
        this.state.pricesUpdated.subscribe(() => this.checkAllAgentsForLiquidation());
    }
    
    async checkAllAgentsForLiquidation() {
        for (const agent of this.state.agents.values()) {
            await this.checkAgentForLiquidation(agent)
                .catch(e => expectErrors(e, []));
        }
    }

    private async checkAgentForLiquidation(agent: FuzzingStateAgent) {
        const cr = agent.collateralRatioBIPS();
        const timestamp = await time.latest();
        const settings = this.state.settings;
        if (agent.status === AgentStatus.NORMAL && cr.lt(toBN(settings.minCollateralRatioBIPS))) {
            await this.context.assetManager.startLiquidation(agent.address, { from: this.address });
        } else if (agent.status === AgentStatus.CCB && cr.lt(toBN(settings.ccbMinCollateralRatioBIPS))) {
            await this.context.assetManager.startLiquidation(agent.address, { from: this.address });
        } else if (agent.status === AgentStatus.CCB && cr.lt(toBN(settings.minCollateralRatioBIPS)) && timestamp.gte(agent.ccbStartTimestamp.add(toBN(settings.ccbTimeSeconds)))) {
            await this.context.assetManager.startLiquidation(agent.address, { from: this.address });
        } else if ((agent.status === AgentStatus.CCB || agent.status === AgentStatus.LIQUIDATION) && cr.gt(toBN(settings.safetyMinCollateralRatioBIPS))) {
            await this.context.assetManager.endLiquidation(agent.address, { from: this.address });
        }
    }
}
