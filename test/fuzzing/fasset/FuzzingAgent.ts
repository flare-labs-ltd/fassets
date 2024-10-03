import { AgentStatus } from "../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../lib/fasset/PaymentReference";
import { isVaultCollateral } from "../../../lib/state/CollateralIndexedList";
import { TX_FAILED } from "../../../lib/underlying-chain/interfaces/IBlockChain";
import { EventScope, EventSubscription } from "../../../lib/utils/events/ScopedEvents";
import { EventArgs } from "../../../lib/utils/events/common";
import { requiredEventArgs } from "../../../lib/utils/events/truffle";
import { BN_ZERO, MAX_BIPS, checkedCast, formatBN, minBN, sleep, toBN, toWei } from "../../../lib/utils/helpers";
import { RedemptionRequested } from "../../../typechain-truffle/IIAssetManager";
import { Agent, AgentCreateOptions } from "../../integration/utils/Agent";
import { SparseArray } from "../../utils/SparseMatrix";
import { MockChain } from "../../utils/fasset/MockChain";
import { coinFlip, randomBN, randomChoice, randomInt } from "../../utils/fuzzing-utils";
import { FuzzingActor } from "./FuzzingActor";
import { FuzzingRunner } from "./FuzzingRunner";

export class FuzzingAgent extends FuzzingActor {
    constructor(
        public runner: FuzzingRunner,
        public agent: Agent,
        public ownerManagementAddress: string,
        public ownerUnderlyingAddress: string,
        public creationOptions: AgentCreateOptions,
    ) {
        super(runner);
        this.registerForEvents(agent.agentVault.address);
    }

    get ownerName() {
        return this.formatAddress(this.ownerManagementAddress);
    }

    get ownerWorkAddress() {
        return Agent.getWorkAddress(this.ownerManagementAddress);
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
        return new FuzzingAgent(runner, agent, agent.ownerManagementAddress, ownerUnderlyingAddress, options ?? {});
    }

    unaccountedSpentFreeBalance = new SparseArray();

    freeUnderlyingBalance(agent: Agent) {
        const agentState = this.agentState(agent);
        const unaccountedSpend = this.unaccountedSpentFreeBalance.get(agent.vaultAddress);
        const freeBalance = agentState.freeUnderlyingBalanceUBA.sub(unaccountedSpend);
        if (freeBalance.lt(BN_ZERO)) {
            this.comment(`Free balance negative for ${this.name(agent)}: accounted=${formatBN(agentState.freeUnderlyingBalanceUBA)} unaccounted=${formatBN(unaccountedSpend)}`);
        }
        return freeBalance;
    }

    eventSubscriptions: { [agentVaultAddress: string]: EventSubscription[] } = {};

    registerForEvents(agentVaultAddress: string) {
        this.eventSubscriptions[agentVaultAddress] = [
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

    unregisterEvents(agentVaultAddress: string) {
        for (const subscription of this.eventSubscriptions[agentVaultAddress] ?? []) {
            subscription.unsubscribe();
        }
    }

    capturePerAgentContractEvents(agentName: string) {
        this.runner.interceptor.captureEventsFrom(agentName, this.agent.agentVault, 'AgentVault');
        this.runner.interceptor.captureEventsFrom(`${agentName}_POOL`, this.agent.collateralPool, 'CollateralPool');
        this.runner.interceptor.captureEventsFrom(`${agentName}_LPTOKEN`, this.agent.collateralPoolToken, 'CollateralPoolToken');
    }

    async handleRedemptionRequest(request: EventArgs<RedemptionRequested>) {
        if (!coinFlip(0.8)) return;
        this.runner.startThread(async (scope) => {
            const agent = this.agent;   // save in case it is destroyed and re-created
            const cheatOnPayment = coinFlip(0.2);
            const takeFee = cheatOnPayment ? request.feeUBA.muln(2) : request.feeUBA;   // cheat by taking more fee (so the payment should be considered failed)
            const paymentAmount = request.valueUBA.sub(takeFee);
            const amountToMyself = randomBN(takeFee.add(this.freeUnderlyingBalance(agent)));  // abuse redemption to pay something to the owner via multi-transaction
            this.unaccountedSpentFreeBalance.addTo(agent.vaultAddress, amountToMyself);
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
                    .catch(e => scope.exitOnExpectedError(e, ['Missing event RedemptionDefault']));
                // Error 'Missing event RedemptionDefault' happens when redeemer defaults before confirm
            }
            this.unaccountedSpentFreeBalance.subFrom(agent.vaultAddress, amountToMyself);
        });
    }

    async selfMint(scope: EventScope) {
        const agent = this.agent;   // save in case it is destroyed and re-created
        const agentInfo = await this.context.assetManager.getAgentInfo(agent.vaultAddress);
        const lotSize = this.context.lotSize();
        const lots = randomInt(Number(agentInfo.freeCollateralLots));
        if (this.avoidErrors && lots === 0) return;
        const mintedAmountUBA = toBN(lots).mul(lotSize);
        const poolFeeUBA = mintedAmountUBA.mul(toBN(agentInfo.feeBIPS)).divn(MAX_BIPS).mul(toBN(agentInfo.poolFeeShareBIPS)).divn(MAX_BIPS);
        const mintingUBA = mintedAmountUBA.add(poolFeeUBA);
        // perform payment
        checkedCast(this.context.chain, MockChain).mint(this.ownerUnderlyingAddress, mintingUBA);
        const txHash = await agent.wallet.addTransaction(this.ownerUnderlyingAddress, agent.underlyingAddress, mintingUBA, PaymentReference.selfMint(agent.vaultAddress));
        // wait for finalization
        await this.context.waitForUnderlyingTransactionFinalization(scope, txHash);
        // execute
        const proof = await this.context.attestationProvider.provePayment(txHash, null, agent.underlyingAddress);
        let res = await this.context.assetManager.selfMint(proof, agent.vaultAddress, lots, { from: this.ownerWorkAddress })
            .catch (e => scope.handleExpectedErrors(e, {
                continue: ['not enough free collateral', 'self-mint payment too small'],
                exit: ['self-mint invalid agent status', 'invalid self-mint reference', 'self-mint payment too old', "self-mint not agent's address"],
            }));
        // 'self-mint payment too small' can happen after lot size change
        // 'invalid self-mint reference' can happen if agent is destroyed and re-created
        // 'self-mint payment too old' can happen when agent self-mints quickly after being created (typically when agent is re-created) and there is time skew
        if (res == null) {
            // could not mint because payment too small - just execute self-mint with 0 lots to account for underlying deposit
            res = await this.context.assetManager.selfMint(proof, agent.vaultAddress, 0, { from: this.ownerWorkAddress })
                .catch(e => scope.exitOnExpectedError(e, ['self-mint invalid agent status', 'invalid self-mint reference', 'self-mint payment too old', "self-mint not agent's address"]));
        }
        const args = requiredEventArgs(res, 'MintingExecuted'); // event must happen even for 0 lots
    }

    async selfClose(scope: EventScope) {
        const agent = this.agent;   // save in case agent is destroyed and re-created
        const agentState = this.agentState(agent);
        if (agentState.status !== AgentStatus.NORMAL) return;   // reduce noise in case of (full) liquidation
        const mintedAssets = agentState.mintedUBA;
        if (mintedAssets.isZero()) return;
        const ownersAssets = await this.context.fAsset.balanceOf(this.ownerWorkAddress);
        if (ownersAssets.isZero()) return;
        // TODO: buy fassets
        const amountUBA = randomBN(ownersAssets);
        if (this.avoidErrors && amountUBA.isZero()) return;
        await agent.selfClose(amountUBA)
            .catch(e => scope.exitOnExpectedError(e, ['f-asset balance too low', 'redeem 0 lots']));
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
            for (const collateral of [agentState.vaultCollateral, agentState.poolWNatCollateral]) {
                const balance = agentState.collateralBalance(collateral);
                const price = this.state.prices.get(collateral);
                const trustedPrice = this.state.trustedPrices.get(collateral);
                const totalUBA = agentState.mintedUBA.add(agentState.reservedUBA).add(agentState.redeemingUBA).addn(1000 /* to be > */);
                const totalAsTokenWei = minBN(price.convertUBAToTokenWei(totalUBA), trustedPrice.convertUBAToTokenWei(totalUBA));
                const requiredCR = type === 'liquidation' ? toBN(collateral.safetyMinCollateralRatioBIPS) : toBN(collateral.minCollateralRatioBIPS);
                const requiredCollateral = totalAsTokenWei.mul(requiredCR).divn(MAX_BIPS);
                const requiredTopup = requiredCollateral.sub(balance);
                if (requiredTopup.lte(BN_ZERO)) continue;
                const crBefore = agentState.collateralRatio(collateral);
                if (isVaultCollateral(collateral)) {
                    await agent.depositVaultCollateral(requiredTopup)
                        .catch(e => scope.exitOnExpectedError(e, []));
                } else {
                    await agent.buyCollateralPoolTokens(requiredTopup)
                        .catch(e => scope.exitOnExpectedError(e, []));
                }
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
        const amount = randomBN(this.freeUnderlyingBalance(agent));
        if (amount.isZero()) return;
        // announce
        const announcement = await agent.announceUnderlyingWithdrawal()
            .catch(e => scope.exitOnExpectedError(e, ['announced underlying withdrawal active']));
        if (coinFlip(0.8)) {
            this.comment(`Underlying withdrawal for ${this.name(agent)}: amount=${formatBN(amount)} free=${formatBN(this.freeUnderlyingBalance(agent))}`)
            this.unaccountedSpentFreeBalance.addTo(agent.vaultAddress, amount);
            // perform withdrawal
            const txHash = await agent.performUnderlyingWithdrawal(announcement, amount, this.ownerUnderlyingAddress)
                .catch(e => scope.exitOnExpectedError(e, []));
            // wait for finalization
            await this.context.waitForUnderlyingTransactionFinalization(scope, txHash);
            // confirm
            await agent.confirmUnderlyingWithdrawal(announcement, txHash)
                .catch(e => scope.exitOnExpectedError(e, []));
            this.unaccountedSpentFreeBalance.subFrom(agent.vaultAddress, amount);
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

    destroying: Set<Agent> = new Set();

    async destroyAgent(scope: EventScope) {
        const agent = this.agent;
        // don't destroy the same agent twice
        if (this.destroying.has(agent)) return;
        this.destroying.add(agent);
        //
        this.comment(`Destroying agent ${this.name(agent)}`);
        const agentState = this.agentState(agent);
        // exit available if needed
        if (agentState.publiclyAvailable) {
            const exitAllowedAt = await agent.announceExitAvailable()
                .catch(e => scope.exitOnExpectedError(e, ['Missing event AvailableAgentExitAnnounced']));
            await this.timeline.flareTimestamp(exitAllowedAt).wait(scope);
            await agent.exitAvailable(false)
                .catch(e => scope.handleExpectedErrors(e, { continue: ['agent not available'] }));
        }
        // pull out fees
        const poolFeeBalance = await agent.poolFeeBalance();
        if (poolFeeBalance.gt(BN_ZERO)) {
            await agent.withdrawPoolFees(poolFeeBalance);
            // self-close agent fee fassets
            await agent.selfClose(poolFeeBalance);
        }
        // conditionally wait until all the agent's tickets are redeemed
        const waitForRedemptions = coinFlip(0.9);
        if (waitForRedemptions) {
            this.comment(`Redeeming fAssets backed by ${this.name(agent)} before destroy...`);
            // wait until all the agent's tickets are redeemed
            while (!(agentState.mintedUBA.lte(agentState.dustUBA) && agentState.reservedUBA.isZero() && agentState.redeemingUBA.isZero())) {
                if (this.runner.waitingToFinish) scope.exit();
                await sleep(1000);
            }
            // self-close dust - must buy some fassets
            if (agentState.dustUBA.gt(BN_ZERO)) {
                await this.runner.fAssetMarketplace.buy(scope, this.ownerWorkAddress, agentState.dustUBA)
                    .catch(e => scope.exitOnExpectedError(e, []));
                await agent.selfClose(agentState.dustUBA);
            }
        } else {
            this.comment(`Skipping redemption of fAssets backed by ${this.name(agent)} before destroy`);
        }
        // redeem pool tokens
        const poolTokenBalance = await agent.poolTokenBalance();
        if (poolTokenBalance.gt(BN_ZERO)) {
            while ((await agent.poolTimelockedBalance()).gt(BN_ZERO)) {
                await this.timeline.flareSeconds(toBN(this.context.settings.collateralPoolTokenTimelockSeconds)).then(e => e.wait(scope));
            }
            const { withdrawalAllowedAt } = await agent.announcePoolTokenRedemption(poolTokenBalance);
            await this.timeline.flareTimestamp(withdrawalAllowedAt).wait(scope);
            await agent.redeemCollateralPoolTokens(poolTokenBalance);
        }
        // announce destroy
        const destroyAllowedAt = await agent.announceDestroy()
            .catch(e => scope.exitOnExpectedError(e, [{ error: 'agent still active', when: !waitForRedemptions }]));
        await this.timeline.flareTimestamp(destroyAllowedAt).wait(scope);
        // wait for all other pool token holders to redeem
        const waitForTokenHolderExit = coinFlip(0.5);
        if (waitForTokenHolderExit) {
            this.comment(`Waiting for pool token holders of ${this.name(agent)} to exit before destroy, pool token supply = ${formatBN(agentState.poolTokenBalances.total())}...`);
            while (!agentState.poolTokenBalances.total().isZero()) {
                if (this.runner.waitingToFinish) scope.exit();
                await sleep(1000);
            }
        } else {
            this.comment(`Skipping wait for pool token holders of ${this.name(agent)} to exit before destroy, pool token supply = ${formatBN(agentState.poolTokenBalances.total())}`);
        }
        // destroy agent vault
        await agent.destroy()
            .catch(e => scope.exitOnExpectedError(e, [{ error: 'cannot destroy a pool with issued tokens', when: !waitForTokenHolderExit }]));
        this.unregisterEvents(agent.vaultAddress);
    }

    async destroyAndReenter(scope: EventScope) {
        if (this.destroying.has(this.agent)) return;
        // save old agent's data
        const name = this.name(this.agent);
        const agentState = this.agentState(this.agent);
        // const collateral = agentState.totalCollateralNATWei;
        const createOptions: AgentCreateOptions = {
            ...this.creationOptions,
            vaultCollateralToken: agentState.vaultCollateral.token,
            feeBIPS: agentState.feeBIPS,
            poolFeeShareBIPS: agentState.poolFeeShareBIPS,
            mintingVaultCollateralRatioBIPS: agentState.mintingVaultCollateralRatioBIPS,
            mintingPoolCollateralRatioBIPS: agentState.mintingPoolCollateralRatioBIPS,
            buyFAssetByAgentFactorBIPS: agentState.buyFAssetByAgentFactorBIPS,
            poolExitCollateralRatioBIPS: agentState.poolExitCollateralRatioBIPS,
            poolTopupCollateralRatioBIPS: agentState.poolTopupCollateralRatioBIPS,
            poolTopupTokenPriceFactorBIPS: agentState.poolTopupTokenPriceFactorBIPS,
            identityVerificationType: agentState.identityVerificationType,
        };
        const underlyingAddress = this.agent.underlyingAddress;
        // destroy old agent vault in parallel
        this.runner.startThread((scope) => this.destroyAgent(scope));
        // create the agent again
        this.agent = await Agent.createTest(this.runner.context, this.ownerWorkAddress, underlyingAddress + '*', createOptions);
        this.registerForEvents(this.agent.agentVault.address);
        this.capturePerAgentContractEvents(name + '*');
        await this.agent.depositCollateralsAndMakeAvailable(toWei(10_000_000), toWei(10_000_000));
    }
}
