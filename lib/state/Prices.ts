import { AssetManagerSettings, CollateralToken, CollateralTokenClass } from "../fasset/AssetManagerTypes";
import { IAssetContext } from "../fasset/IAssetContext";
import { CollateralIndexedList, CollateralTokenId } from "./CollateralIndexedList";
import { CollateralPrice } from "./CollateralPrice";
import { TokenPrice, TokenPriceReader } from "./TokenPrice";

export type StablecoinPrices = { [tokenAddress: string]: TokenPrice };

export class Prices {
    constructor(
        public collateralPrices: CollateralIndexedList<CollateralPrice>,
    ) {
    }

    get(token: CollateralTokenId) {
        return this.collateralPrices.get(token);
    }

    getClass1(token: string) {
        return this.collateralPrices.get(CollateralTokenClass.CLASS1, token);
    }

    getPool(token: string) {
        return this.collateralPrices.get(CollateralTokenClass.POOL, token);
    }

    toString() {
        const prices: Map<string, number> = new Map();
        for (const cp of this.collateralPrices.list) {
            prices.set(cp.collateral.assetFtsoSymbol, cp.assetPrice.toNumber());
            if (!cp.collateral.directPricePair) {
                prices.set(cp.collateral.tokenFtsoSymbol, cp.tokenPrice!.toNumber());
                prices.set(`${cp.collateral.assetFtsoSymbol}/${cp.collateral.tokenFtsoSymbol}`, cp.assetPrice.toNumber()  / cp.tokenPrice!.toNumber());
            }
        }
        return '(' + Array.from(prices.entries()).map(([symbol, value]) => `${symbol}=${value.toFixed(3)}`).join(', ') + ')';
    }

    static async getFtsoPrices(priceReader: TokenPriceReader, settings: AssetManagerSettings, collaterals: Iterable<CollateralToken>, trusted: boolean = false): Promise<Prices> {
        const collateralPrices = new CollateralIndexedList<CollateralPrice>();
        for (const collateral of collaterals) {
            const collateralPrice = await CollateralPrice.forCollateral(priceReader, settings, collateral, trusted);
            collateralPrices.set(collateral, collateralPrice);
        }
        return new Prices(collateralPrices);
    }

    static async getPrices(context: IAssetContext, settings: AssetManagerSettings, collaterals: Iterable<CollateralToken>): Promise<[Prices, Prices]> {
        const priceReader = new TokenPriceReader(context.ftsoRegistry);
        const ftsoPrices = await this.getFtsoPrices(priceReader, settings, collaterals, false);
        const trustedPrices = await this.getFtsoPrices(priceReader, settings, collaterals, true);
        return [ftsoPrices, trustedPrices];
    }
}
