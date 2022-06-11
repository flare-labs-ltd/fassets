import BN from "bn.js";
import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { Agent } from "../../integration/utils/Agent";
import { EventArgs, requiredEventArgs } from "../../utils/events";
import { MockChain } from "../../utils/fasset/MockChain";
import { PaymentReference } from "../../utils/fasset/PaymentReference";
import { coinFlip, randomBN, randomChoice, randomInt } from "../../utils/fuzzing-utils";
import { BN_ZERO, checkedCast, formatBN, latestBlockTimestamp, MAX_BIPS, toBN, toWei } from "../../utils/helpers";
import { FuzzingActor } from "./FuzzingActor";
import { FuzzingRunner } from "./FuzzingRunner";
import { AgentStatus } from "./FuzzingStateAgent";
import { EventScope, EventSubscription } from "../../utils/fasset/ScopedEvents";

export class FuzzingAgent extends FuzzingActor {
    constructor(
        public runner: FuzzingRunner,
        public agent: Agent,
        public ownerAddress: string,
        public ownerUnderlyingAddress: string,
    ) {
        super(runner);
        this.registerForEvents(agent.agentVault.address);
    }
    
    ownerName() {
        return this.formatAddress(this.ownerAddress);
    }
    
    name(agent: Agent) {
        return this.formatAddress(agent.agentVault.address);
    }

    agentState(agent: Agent) {
        return this.state.getAgent(agent.agentVault.address);
    }

    static async createTest(runner: FuzzingRunner, ownerAddress: string, underlyingAddress: string, ownerUnderlyingAddress: string) {
        const agent = await Agent.createTest(runner.context, ownerAddress, underlyingAddress);
        return new FuzzingAgent(runner, agent, ownerAddress, ownerUnderlyingAddress);
    }

    eventSubscriptions: EventSubscription[] = [];
    
    registerForEvents(agentVaultAddress: string) {
        this.eventSubscriptions = [
            this.runner.assetManagerEvent('RedemptionRequested', { agentVault: agentVaultAddress })
                .subscribe((args) => this.handleRedemptionRequest(args)),
            this.runner.assetManagerEvent('AgentInCCB', { agentVault: agentVaultAddress })
                .subscribe((args) => this.topupCollateral('ccb', args.timestamp)),
            this.runner.assetManagerEvent('LiquidationStarted', { agentVault: agentVaultAddress })
                .subscribe((args) => this.topupCollateral('liquidation', args.timestamp)),
            // handle all possible full liquidation ends: Redemption*???, LiquidationPerformed, SelfClose
            this.runner.assetManagerEvent('RedemptionFinished', { agentVault: agentVaultAddress })
                .subscribe((args) => this.checkForFullLiquidationEnd()),
            this.runner.assetManagerEvent('RedemptionDefault', { agentVault: agentVaultAddress })
                .subscribe((args) => this.checkForFullLiquidationEnd()),
            this.runner.assetManagerEvent('LiquidationPerformed', { agentVault: agentVaultAddress })
                .subscribe((args) => this.checkForFullLiquidationEnd()),
            this.runner.assetManagerEvent('SelfClose', { agentVault: agentVaultAddress })
                .subscribe((args) => this.checkForFullLiquidationEnd()),
        ];
    }
    
    unregisterEvents() {
        for (const subscription of this.eventSubscriptions) {
            subscription.unsubscribe();
        }
    }

    async handleRedemptionRequest(request: EventArgs<RedemptionRequested>) {
        if (!coinFlip(0.8)) return;
        this.runner.startThread(async (scope) => {
            const agent = this.agent;   // save in case it is destroyed and re-created
            const cheatOnPayment = coinFlip(0.2);
            if (cheatOnPayment) {
                request = { ...request, feeUBA: request.feeUBA.muln(2) };   // pay less by taking some extra fee
            }
            const txHash = await agent.performRedemptionPayment(request);
            await this.context.waitForUnderlyingTransactionFinalization(scope, txHash);
            if (!cheatOnPayment) {
                await agent.confirmActiveRedemptionPayment(request, txHash)
                    .catch(e => scope.exitOnExpectedError(e, []));
            } else {
                await agent.confirmFailedRedemptionPayment(request, txHash)
                    .catch(e => scope.exitOnExpectedError(e, ['Missing event RedemptionPaymentFailed']));
                // Error 'Missing event RedemptionPaymentFailed' happens when redeemer defaults before confirm
            }
        });
    }
    
    async selfMint(scope: EventScope) {
        const agent = this.agent;   // save in case it is destroyed and re-created
        const agentInfo = await this.context.assetManager.getAgentInfo(agent.vaultAddress);
        const lotSize = await this.context.lotsSize();
        const lots = randomInt(Number(agentInfo.freeCollateralLots));
        if (this.avoidErrors && lots === 0) return;
        const miningUBA = toBN(lots).mul(lotSize);
        checkedCast(this.context.chain, MockChain).mint(this.ownerUnderlyingAddress, miningUBA);
        // perform payment
        const txHash = await agent.wallet.addTransaction(this.ownerUnderlyingAddress, agent.underlyingAddress, miningUBA, PaymentReference.selfMint(agent.vaultAddress));
        // wait for finalization
        await this.context.waitForUnderlyingTransactionFinalization(scope, txHash);
        // execute
        const proof = await this.context.attestationProvider.provePayment(txHash, null, agent.underlyingAddress);
        const res = await this.context.assetManager.selfMint(proof, agent.vaultAddress, lots, { from: this.ownerAddress })
            .catch(e => scope.exitOnExpectedError(e, ['cannot mint 0 lots', 'not enough free collateral', 'self-mint payment too small', 'self-mint invalid agent status', 'invalid self-mint reference']));
        // 'self-mint payment too small' can happen after lot size change
        // 'invalid self-mint reference' can happen if agent is destroyed and re-created
        const args = requiredEventArgs(res, 'MintingExecuted');
        // TODO: accounting?
    }
    
    async selfClose(scope: EventScope) {
        const agent = this.agent;   // save in case agent is destroyed and re-created
        const agentState = this.agentState(agent);
        if (agentState.status !== AgentStatus.NORMAL) return;   // reduce noise in case of (full) liquidation
        const mintedAssets = agentState.mintedUBA;
        if (mintedAssets.isZero()) return;
        const ownersAssets = await this.context.fAsset.balanceOf(this.ownerAddress);
        if (ownersAssets.isZero()) return;
        // TODO: buy fassets
        const amountUBA = randomBN(ownersAssets);
        if (this.avoidErrors && amountUBA.isZero()) return;
        await agent.selfClose(amountUBA)
            .catch(e => scope.exitOnExpectedError(e, ['Burn too big for owner', 'redeem 0 lots']));
    }

    async convertDustToTicket(scope: EventScope): Promise<void> {
        const agent = this.agent;   // save in case agent is destroyed and re-created
        await this.context.assetManager.convertDustToTicket(agent.vaultAddress)
            .catch(e => scope.exitOnExpectedError(e, []));
    }

    topupCollateral(type: 'ccb' | 'liquidation', timestamp: BN) {
        if (!coinFlip(0.5)) {
            this.runner.comment(`Ignoring topup request for ${this.name(this.agent)}`);
            return;
        }
        this.runner.startThread(async (scope) => {
            const agent = this.agent;   // save in case it is destroyed and re-created
            const collateral = await this.context.wnat.balanceOf(agent.agentVault.address);
            const [amgToNATWeiPrice, amgToNATWeiPriceTrusted] = await this.context.currentAmgToNATWeiPriceWithTrusted();
            const amgToNATWei = BN.min(amgToNATWeiPrice, amgToNATWeiPriceTrusted);
            const agentState = this.agentState(agent);
            const totalUBA = agentState.mintedUBA.add(agentState.reservedUBA).add(agentState.redeemingUBA).addn(1000 /* to be > */);
            const requiredCR = type === 'liquidation' ? toBN(this.state.settings.safetyMinCollateralRatioBIPS) : toBN(this.state.settings.minCollateralRatioBIPS);
            const requredCollateral = this.context.convertUBAToNATWei(totalUBA, amgToNATWei).mul(requiredCR).divn(MAX_BIPS);
            const requiredTopup = requredCollateral.sub(collateral);
            if (requiredTopup.lte(BN_ZERO)) {
                this.runner.comment(`Too late for topup for ${this.name(agent)}`);
                return; // perhaps we were liquidated already
            }
            const crBefore = agentState.collateralRatio();
            await agent.agentVault.deposit({ value: requiredTopup })
                .catch(e => scope.exitOnExpectedError(e, []));
            const crAfter = agentState.collateralRatio();
            this.runner.comment(`Topped up ${this.name(agent)} by ${formatBN(requiredTopup)}  crBefore=${crBefore.toFixed(3)}  crAfter=${crAfter.toFixed(3)}`);
        });
    }
    
    async announcedUnderlyingWithdrawal(scope: EventScope) {
        const agent = this.agent;   // save in case agent is destroyed and re-created
        const agentState = this.agentState(agent);
        if (agentState.status !== AgentStatus.NORMAL) return;   // reduce noise in case of (full) liquidation
        const amount = randomBN(agentState.freeUnderlyingBalanceUBA);
        if (amount.isZero()) return;
        // announce
        const announcement = await agent.announceUnderlyingWithdrawal()
            .catch(e => scope.exitOnExpectedError(e, ['announced underlying withdrawal active']));
        if (coinFlip(0.8)) {
            // perform withdrawal
            const txHash = await agent.performUnderlyingWithdrawal(announcement, amount, this.ownerUnderlyingAddress)
                .catch(e => scope.exitOnExpectedError(e, []));
            // wait for finalization
            await this.context.waitForUnderlyingTransactionFinalization(scope, txHash);
            // confirm
            await agent.confirmUnderlyingWithdrawal(announcement, txHash)
                .catch(e => scope.exitOnExpectedError(e, []));
        } else {
            // cancel withdrawal
            await agent.cancelUnderlyingWithdrawal(announcement)
                .catch(e => scope.exitOnExpectedError(e, []));
        }
    }

    async makeIllegalTransaction(scope: EventScope): Promise<void> {
        const agent = this.agent;   // save in case it is destroyed and re-created
        const balance = await this.context.chain.getBalance(agent.underlyingAddress);
        if (balance.isZero()) return;
        const amount = randomBN(balance);
        this.comment(`Making illegal transaction of ${formatBN(amount)} from ${agent.underlyingAddress}`);
        await agent.wallet.addTransaction(agent.underlyingAddress, this.ownerUnderlyingAddress, amount, null);
    }

    async makeDoublePayment(scope: EventScope): Promise<void> {
        const agent = this.agent;   // save in case it is destroyed and re-created
        const agentState = this.agentState(agent);
        const redemptions = Array.from(agentState.redemptionRequests.values());
        if (redemptions.length === 0) return;
        const redemption = randomChoice(redemptions);
        const amount = redemption.valueUBA;
        this.comment(`Making double payment of ${formatBN(amount)} from ${agent.underlyingAddress}`);
        await agent.wallet.addTransaction(agent.underlyingAddress, this.ownerUnderlyingAddress, amount, redemption.paymentReference);
    }
    
    checkForFullLiquidationEnd(): void {
        const agentState = this.agentState(this.agent);
        if (agentState.status !== AgentStatus.FULL_LIQUIDATION) return;
        if (agentState.mintedUBA.gt(BN_ZERO) || agentState.reservedUBA.gt(BN_ZERO) || agentState.redeemingUBA.gt(BN_ZERO)) return;
        this.runner.startThread((scope) => this.destroyAndReenter(scope));
    }
    
    destroying: boolean = false;
    
    async destroyAgent(scope: EventScope) {
        if (this.destroying) return;
        if (this.avoidErrors) {
            this.destroying = true;
        }
        this.comment(`Destroying agent ${this.name(this.agent)}`);
        const agentState = this.agentState(this.agent);
        if (agentState.publiclyAvailable) {
            await this.agent.exitAvailable()
                .catch(e => scope.exitOnExpectedError(e, ['agent not available']));
        }
        await this.agent.announceDestroy();
        const timestamp = await latestBlockTimestamp();
        const waitTime = Number(this.state.settings.withdrawalWaitMinSeconds);
        await this.timeline.flareTimestamp(timestamp + waitTime).wait(scope);
        await this.agent.destroy();
        this.unregisterEvents();
    }
    
    async destroyAndReenter(scope: EventScope) {
        if (this.destroying) return;
        if (this.avoidErrors) {
            this.destroying = true;
        }
        // save old agent's data
        const name = this.name(this.agent);
        const agentState = this.agentState(this.agent);
        // const collateral = agentState.totalCollateralNATWei;
        const feeBIPS = agentState.feeBIPS;
        const agentMinCollateralRatioBIPS = agentState.agentMinCollateralRatioBIPS;
        const underlyingAddress = this.agent.underlyingAddress;
        // destroy old agent vault
        await this.destroyAgent(scope);
        // create the agent again
        this.agent = await Agent.createTest(this.runner.context, this.ownerAddress, underlyingAddress + '*');
        this.registerForEvents(this.agent.agentVault.address);
        this.runner.interceptor.captureEventsFrom(name + '*', this.agent.agentVault, 'AgentVault');
        await this.agent.agentVault.deposit({ from: this.ownerAddress, value: toWei(10_000_000) });
        await this.agent.makeAvailable(feeBIPS, agentMinCollateralRatioBIPS);
        // make all working again
        this.destroying = false;
    }
}
