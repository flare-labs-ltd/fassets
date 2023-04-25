import { AgentStatus } from "../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../lib/fasset/PaymentReference";
import { tokenContract } from "../../../lib/state/TokenPrice";
import { TX_FAILED } from "../../../lib/underlying-chain/interfaces/IBlockChain";
import { EventScope, EventSubscription } from "../../../lib/utils/events/ScopedEvents";
import { EventArgs } from "../../../lib/utils/events/common";
import { requiredEventArgs } from "../../../lib/utils/events/truffle";
import { BN_ZERO, MAX_BIPS, checkedCast, formatBN, minBN, toBN, toWei } from "../../../lib/utils/helpers";
import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { Agent, AgentCreateOptions } from "../../integration/utils/Agent";
import { MockChain } from "../../utils/fasset/MockChain";
import { coinFlip, randomBN, randomChoice, randomInt } from "../../utils/fuzzing-utils";
import { FuzzingActor } from "./FuzzingActor";
import { FuzzingRunner } from "./FuzzingRunner";

export class FuzzingAgent extends FuzzingActor {
    constructor(
        public runner: FuzzingRunner,
        public agent: Agent,
        public ownerAddress: string,
        public ownerUnderlyingAddress: string,
        public creationOptions: AgentCreateOptions,
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
        const address = agent.agentVault.address;
        return this.state.getAgent(address) ?? assert.fail(`Invalid agent address ${address}`);
    }

    static async createTest(runner: FuzzingRunner, ownerAddress: string, underlyingAddress: string, ownerUnderlyingAddress: string, options?: AgentCreateOptions) {
        const agent = await Agent.createTest(runner.context, ownerAddress, underlyingAddress, options);
        return new FuzzingAgent(runner, agent, ownerAddress, ownerUnderlyingAddress, options ?? {});
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
            this.runner.assetManagerEvent('RedemptionPerformed', { agentVault: agentVaultAddress })
                .subscribe((args) => this.checkForFullLiquidationEnd()),
            this.runner.assetManagerEvent('RedemptionPaymentFailed', { agentVault: agentVaultAddress })
                .subscribe((args) => this.checkForFullLiquidationEnd()),
            this.runner.assetManagerEvent('RedemptionPaymentBlocked', { agentVault: agentVaultAddress })
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
            const takeFee = cheatOnPayment ? request.feeUBA.muln(2) : request.feeUBA;   // cheat by taking more fee (so the payment should be considered failed)
            const paymentAmount = request.valueUBA.sub(takeFee);
            const amountToMyself = randomBN(takeFee.add(this.agentState(agent).freeUnderlyingBalanceUBA));  // abuse redemption to pay something to the owner via multi-transaction
            const txHash = await agent.wallet.addMultiTransaction({ [agent.underlyingAddress]: paymentAmount.add(amountToMyself) },
                { [request.paymentAddress]: paymentAmount, [this.ownerUnderlyingAddress]: amountToMyself },
                request.paymentReference);
            const transaction = await this.context.waitForUnderlyingTransactionFinalization(scope, txHash);
            assert.isTrue(transaction == null || transaction.hash === txHash);
            if (!cheatOnPayment && transaction && transaction.status !== TX_FAILED) {
                await agent.confirmActiveRedemptionPayment(request, txHash)
                    .catch(e => scope.exitOnExpectedError(e, ['Missing event RedemptionPerformed']));
                // Error 'Missing event RedemptionPerformed' happens when payment is too late or transaction is failed
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
        const lotSize = this.context.lotSize();
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
            .catch(e => scope.exitOnExpectedError(e, ['cannot mint 0 lots', 'not enough free collateral', 'self-mint payment too small',
                'self-mint invalid agent status', 'invalid self-mint reference', 'self-mint payment too old']));
        // 'self-mint payment too small' can happen after lot size change
        // 'invalid self-mint reference' can happen if agent is destroyed and re-created
        // 'self-mint payment too old' can happen when agent self-mints quickly after being created (typically when agent is re-created) and there is time skew
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
            const agentState = this.agentState(agent);
            const topups: string[] = [];
            for (const collateral of [agentState.class1Collateral, agentState.poolWNatCollateral]) {
                const collateralToken = await tokenContract(collateral.token);
                const balance = await collateralToken.balanceOf(agent.agentVault.address);
                const price = await this.context.getCollateralPrice(collateral, false);
                const trustedPrice = await this.context.getCollateralPrice(collateral, true);
                const totalUBA = agentState.mintedUBA.add(agentState.reservedUBA).add(agentState.redeemingUBA).addn(1000 /* to be > */);
                const totalAsTokenWei = minBN(price.convertUBAToTokenWei(totalUBA), trustedPrice.convertUBAToTokenWei(totalUBA));
                const requiredCR = type === 'liquidation' ? toBN(collateral.safetyMinCollateralRatioBIPS) : toBN(collateral.minCollateralRatioBIPS);
                const requiredCollateral = totalAsTokenWei.mul(requiredCR).divn(MAX_BIPS);
                const requiredTopup = requiredCollateral.sub(balance);
                if (requiredTopup.lte(BN_ZERO)) continue;
                const crBefore = agentState.collateralRatio(collateral);
                await collateralToken.approve(agent.agentVault.address, requiredTopup, { from: this.ownerAddress })
                    .catch(e => scope.exitOnExpectedError(e, []));
                await agent.agentVault.depositCollateral(collateralToken.address, requiredTopup, { from: this.ownerAddress })
                    .catch(e => scope.exitOnExpectedError(e, []));
                const crAfter = agentState.collateralRatio(collateral);
                topups.push(`Topped up ${this.name(agent)} by ${formatBN(requiredTopup)} ${this.context.tokenName(collateral.token)}  crBefore=${crBefore.toFixed(3)}  crAfter=${crAfter.toFixed(3)}`);
            }
            if (topups.length > 0) {
                topups.forEach(topup => this.runner.comment(topup));
            } else {
                this.runner.comment(`Too late for topup for ${this.name(agent)}`);
            }
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
            // wait
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
        const agentState = this.agentState(this.agent);
        if (this.destroying) return;
        if (this.avoidErrors) {
            this.destroying = true;
        }
        this.comment(`Destroying agent ${this.name(this.agent)}`);
        // exit available if needed
        if (agentState.publiclyAvailable) {
            const exitAllowedAt = await this.agent.announceExitAvailable();
            await this.timeline.flareTimestamp(exitAllowedAt).wait(scope);
            await this.agent.exitAvailable()
                .catch(e => scope.exitOnExpectedError(e, ['agent not available']));
        }
        // pull out fees
        const poolFeeBalance = await this.agent.poolFeeBalance();
        await this.agent.withdrawPoolFees(poolFeeBalance);
        // TODO: somehow self-close all backed f-assets
        await this.agent.selfClose(poolFeeBalance);
        // redeem pool tokens
        // TODO: all other pool token holders must also redeem
        const poolTokenBalance = await this.agent.poolTokenBalance();
        const { withdrawalAllowedAt } = await this.agent.announcePoolTokenRedemption(poolTokenBalance);
        await this.timeline.flareTimestamp(withdrawalAllowedAt).wait(scope);
        await this.agent.redeemCollateralPoolTokens(poolTokenBalance);
        // destroy agent vault
        const destroyAllowedAt = await this.agent.announceDestroy();
        await this.timeline.flareTimestamp(destroyAllowedAt).wait(scope);
        await this.agent.destroy();
        this.unregisterEvents();
    }

    async destroyAndReenter(scope: EventScope) {
        // save old agent's data
        const name = this.name(this.agent);
        const agentState = this.agentState(this.agent);
        // start destroying
        if (this.destroying) return;
        if (this.avoidErrors) {
            this.destroying = true;
        }
        // const collateral = agentState.totalCollateralNATWei;
        const createOptions: AgentCreateOptions = {
            ...this.creationOptions,
            class1CollateralToken: agentState.class1Collateral.token,
            feeBIPS: agentState.feeBIPS,
            poolFeeShareBIPS: agentState.poolFeeShareBIPS,
            mintingClass1CollateralRatioBIPS: agentState.mintingClass1CollateralRatioBIPS,
            mintingPoolCollateralRatioBIPS: agentState.mintingPoolCollateralRatioBIPS,
            buyFAssetByAgentFactorBIPS: agentState.buyFAssetByAgentFactorBIPS,
            poolExitCollateralRatioBIPS: agentState.poolExitCollateralRatioBIPS,
            poolTopupCollateralRatioBIPS: agentState.poolTopupCollateralRatioBIPS,
            poolTopupTokenPriceFactorBIPS: agentState.poolTopupTokenPriceFactorBIPS,
        };
        const underlyingAddress = this.agent.underlyingAddress;
        // destroy old agent vault
        await this.destroyAgent(scope);
        // create the agent again
        this.agent = await Agent.createTest(this.runner.context, this.ownerAddress, underlyingAddress + '*', createOptions);
        this.registerForEvents(this.agent.agentVault.address);
        this.runner.interceptor.captureEventsFrom(name + '*', this.agent.agentVault, 'AgentVault');
        await this.agent.depositCollateralsAndMakeAvailable(toWei(10_000_000), toWei(10_000_000));
        // make all working again
        this.destroying = false;
    }
}
