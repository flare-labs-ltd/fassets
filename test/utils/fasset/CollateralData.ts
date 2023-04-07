import { AssetManagerSettings, CollateralToken, CollateralTokenClass } from "../../../lib/fasset/AssetManagerTypes";
import { amgToTokenWeiPrice } from "../../../lib/fasset/Conversions";
import { AMGPrice, AMGPriceConverter, CollateralPrice } from "../../../lib/state/CollateralPrice";
import { TokenPrice, TokenPriceReader } from "../../../lib/state/TokenPrice";
import { CollateralPoolTokenInstance, IERC20Contract, IFtsoRegistryContract } from "../../../typechain-truffle";

export const POOL_TOKEN_DECIMALS = 18;

const IFtsoRegistry = artifacts.require("flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol:IFtsoRegistry" as any) as any as IFtsoRegistryContract;
const IERC20 = artifacts.require('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20' as any) as any as IERC20Contract;

export enum CollateralKind { CLASS1, POOL, AGENT_POOL_TOKENS };

export class CollateralData extends AMGPriceConverter {
    constructor(
        public collateral: CollateralToken | null,
        public balance: BN,
        public assetPrice: TokenPrice,
        public tokenPrice: TokenPrice | undefined,
        public amgPrice: AMGPrice,
    ) {
        super();
    }

    kind() {
        if (this.collateral != null) {
            if (Number(this.collateral.tokenClass) === CollateralTokenClass.CLASS1) {
                return CollateralKind.CLASS1;
            } else if (Number(this.collateral.tokenClass) === CollateralTokenClass.POOL) {
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
        const token = await IERC20.at(collateralPrice.collateral.token);
        const balance = await token.balanceOf(tokenHolder);
        return new CollateralData(collateralPrice.collateral, balance, collateralPrice.assetPrice, collateralPrice.tokenPrice, collateralPrice.amgPrice);
    }
}

export class CollateralDataFactory {
    constructor(
        public settings: AssetManagerSettings,
        public priceReader: TokenPriceReader
    ) { }

    static async create(settings: AssetManagerSettings) {
        const ftsoRegistry = await IFtsoRegistry.at(settings.ftsoRegistry);
        const priceReader = new TokenPriceReader(ftsoRegistry);
        return new CollateralDataFactory(settings, priceReader);
    }

    async class1(collateral: CollateralToken, agentVault: string) {
        return await this.forCollateral(collateral, agentVault);
    }

    async pool(collateral: CollateralToken, collateralPoolAddress: string) {
        return await this.forCollateral(collateral, collateralPoolAddress);
    }

    async forCollateral(collateral: CollateralToken, tokenHolder: string) {
        const collateralPrice = await CollateralPrice.forCollateral(this.priceReader, this.settings, collateral);
        return CollateralData.forCollateralPrice(collateralPrice, tokenHolder);
    }

    async agentPoolTokens(poolCollateral: CollateralData, poolToken: CollateralPoolTokenInstance, agentVault: string) {
        const agentPoolTokens = await poolToken.balanceOf(agentVault);
        const totalPoolTokens = await poolToken.totalSupply();
        // asset price and token price will be expressed in pool collateral (wnat)
        const assetPrice = poolCollateral.collateral!.directPricePair ? poolCollateral.assetPrice : poolCollateral.assetPrice.priceInToken(poolCollateral.tokenPrice!, 18);
        const tokenPrice = TokenPrice.fromFraction(poolCollateral.balance, totalPoolTokens, poolCollateral.assetPrice.timestamp, 18);
        const amgToTokenWei = amgToTokenWeiPrice(this.settings, POOL_TOKEN_DECIMALS, tokenPrice.price, tokenPrice.decimals, assetPrice.price, assetPrice.decimals);
        return new CollateralData(null, agentPoolTokens, assetPrice, tokenPrice, AMGPrice.forAmgPrice(this.settings, amgToTokenWei));
    }
}
