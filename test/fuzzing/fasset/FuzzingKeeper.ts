import { time } from "@openzeppelin/test-helpers";
import { EvmEventArgs } from "../../../lib/utils/events/IEvmEvents";
import { expectErrors } from "../../../lib/utils/helpers";
import { MintingExecuted } from "../../../typechain-truffle/IIAssetManager";
import { FuzzingActor } from "./FuzzingActor";
import { FuzzingRunner } from "./FuzzingRunner";
import { FuzzingAgentState } from "./FuzzingAgentState";

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
        // check for liquidations when prices change
        this.state.pricesUpdated.subscribe(() => this.checkAllAgentsForLiquidation());
        // also check for liquidation after every minting
        this.assetManagerEvent('MintingExecuted').subscribe(args => this.handleMintingExecuted(args));
    }

    async checkAllAgentsForLiquidation() {
        for (const agent of this.state.agents.values()) {
            await this.checkAgentForLiquidation(agent)
                .catch(e => expectErrors(e, ["cannot stop liquidation"]));
        }
    }

    handleMintingExecuted(args: EvmEventArgs<MintingExecuted>) {
        const agent = this.state.getAgent(args.agentVault);
        if (!agent) {
            this.comment(`Invalid agent address ${args.agentVault}`);
            return;
        }
        this.runner.startThread(async (scope) => {
            await this.checkAgentForLiquidation(agent)
                .catch(e => scope.exitOnExpectedError(e, ["cannot stop liquidation"]));
        })
    }

    private async checkAgentForLiquidation(agent: FuzzingAgentState) {
        const timestamp = await time.latest();
        const newStatus = agent.possibleLiquidationTransition(timestamp);
        if (newStatus > agent.status) {
            await this.context.assetManager.startLiquidation(agent.address, { from: this.address });
        } else if (newStatus < agent.status) {
            await this.context.assetManager.endLiquidation(agent.address, { from: this.address });
        }
    }
}
