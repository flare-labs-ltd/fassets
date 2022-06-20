import { AssetManagerSettings } from "../fasset/AssetManagerTypes";
import { amgToNATWeiPrice } from "../fasset/Conversions";
import { IAssetContext } from "../fasset/IAssetContext";
import { BNish, BN_ZERO, toBN } from "../utils/helpers";


export class Prices {
    constructor(
        settings: AssetManagerSettings,
        public readonly natUSDDec5: BN,
        public readonly natTimestamp: BN,
        public readonly assetUSDDec5: BN,
        public readonly assetTimestamp: BN,
    ) { 
        this.amgNatWei = !natTimestamp.isZero() && !assetTimestamp.isZero() ? amgToNATWeiPrice(settings, natUSDDec5, assetUSDDec5) : BN_ZERO;
    }
    
    readonly amgNatWei: BN;

    get natUSD() {
        return Number(this.natUSDDec5) * 1e-5;
    }

    get assetUSD() {
        return Number(this.assetUSDDec5) * 1e-5;
    }

    get assetNat() {
        return this.assetUSD / this.natUSD;
    }

    fresh(relativeTo: Prices, maxAge: BNish) {
        maxAge = toBN(maxAge);
        return this.natTimestamp.add(maxAge).gte(relativeTo.natTimestamp) && this.assetTimestamp.add(maxAge).gte(relativeTo.assetTimestamp);
    }

    toString() {
        return `(nat=${this.natUSD.toFixed(3)}$, asset=${this.assetUSD.toFixed(3)}$, asset/nat=${this.assetNat.toFixed(3)})`;
    }

    static async getFtsoPrices(context: IAssetContext, settings: AssetManagerSettings): Promise<Prices> {
        const { 0: natPrice, 1: natTimestamp } = await context.natFtso.getCurrentPrice();
        const { 0: assetPrice, 1: assetTimestamp } = await context.assetFtso.getCurrentPrice();
        return new Prices(settings, natPrice, natTimestamp, assetPrice, assetTimestamp);
    }

    static async getTrustedPrices(context: IAssetContext, settings: AssetManagerSettings): Promise<Prices> {
        const { 0: natPriceTrusted, 1: natTimestampTrusted } = await context.natFtso.getCurrentPriceFromTrustedProviders();
        const { 0: assetPriceTrusted, 1: assetTimestampTrusted } = await context.assetFtso.getCurrentPriceFromTrustedProviders();
        return new Prices(settings, natPriceTrusted, natTimestampTrusted, assetPriceTrusted, assetTimestampTrusted);
    }
    
    static async getPrices(context: IAssetContext, settings: AssetManagerSettings): Promise<[Prices, Prices]> {
        const ftsoPrices = await this.getFtsoPrices(context, settings);
        const trustedPrices = await this.getTrustedPrices(context, settings);
        const trustedPricesFresh = trustedPrices.fresh(ftsoPrices, settings.maxTrustedPriceAgeSeconds);
        return [ftsoPrices, trustedPricesFresh ? trustedPrices : ftsoPrices];
    }
}
