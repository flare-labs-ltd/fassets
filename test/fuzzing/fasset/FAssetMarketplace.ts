import { EventScope } from "../../../lib/utils/events/ScopedEvents";
import { BN_ZERO } from "../../../lib/utils/helpers";
import { randomShuffled } from "../../utils/fuzzing-utils";

export interface FAssetSeller {
    buyFAssetsFrom(scope: EventScope, receiverAddress: string, amount: BN): Promise<BN>;
}

export class FAssetMarketplace {
    constructor(
        public sellers: FAssetSeller[] = [],
    ) { }

    addSeller(seller: FAssetSeller) {
        if (this.sellers.includes(seller)) return;
        this.sellers.push(seller);
    }

    removeSeller(seller: FAssetSeller) {
        const index = this.sellers.indexOf(seller);
        if (index >= 0) {
            this.sellers.splice(index, 1);
        }
    }

    async buy(scope: EventScope, receiverAddress: string, amount: BN) {
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
