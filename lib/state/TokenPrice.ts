import { IFtsoContract, IFtsoInstance, IFtsoRegistryInstance } from "../../typechain-truffle";
import { AssetManagerSettings } from "../fasset/AssetManagerTypes";
import { amgToTokenWeiPrice } from "../fasset/Conversions";
import { BN_ZERO, BNish, getOrCreateAsync, minBN, requireNotNull, toBN } from "../utils/helpers";

const IFtso = artifacts.require("flare-smart-contracts/contracts/userInterfaces/IFtso.sol:IFtso" as any) as any as IFtsoContract;

export class TokenPrice {
    constructor(
        public readonly price: BN,
        public readonly timestamp: BN,
        public readonly decimals: BN
    ) {
    }

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

    amgToTokenWei(settings: AssetManagerSettings, tokenDecimals: BNish, assetUSD: TokenPrice) {
        return amgToTokenWeiPrice(settings, tokenDecimals, this.price, this.decimals, assetUSD.price, assetUSD.decimals);
    }

    static fromFraction(multiplier: BN, divisor: BN, timestamp: BN, decimals: BNish) {
        decimals = toBN(decimals);
        const price = multiplier.isZero() ? BN_ZERO : multiplier.mul(toBN(10).pow(decimals)).div(divisor);
        return new TokenPrice(price, timestamp, decimals);
    }

    priceInToken(tokenPrice: TokenPrice, decimals: BNish) {
        decimals = toBN(decimals);
        const multiplier = toBN(10).pow(decimals.add(tokenPrice.decimals).sub(this.decimals));
        const price = this.price.mul(multiplier).div(tokenPrice.price);
        const timestamp = minBN(this.timestamp, tokenPrice.timestamp);
        return new TokenPrice(price, timestamp, decimals);
    }
}

export class TokenPriceReader {
    ftsoCache: Map<string, IFtsoInstance> = new Map();
    priceCache: Map<string, TokenPrice> = new Map();

    constructor(
        public ftsoRegistry: IFtsoRegistryInstance
    ) { }

    getFtso(symbol: string) {
        return getOrCreateAsync(this.ftsoCache, symbol, async () => {
            const ftsoAddress = await this.ftsoRegistry.getFtsoBySymbol(symbol);
            return await IFtso.at(ftsoAddress);
        });
    }

    getRawPrice(symbol: string, trusted: boolean) {
        return getOrCreateAsync(this.priceCache, `${symbol}::trusted=${trusted}`, async () => {
            const ftso = await this.getFtso(symbol);
            const { 0: price, 1: timestamp, 2: decimals } =
                trusted ? await ftso.getCurrentPriceWithDecimals() : await ftso.getCurrentPriceWithDecimalsFromTrustedProviders();
            return new TokenPrice(toBN(price), toBN(timestamp), toBN(decimals));
        });
    }

    async getPrice(symbol: string, trusted?: false): Promise<TokenPrice>;
    async getPrice(symbol: string, trusted: boolean, trustedMaxAge: BNish): Promise<TokenPrice>;
    async getPrice(symbol: string, trusted: boolean = false, trustedMaxAge?: BNish) {
        const ftsoPrice = await this.getRawPrice(symbol, false);
        if (trusted) {
            const trustedPrice = await this.getRawPrice(symbol, true);
            return trustedPrice.fresh(ftsoPrice, toBN(requireNotNull(trustedMaxAge))) ? trustedPrice : ftsoPrice;
        } else {
            return ftsoPrice;
        }
    }
}
