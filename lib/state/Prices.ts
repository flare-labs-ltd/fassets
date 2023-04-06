import { AssetManagerSettings, CollateralToken, CollateralTokenClass } from "../fasset/AssetManagerTypes";
import { IAssetContext } from "../fasset/IAssetContext";
import { requireNotNull } from "../utils/helpers";
import { CollateralPrice } from "./CollateralPrice";
import { TokenPrice, TokenPriceReader } from "./TokenPrice";

export type StablecoinPrices = { [tokenAddress: string]: TokenPrice };

export class Prices {
    constructor(
        public collateralPrices: CollateralPrice[],
    ) {
    }

    natPrice = requireNotNull(this.collateralPrices.find(cp => this.isPoolCollateral(cp.collateral)));

    isPoolCollateral(collateral: CollateralToken) {
        return Number(collateral.tokenClass) === CollateralTokenClass.POOL && Number(collateral.validUntil) === 0;
    }

    // toString() {
    //     return `(nat=${this.natUSD.toFixed(3)}$, asset=${this.assetUSD.toFixed(3)}$, asset/nat=${this.assetNatNum.toFixed(3)})`;
    // }

    static async getFtsoPrices(priceReader: TokenPriceReader, settings: AssetManagerSettings, collaterals: CollateralToken[], trusted: boolean = false): Promise<Prices> {
        const collateralPrices: CollateralPrice[] = [];
        for (const collateral of collaterals) {
            const collateralPrice = await CollateralPrice.forCollateral(priceReader, settings, collateral, trusted);
            collateralPrices.push(collateralPrice);
        }
        return new Prices(collateralPrices);
    }

    static async getPrices(context: IAssetContext, settings: AssetManagerSettings, collaterals: CollateralToken[]): Promise<[Prices, Prices]> {
        const priceReader = new TokenPriceReader(context.ftsoRegistry);
        const ftsoPrices = await this.getFtsoPrices(priceReader, settings, collaterals, false);
        const trustedPrices = await this.getFtsoPrices(priceReader, settings, collaterals, true);
        return [ftsoPrices, trustedPrices];
    }
}
