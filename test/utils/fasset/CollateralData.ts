import { AssetManagerSettings, CollateralType, CollateralClass } from "../../../lib/fasset/AssetManagerTypes";
import { amgToTokenWeiPrice } from "../../../lib/fasset/Conversions";
import { AMGPrice, AMGPriceConverter, CollateralPrice } from "../../../lib/state/CollateralPrice";
import { TokenPrice, TokenPriceReader, tokenBalance } from "../../../lib/state/TokenPrice";
import { CollateralPoolInstance, CollateralPoolTokenInstance } from "../../../typechain-truffle";

export const POOL_TOKEN_DECIMALS = 18;

export enum CollateralKind { VAULT, POOL, AGENT_POOL_TOKENS };

export class CollateralData extends AMGPriceConverter {
    constructor(
        public collateral: CollateralType | null,
        public balance: BN,
        public assetPrice: TokenPrice,
        public tokenPrice: TokenPrice | undefined,
        public amgPrice: AMGPrice,
    ) {
        super();
    }

    kind() {
        if (this.collateral != null) {
            if (Number(this.collateral.collateralClass) === CollateralClass.VAULT) {
                return CollateralKind.VAULT;
            } else if (Number(this.collateral.collateralClass) === CollateralClass.POOL) {
                return CollateralKind.POOL;
            }
            throw new Error("Invalid collateral kind");
        } else {
            return CollateralKind.AGENT_POOL_TOKENS;
        }
    }

    tokenDecimals() {
        return this.collateral?.decimals ?? POOL_TOKEN_DECIMALS;
    }

    static forCollateralPrice(collateralPrice: CollateralPrice, balance: BN) {
        return new CollateralData(collateralPrice.collateral, balance, collateralPrice.assetPrice, collateralPrice.tokenPrice, collateralPrice.amgPrice);
    }
}

export class CollateralDataFactory {
    constructor(
        public settings: AssetManagerSettings,
        public priceReader: TokenPriceReader
    ) { }

    static async create(settings: AssetManagerSettings) {
        const priceReader = await TokenPriceReader.create(settings);
        return new CollateralDataFactory(settings, priceReader);
    }

    async vault(collateral: CollateralType, agentVault: string) {
        const balance = await tokenBalance(collateral.token, agentVault);
        const collateralPrice = await CollateralPrice.forCollateral(this.priceReader, this.settings, collateral);
        return CollateralData.forCollateralPrice(collateralPrice, balance);
    }

    async pool(collateral: CollateralType, collateralPool: CollateralPoolInstance) {
        const balance = await collateralPool.totalCollateral();
        const collateralPrice = await CollateralPrice.forCollateral(this.priceReader, this.settings, collateral);
        return CollateralData.forCollateralPrice(collateralPrice, balance);
    }

    async agentPoolTokens(poolCollateral: CollateralData, poolToken: CollateralPoolTokenInstance, agentVault: string) {
        const agentPoolTokens = await poolToken.balanceOf(agentVault);
        const totalPoolTokens = await poolToken.totalSupply();
        // asset price and token price will be expressed in pool collateral (wnat)
        const assetPrice = poolCollateral.collateral!.directPricePair ? poolCollateral.assetPrice : poolCollateral.assetPrice.priceInToken(poolCollateral.tokenPrice!, 18);
        const tokenPrice = TokenPrice.fromFraction(poolCollateral.balance, totalPoolTokens, poolCollateral.assetPrice.timestamp, 18);
        const amgToTokenWei = tokenPrice.price.isZero()
            ? assetPrice.price
            : amgToTokenWeiPrice(this.settings, POOL_TOKEN_DECIMALS, tokenPrice.price, tokenPrice.decimals, assetPrice.price, assetPrice.decimals);
        const amgPrice = AMGPrice.forAmgPrice(this.settings, amgToTokenWei);
        return new CollateralData(null, agentPoolTokens, assetPrice, tokenPrice, amgPrice);
    }
}
