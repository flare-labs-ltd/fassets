import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { Agent } from "../../integration/utils/Agent";
import { EventArgs, requiredEventArgs } from "../../utils/events";
import { MockChain } from "../../utils/fasset/MockChain";
import { PaymentReference } from "../../utils/fasset/PaymentReference";
import { coinFlip, randomBN, randomInt } from "../../utils/fuzzing-utils";
import { checkedCast, toBN } from "../../utils/helpers";
import { FuzzingActor } from "./FuzzingActor";
import { FuzzingRunner } from "./FuzzingRunner";
import { EventScope } from "./ScopedEvents";

export class FuzzingAgent extends FuzzingActor {
    constructor(
        public runner: FuzzingRunner,
        public agent: Agent,
    ) {
        super(runner);
        this.registerForEvents();
    }
    
    agentVault = this.agent.agentVault;
    underlyingAddress = this.agent.underlyingAddress;
    ownerAddress = this.agent.ownerAddress;
    
    name = this.formatAddress(this.ownerAddress);
    
    get trackedAgentState() {
        return this.runner.state.getAgent(this.agentVault.address);
    }

    static async createTest(runner: FuzzingRunner, ownerAddress: string, underlyingAddress: string) {
        const agent = await Agent.createTest(runner.context, ownerAddress, underlyingAddress);
        return new FuzzingAgent(runner, agent);
    }

    registerForEvents() {
        this.runner.assetManagerEvent('RedemptionRequested', { agentVault: this.agentVault.address })
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
    
    async selfMint(scope: EventScope) {
        const agentInfo = await this.context.assetManager.getAgentInfo(this.agentVault.address);
        const lotSize = await this.context.lotsSize();
        const lots = randomInt(Number(agentInfo.freeCollateralLots));
        if (this.avoidErrors && lots === 0) return;
        const miningUBA = toBN(lots).mul(lotSize);
        const ownerUnderlyingAddress = "owner_" + this.underlyingAddress;
        checkedCast(this.context.chain, MockChain).mint(ownerUnderlyingAddress, miningUBA);
        // perform payment
        const txHash = await this.agent.wallet.addTransaction(ownerUnderlyingAddress, this.underlyingAddress, miningUBA, PaymentReference.selfMint(this.agentVault.address));
        // wait for finalization
        await this.waitForUnderlyingTransactionFinalization(scope, txHash);
        // execute
        const proof = await this.context.attestationProvider.provePayment(txHash, null, this.underlyingAddress);
        const res = await this.context.assetManager.selfMint(proof, this.agentVault.address, lots, { from: this.ownerAddress })
            .catch(e => scope.exitOnExpectedError(e, ['cannot mint 0 lots', 'not enough free collateral', 'self-mint payment too small', 'self-mint invalid agent status']));
        // 'self-mint payment too small' can happen after lot size change
        const args = requiredEventArgs(res, 'MintingExecuted');
        // TODO: accounting?
    }
    
    async selfClose(scope: EventScope) {
        const ownersAssets = await this.context.fAsset.balanceOf(this.ownerAddress);
        if ( ownersAssets.isZero()) return;
        // TODO: buy fassets
        const amountUBA = randomBN(ownersAssets);
        if (this.avoidErrors && amountUBA.isZero()) return;
        await this.agent.selfClose(amountUBA)
            .catch(e => scope.exitOnExpectedError(e, ['Burn too big for owner', 'redeem 0 lots']));
    }

    async convertDustToTickets(scope: EventScope): Promise<void> {
        await this.context.assetManager.convertDustToTickets(this.agentVault.address)
            .catch(e => scope.exitOnExpectedError(e, []));
    }
}
