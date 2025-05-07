import { eventIs } from "../../../lib/utils/events/truffle";
import { BNish, checkedCast, requireNotNull, toBN } from "../../../lib/utils/helpers";
import { MockChain, MockChainWallet } from "../../utils/fasset/MockChain";
import { AssetContext, AssetContextClient } from "./AssetContext";

export interface CoreVaultManagerSettings {
    escrowAmount: BNish;
    escrowEndTimeSeconds: BNish;    // time of day in seconds
    minimalAmountLeft: BNish;
    chainPaymentFee: BNish;
}

export interface MockEscrowItem {
    amount: BN;
    preimageHash: string;
    destinationAddress: string;
    expirationTimestamp: BN;
    expirationAddress: string;
}

export class MockChainEscrow {
    constructor(
        public chain: MockChain,
        public escrowAddress: string,
    ) {
    }

    wallet = new MockChainWallet(this.chain);
    escrows: Map<string, MockEscrowItem> = new Map();   // preimageHash => data
    underlyingAddress = "ESCROW_ADDRESS";

    async createEscrow(source: string, destinationAddress: string, amount: BN, preimageHash: string, expirationTimestamp: BN) {
        assert(!this.escrows.has(preimageHash), "preimage hash already used");
        await this.wallet.addTransaction(source, this.escrowAddress, amount, null);
        const escrow: MockEscrowItem = { amount, preimageHash, destinationAddress, expirationTimestamp, expirationAddress: source };
        this.escrows.set(preimageHash, escrow);
        return escrow;
    }

    async expireEscrows() {
        const expiredList: MockEscrowItem[] = [];
        const timestamp = toBN(this.chain.currentTimestamp());
        for (const escrow of Array.from(this.escrows.values())) {
            if (escrow.expirationTimestamp.lte(timestamp)) {
                await this.expireEscrow(escrow);
                expiredList.push(escrow);
            }
        }
        return expiredList;
    }

    async expireEscrow(escrow: MockEscrowItem) {
        const timestamp = toBN(this.chain.currentTimestamp());
        assert(escrow.expirationTimestamp.lte(timestamp), "not expired yet");
        await this.wallet.addTransaction(this.escrowAddress, escrow.expirationAddress, escrow.amount, null);
        this.escrows.delete(escrow.preimageHash);
        return escrow;
    }

    async releaseEscrow(preimage: string) {
        const preimageHash = web3.utils.keccak256(preimage);
        const escrow = this.escrows.get(preimageHash);
        assert(escrow != null, "unknown preimage");
        await this.wallet.addTransaction(this.escrowAddress, escrow.destinationAddress, escrow.amount, null);
        this.escrows.delete(escrow.preimageHash);
        return escrow;
    }
}

export class MockCoreVaultBot extends AssetContextClient {
    constructor(
        context: AssetContext,
        public triggeringAddress: string,
    ) {
        super(context);
    }

    chain = checkedCast(this.context.chain, MockChain);
    wallet = new MockChainWallet(this.chain);
    escrow = new MockChainEscrow(this.chain, "ESCROW_ADDRESS");
    coreVaultManager = requireNotNull(this.context.coreVaultManager);

    async getSettings(): Promise<CoreVaultManagerSettings> {
        const { 0: escrowEndTimeSeconds, 1: escrowAmount, 2: minimalAmountLeft, 3: chainPaymentFee } = await this.coreVaultManager.getSettings();
        return { escrowEndTimeSeconds, escrowAmount, minimalAmountLeft, chainPaymentFee };
    }

    async underlyingAddress() {
        return await this.coreVaultManager.coreVaultAddress();
    }

    async custodianAddress() {
        return await this.coreVaultManager.custodianAddress();
    }

    async triggerAndPerformActions() {
        const result = {
            payments: [] as Array<{ txHash: string, from: string, to: string, amount: BN, paymentReference: string }>,
            expiredEscrows: [] as MockEscrowItem[],
            createdEscrows: [] as MockEscrowItem[]
        };
        result.expiredEscrows = await this.escrow.expireEscrows();
        const res = await this.coreVaultManager.triggerInstructions({ from: this.triggeringAddress });
        for (const event of res.logs) {
            if (eventIs(event, this.coreVaultManager, "PaymentInstructions")) {
                const args = event.args;
                const txHash = await this.wallet.addTransaction(args.account, args.destination, args.amount, args.paymentReference);
                result.payments.push({ txHash, from: args.account, to: args.destination, amount: args.amount, paymentReference: args.paymentReference });
            } else if (eventIs(event, this.coreVaultManager, "EscrowInstructions")) {
                const args = event.args;
                const escrow = await this.escrow.createEscrow(args.account, args.destination, args.amount, args.preimageHash, args.cancelAfterTs);
                result.createdEscrows.push(escrow);
            }
        }
        return result;
    }
}