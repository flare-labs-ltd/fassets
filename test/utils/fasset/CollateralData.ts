import { AssetManagerSettings, CollateralType, CollateralClass } from "../../../lib/fasset/AssetManagerTypes";
import { amgToTokenWeiPrice } from "../../../lib/fasset/Conversions";
import { AMGPrice, AMGPriceConverter, CollateralPrice } from "../../../lib/state/CollateralPrice";
import { TokenPrice, TokenPriceReader, tokenBalance } from "../../../lib/state/TokenPrice";
import { exp10 } from "../../../lib/utils/helpers";
import { ContingencyPoolTokenInstance } from "../../../typechain-truffle";

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

    static async forCollateralPrice(collateralPrice: CollateralPrice, tokenHolder: string) {
        const balance = await tokenBalance(collateralPrice.collateral.token, tokenHolder);
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
        return await this.forCollateral(collateral, agentVault);
    }

    async pool(collateral: CollateralType, contingencyPoolAddress: string) {
        return await this.forCollateral(collateral, contingencyPoolAddress);
    }

    async forCollateral(collateral: CollateralType, tokenHolder: string) {
        const collateralPrice = await CollateralPrice.forCollateral(this.priceReader, this.settings, collateral);
        return CollateralData.forCollateralPrice(collateralPrice, tokenHolder);
    }

    async agentPoolTokens(poolCollateral: CollateralData, poolToken: ContingencyPoolTokenInstance, agentVault: string) {
        const agentPoolTokens = await poolToken.balanceOf(agentVault);
        const totalPoolTokens = await poolToken.totalSupply();
        // asset price and token price will be expressed in pool collateral (wnat)
        const assetPrice = poolCollateral.collateral!.directPricePair ? poolCollateral.assetPrice : poolCollateral.assetPrice.priceInToken(poolCollateral.tokenPrice!, 18);
        const tokenPrice = TokenPrice.fromFraction(poolCollateral.balance, totalPoolTokens, poolCollateral.assetPrice.timestamp, 18);
        const amgToTokenWei = tokenPrice.price.isZero()
            ? exp10(100)    // artificial price, shouldn't be used
            : amgToTokenWeiPrice(this.settings, POOL_TOKEN_DECIMALS, tokenPrice.price, tokenPrice.decimals, assetPrice.price, assetPrice.decimals);
        const amgPrice = AMGPrice.forAmgPrice(this.settings, amgToTokenWei);
        return new CollateralData(null, agentPoolTokens, assetPrice, tokenPrice, amgPrice);
    }
}
