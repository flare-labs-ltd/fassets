import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { Agent } from "../../integration/utils/Agent";
import { EventArgs } from "../../utils/events";
import { coinFlip } from "../../utils/fuzzing-utils";
import { FuzzingActor } from "./FuzzingActor";
import { FuzzingRunner } from "./FuzzingRunner";

export class FuzzingAgent extends FuzzingActor {
    constructor(
        public runner: FuzzingRunner,
        public agent: Agent,
    ) {
        super(runner);
        this.registerForEvents();
    }
    
    name = this.formatAddress(this.agent.ownerAddress);

    static async createTest(runner: FuzzingRunner, ownerAddress: string, underlyingAddress: string) {
        const agent = await Agent.createTest(runner.context, ownerAddress, underlyingAddress);
        return new FuzzingAgent(runner, agent);
    }

    registerForEvents() {
        this.runner.assetManagerEvent('RedemptionRequested', { agentVault: this.agent.vaultAddress })
            .subscribe((args) => this.handleRedemptionRequest(args));
    }

    async handleRedemptionRequest(request: EventArgs<RedemptionRequested>) {
        if (coinFlip(0.8)) {
            this.runner.startThread(async (scope) => {
                const txHash = await this.agent.performRedemptionPayment(request);
                await this.agent.confirmActiveRedemptionPayment(request, txHash);
            });
        }
    }
}
