import { time } from "@openzeppelin/test-helpers";
import { expectErrors } from "../../utils/helpers";
import { FuzzingActor } from "./FuzzingActor";
import { FuzzingRunner } from "./FuzzingRunner";
import { FuzzingStateAgent } from "./FuzzingStateAgent";

export class FuzzingKeeper extends FuzzingActor {
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
        // also check for liquidation after every minting
        for (const agent of this.state.agents.values()) {
            this.assetManagerEvent('MintingExecuted', { agentVault: agent.address })
                .subscribe(() => this.checkAgentForLiquidation(agent));
        }
    }
    
    async checkAllAgentsForLiquidation() {
        for (const agent of this.state.agents.values()) {
            await this.checkAgentForLiquidation(agent)
                .catch(e => expectErrors(e, []));
        }
    }

    private async checkAgentForLiquidation(agent: FuzzingStateAgent) {
        const timestamp = await time.latest();
        const newStatus = agent.possibleLiquidationTransition(timestamp);
        if (newStatus > agent.status) {
            await this.context.assetManager.startLiquidation(agent.address, { from: this.address });
        } else if (newStatus < agent.status) {
            await this.context.assetManager.endLiquidation(agent.address, { from: this.address });
        }
    }
}
