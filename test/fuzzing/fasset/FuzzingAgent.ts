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
                const cheatOnPayment = coinFlip(0.2);
                if (cheatOnPayment) {
                    request = { ...request, feeUBA: request.feeUBA.muln(2) };   // pay less by taking some extra fee
                }
                const txHash = await this.agent.performRedemptionPayment(request);
                await this.waitForUnderlyingTransactionFinalization(scope, txHash);
                if (!cheatOnPayment) {
                    await this.agent.confirmActiveRedemptionPayment(request, txHash);
                } else {
                    await this.agent.confirmFailedRedemptionPayment(request, txHash)
                        .catch(e => scope.exitOnExpectedError(e, ['Missing event RedemptionPaymentFailed']));
                    // Error 'Missing event RedemptionPaymentFailed' happens when redeemer defaults before confirm
                }
            });
        }
    }
}
