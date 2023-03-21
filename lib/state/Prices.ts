import { IFtsoInstance } from "../../typechain-truffle";
import { AssetManagerSettings, CollateralToken, CollateralTokenClass } from "../fasset/AssetManagerTypes";
import { amgToTokenWeiPrice } from "../fasset/Conversions";
import { IAssetContext } from "../fasset/IAssetContext";
import { requireNotNull, toBN } from "../utils/helpers";

export class TokenPrice {
    constructor(
        public readonly price: BN,
        public readonly timestamp: BN,
        public readonly decimals: BN,
    ) {}

    fresh(relativeTo: TokenPrice, maxAge: BN) {
        return this.timestamp.add(maxAge).gte(relativeTo.timestamp);
    }

    toNumber() {
        return Number(this.price) * (10 ** -Number(this.decimals));
    }

    toFixed(displayDecimals: number = 3) {
        return this.toNumber().toFixed(displayDecimals);
    }

    toString() {
        return this.toNumber().toFixed(3);
    }
}

export type StablecoinPrices = { [tokenAddress: string]: TokenPrice };

export class Prices {
    constructor(
        context: IAssetContext,
        settings: AssetManagerSettings,
        collaterals: CollateralToken[],
        public readonly natUSD: TokenPrice,
        public readonly assetUSD: TokenPrice,
        public readonly stablecoinUSD: StablecoinPrices,
    ) {
        this.amgToNatWei = this.calculateAmgToTokenWei(settings, collaterals, CollateralTokenClass.POOL, context.wNat.address);
        this.amgToClass1Wei = {};
        for (const collateral of collaterals) {
            if (collateral.token in stablecoinUSD) {
                this.amgToClass1Wei[collateral.token] = this.calculateAmgToTokenWei(settings, collaterals, Number(collateral.tokenClass), collateral.token);
            }
        }
    }

    amgToNatWei: BN;
    amgToClass1Wei: { [tokenAddress: string]: BN };

    get assetNatNum() {
        return this.assetUSD.toNumber() / this.natUSD.toNumber();
    }

    calculateAmgToTokenWei(settings: AssetManagerSettings, collaterals: CollateralToken[], tokenClass: CollateralTokenClass, tokenAddress: string) {
        const tokenPrice = this.stablecoinUSD[tokenAddress];
        const tokenCollateral = requireNotNull(collaterals.find(c => c.tokenClass === tokenClass && c.token === tokenAddress));
        return amgToTokenWeiPrice(settings, tokenCollateral.decimals, tokenPrice.price, tokenPrice.decimals,
            this.assetUSD.price, this.assetUSD.decimals);
    }

    toString() {
        return `(nat=${this.natUSD.toFixed(3)}$, asset=${this.assetUSD.toFixed(3)}$, asset/nat=${this.assetNatNum.toFixed(3)})`;
    }

    static async getPriceForFtso(ftso: IFtsoInstance): Promise<TokenPrice> {
        const { 0: price, 1: timestamp, 2: decimals } = await ftso.getCurrentPriceWithDecimals();
        return new TokenPrice(toBN(price), toBN(timestamp), toBN(decimals));
    }

    static async getTrustedPriceForFtso(ftso: IFtsoInstance, maxAge: BN, fallbackPrice: TokenPrice): Promise<TokenPrice> {
        const { 0: price, 1: timestamp, 2: decimals } = await ftso.getCurrentPriceWithDecimalsFromTrustedProviders();
        const trustedPrice = new TokenPrice(toBN(price), toBN(timestamp), toBN(decimals));
        return trustedPrice.fresh(fallbackPrice, maxAge) ? trustedPrice : fallbackPrice;
    }

    static async getFtsoPrices(context: IAssetContext, settings: AssetManagerSettings, collaterals: CollateralToken[], selectedStablecoins?: string[]): Promise<Prices> {
        const natPrice = await this.getPriceForFtso(context.natFtso);
        const assetPrice = await this.getPriceForFtso(context.assetFtso);
        const stablecoinPrices: StablecoinPrices = {};
        for (const tokenKey of selectedStablecoins ?? Object.keys(context.stablecoins)) {
            stablecoinPrices[context.stablecoins[tokenKey].address] = await this.getPriceForFtso(context.ftsos[tokenKey]);
        }
        return new Prices(context, settings, collaterals, natPrice, assetPrice, stablecoinPrices);
    }

    static async getTrustedPrices(context: IAssetContext, settings: AssetManagerSettings, collaterals: CollateralToken[], ftsoPrices: Prices, selectedStablecoins?: string[]): Promise<Prices> {
        const maxAge = toBN(settings.maxTrustedPriceAgeSeconds);
        const natPrice = await this.getTrustedPriceForFtso(context.natFtso, maxAge, ftsoPrices.natUSD);
        const assetPrice = await this.getTrustedPriceForFtso(context.assetFtso, maxAge, ftsoPrices.assetUSD);
        const stablecoinPrices: StablecoinPrices = {};
        for (const tokenKey of selectedStablecoins ?? Object.keys(context.stablecoins)) {
            const tokenAddress = context.stablecoins[tokenKey].address;
            stablecoinPrices[tokenAddress] = await this.getTrustedPriceForFtso(context.ftsos[tokenKey], maxAge, ftsoPrices.stablecoinUSD[tokenKey]);
        }
        return new Prices(context, settings, collaterals, natPrice, assetPrice, stablecoinPrices);
    }

    static async getPrices(context: IAssetContext, settings: AssetManagerSettings, collaterals: CollateralToken[], selectedStablecoins?: string[]): Promise<[Prices, Prices]> {
        const ftsoPrices = await this.getFtsoPrices(context, settings, collaterals, selectedStablecoins);
        const trustedPrices = await this.getTrustedPrices(context, settings, collaterals, ftsoPrices, selectedStablecoins);
        return [ftsoPrices, trustedPrices];
    }
}
