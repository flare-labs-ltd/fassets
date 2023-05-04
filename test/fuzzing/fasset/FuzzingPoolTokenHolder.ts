import { EventScope } from "../../../lib/utils/events/ScopedEvents";
import { formatBN, requireNotNull } from "../../../lib/utils/helpers";
import { CollateralPoolInstance, CollateralPoolTokenInstance } from "../../../typechain-truffle";
import { AsyncLock, randomBN, randomChoice } from "../../utils/fuzzing-utils";
import { FuzzingActor } from "./FuzzingActor";
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
            this.comment(`${this.formatAddress(this.address)}: exiting pool ${this.formatAddress(this.poolInfo.pool.address)} (${exitAmount})`);
            await this.poolInfo.pool.exit(amount, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL, { from: this.address })
                .catch(e => scope.exitOnExpectedError(e, ['collateral ratio falls below exitCR']));
            // if full exit was performed, we can later join different pool
            if (amount.eq(balance)) {
                this.poolInfo = undefined;
            }
        });
    }
}
