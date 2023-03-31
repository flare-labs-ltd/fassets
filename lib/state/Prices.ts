import { AssetManagerSettings, CollateralToken, CollateralTokenClass } from "../fasset/AssetManagerTypes";
import { IAssetContext } from "../fasset/IAssetContext";
import { requireNotNull, toBN } from "../utils/helpers";
import { TokenPrice } from "./TokenPrice";

export type StablecoinPrices = { [tokenAddress: string]: TokenPrice };

export class Prices {
    constructor(
        settings: AssetManagerSettings,
        collaterals: CollateralToken[],
        public readonly natUSD: TokenPrice,
        public readonly assetUSD: TokenPrice,
        public readonly stablecoinUSD: StablecoinPrices,
    ) {
        const natCollateral = requireNotNull(collaterals.find(c => this.isPoolCollateral(c)), "Missing NAT collateral");
        this.amgToNatWei = natUSD.amgToTokenWei(settings, natCollateral.decimals, assetUSD);
        this.amgToClass1Wei = {};
        for (const collateral of collaterals) {
            const tokenUSD = stablecoinUSD[collateral.token];
            if (tokenUSD != null) {
                this.amgToClass1Wei[collateral.token] = tokenUSD.amgToTokenWei(settings, collateral.decimals, assetUSD);
            }
        }
    }

    amgToNatWei: BN;
    amgToClass1Wei: { [tokenAddress: string]: BN };

    get assetNatNum() {
        return this.assetUSD.toNumber() / this.natUSD.toNumber();
    }

    isPoolCollateral(collateral: CollateralToken) {
        return Number(collateral.tokenClass) === CollateralTokenClass.POOL && Number(collateral.validUntil) === 0;
    }

    toString() {
        return `(nat=${this.natUSD.toFixed(3)}$, asset=${this.assetUSD.toFixed(3)}$, asset/nat=${this.assetNatNum.toFixed(3)})`;
    }

    static async getFtsoPrices(context: IAssetContext, settings: AssetManagerSettings, collaterals: CollateralToken[], selectedStablecoins?: string[]): Promise<Prices> {
        const natPrice = await TokenPrice.forFtso(context.natFtso);
        const assetPrice = await TokenPrice.forFtso(context.assetFtso);
        const stablecoinPrices: StablecoinPrices = {};
        for (const tokenKey of selectedStablecoins ?? Object.keys(context.stablecoins)) {
            stablecoinPrices[context.stablecoins[tokenKey].address] = await TokenPrice.forFtso(context.ftsos[tokenKey]);
        }
        return new Prices(settings, collaterals, natPrice, assetPrice, stablecoinPrices);
    }

    static async getTrustedPrices(context: IAssetContext, settings: AssetManagerSettings, collaterals: CollateralToken[], ftsoPrices: Prices, selectedStablecoins?: string[]): Promise<Prices> {
        const maxAge = toBN(settings.maxTrustedPriceAgeSeconds);
        const natPrice = await TokenPrice.forFtsoTrusted(context.natFtso, maxAge, ftsoPrices.natUSD);
        const assetPrice = await TokenPrice.forFtsoTrusted(context.assetFtso, maxAge, ftsoPrices.assetUSD);
        const stablecoinPrices: StablecoinPrices = {};
        for (const tokenKey of selectedStablecoins ?? Object.keys(context.stablecoins)) {
            const tokenAddress = context.stablecoins[tokenKey].address;
            stablecoinPrices[tokenAddress] = await TokenPrice.forFtsoTrusted(context.ftsos[tokenKey], maxAge, ftsoPrices.stablecoinUSD[tokenKey]);
        }
        return new Prices(settings, collaterals, natPrice, assetPrice, stablecoinPrices);
    }

    static async getPrices(context: IAssetContext, settings: AssetManagerSettings, collaterals: CollateralToken[], selectedStablecoins?: string[]): Promise<[Prices, Prices]> {
        const ftsoPrices = await this.getFtsoPrices(context, settings, collaterals, selectedStablecoins);
        const trustedPrices = await this.getTrustedPrices(context, settings, collaterals, ftsoPrices, selectedStablecoins);
        return [ftsoPrices, trustedPrices];
    }
}
