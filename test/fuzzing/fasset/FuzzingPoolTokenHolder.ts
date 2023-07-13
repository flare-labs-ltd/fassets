import { EventScope } from "../../../lib/utils/events/ScopedEvents";
import { formatBN, requireNotNull } from "../../../lib/utils/helpers";
import { CollateralPoolInstance, CollateralPoolTokenInstance } from "../../../typechain-truffle";
import { AsyncLock, coinFlip, randomBN, randomChoice } from "../../utils/fuzzing-utils";
import { FuzzingActor } from "./FuzzingActor";
import { RedemptionPaymentReceiver } from "./FuzzingCustomer";
import { FuzzingRunner } from "./FuzzingRunner";

enum TokenExitType { MAXIMIZE_FEE_WITHDRAWAL, MINIMIZE_FEE_DEBT, KEEP_RATIO }

interface PoolInfo {
    pool: CollateralPoolInstance;
    poolToken: CollateralPoolTokenInstance;
}

export class FuzzingPoolTokenHolder extends FuzzingActor {
    constructor(
        public runner: FuzzingRunner,
        public address: string,
        public underlyingAddress: string,
    ) {
        super(runner);
    }

    lock = new AsyncLock();

    poolInfo?: PoolInfo;

    async enter(scope: EventScope) {
        await this.lock.run(async () => {
            if (!this.poolInfo) {
                const agent = randomChoice(Array.from(this.state.agents.values()));
                this.poolInfo = {
                    pool: this.getContract<CollateralPoolInstance>(agent.collateralPoolAddress),
                    poolToken: this.getContract<CollateralPoolTokenInstance>(requireNotNull(agent.poolTokenAddress)),
                };
            }
            const natPrice = this.state.prices.getNat();
            const lotSizeWei = natPrice.convertUBAToTokenWei(this.state.lotSize());
            const amount = randomBN(lotSizeWei.muln(3));
            this.comment(`${this.formatAddress(this.address)}: entering pool ${this.formatAddress(this.poolInfo.pool.address)} (${formatBN(amount)})`);
            await this.poolInfo.pool.enter(0, false, { from: this.address, value: amount })
                .catch(e => scope.exitOnExpectedError(e, []));
        });
    }

    async exit(scope: EventScope, full: boolean) {
        await this.lock.run(async () => {
            if (!this.poolInfo) return;
            const balance = await this.poolInfo.poolToken.balanceOf(this.address);
            const amount = full ? balance : randomBN(balance);
            const amountFmt = amount.eq(balance) ? `full ${formatBN(balance)}` : `${formatBN(amount)} / ${formatBN(balance)}`;
            const selfCloseFAssetRequired = await this.poolInfo.pool.fAssetRequiredForSelfCloseExit(amount);
            if (selfCloseFAssetRequired.isZero()) {
                this.comment(`${this.formatAddress(this.address)}: exiting pool ${this.formatAddress(this.poolInfo.pool.address)} (${amountFmt})`);
                await this.poolInfo.pool.exit(amount, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, { from: this.address })
                    .catch(e => scope.exitOnExpectedError(e, ['collateral ratio falls below exitCR']));
            } else {
                const redeemToCollateral = coinFlip(0.1);   // it will usually redeem to collateral anyway, because amount is typically < 1 lot
                this.comment(`${this.formatAddress(this.address)}: self-close exiting pool ${this.formatAddress(this.poolInfo.pool.address)} (${amountFmt}), fassets=${formatBN(selfCloseFAssetRequired)}, toCollateral=${redeemToCollateral}`);
                await this.runner.fAssetMarketplace.buy(scope, this.address, selfCloseFAssetRequired);
                await this.context.fAsset.approve(this.poolInfo.pool.address, selfCloseFAssetRequired, { from: this.address });
                const res = await this.poolInfo.pool.selfCloseExit(amount, redeemToCollateral, this.underlyingAddress, { from: this.address })
                    .catch(e => scope.exitOnExpectedError(e, ['f-asset allowance too small', 'amount of sent tokens is too small after agent max redempton correction']));
                const redemptionRequest = this.runner.eventDecoder.findEventFrom(res, this.context.assetManager, 'RedemptionRequested');
                if (redemptionRequest) {
                    const redemptionPaymentReceiver = RedemptionPaymentReceiver.create(this.runner, this.address, this.underlyingAddress);
                    await redemptionPaymentReceiver.handleRedemption(scope, redemptionRequest.args);
                }
            }
            // if full exit was performed, we can later join different pool
            if (amount.eq(balance)) {
                this.poolInfo = undefined;
            }
        });
    }
}
