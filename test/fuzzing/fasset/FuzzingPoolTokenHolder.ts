import { EventScope } from "../../../lib/utils/events/ScopedEvents";
import { BN_ZERO, formatBN, requireNotNull } from "../../../lib/utils/helpers";
import { CollateralPoolInstance, CollateralPoolTokenInstance } from "../../../typechain-truffle";
import { AsyncLock, coinFlip, randomBN, randomChoice, randomShuffled } from "../../utils/fuzzing-utils";
import { FuzzingActor } from "./FuzzingActor";
import { RedemptionPaymentReceiver } from "./FuzzingCustomer";
import { FuzzingRunner } from "./FuzzingRunner";

enum TokenExitType { MAXIMIZE_FEE_WITHDRAWAL, MINIMIZE_FEE_DEBT, KEEP_RATIO }

interface PoolInfo {
    pool: CollateralPoolInstance;
    poolToken: CollateralPoolTokenInstance;
}

export interface FAssetSeller {
    buyFAssetsFrom(scope: EventScope, receiverAddress: string, amount: BN): Promise<BN>;
}

export class FAssetMarketplace {
    constructor(
        public sellers: FAssetSeller[] = [],
    ) { }

    public async buy(scope: EventScope, receiverAddress: string, amount: BN) {
        let total = BN_ZERO;
        const sellers = randomShuffled(this.sellers);
        for (const seller of sellers) {
            if (total.gte(amount)) break;
            const bought = await seller.buyFAssetsFrom(scope, receiverAddress, amount.sub(total));
            total = total.add(bought);
        }
        return total;
    }
}

export class FuzzingPoolTokenHolder extends FuzzingActor {
    constructor(
        public runner: FuzzingRunner,
        public address: string,
        public underlyingAddress: string
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
            const exitAmount = amount.eq(balance) ? 'full' : `${formatBN(amount)} / ${formatBN(balance)}`;
            const selfCloseFAssetRequired = await this.poolInfo.pool.fAssetRequiredForSelfCloseExit(exitAmount);
            if (selfCloseFAssetRequired.isZero()) {
                this.comment(`${this.formatAddress(this.address)}: exiting pool ${this.formatAddress(this.poolInfo.pool.address)} (${formatBN(exitAmount)})`);
                await this.poolInfo.pool.exit(amount, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, { from: this.address })
                    .catch(e => scope.exitOnExpectedError(e, ['collateral ratio falls below exitCR']));
            } else {
                const redeemToCollateral = coinFlip();
                this.comment(`${this.formatAddress(this.address)}: self-close exiting pool ${this.formatAddress(this.poolInfo.pool.address)} (${formatBN(exitAmount)}), fassets=${formatBN(selfCloseFAssetRequired)}, toCollateral=${redeemToCollateral}`);
                const res = await this.poolInfo.pool.selfCloseExit(amount, redeemToCollateral, this.underlyingAddress, { from: this.address })
                    .catch(e => scope.exitOnExpectedError(e, []));
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
