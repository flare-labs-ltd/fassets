import { AssetManagerSettings, CollateralToken, CollateralTokenClass } from "../../../lib/fasset/AssetManagerTypes";
import { amgToTokenWeiPrice } from "../../../lib/fasset/Conversions";
import { TokenPrice } from "../../../lib/state/TokenPrice";
import { BN_ZERO } from "../../../lib/utils/helpers";
import { CollateralPoolTokenInstance, IERC20Contract, IFtsoRegistryContract, IFtsoRegistryInstance } from "../../../typechain-truffle";

export const POOL_TOKEN_DECIMALS = 18;

const IFtsoRegistry = artifacts.require("flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol:IFtsoRegistry" as any) as any as IFtsoRegistryContract;
const IERC20 = artifacts.require('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20' as any) as any as IERC20Contract;

export enum CollateralKind { CLASS1, POOL, AGENT_POOL_TOKENS };

export class CollateralData {
    constructor(
        public collateral: CollateralToken | null,
        public balance: BN,
        public assetPrice: TokenPrice,
        public tokenPrice: TokenPrice,
        public amgToTokenWei: BN,
    ) {
    }

    kind() {
        if (this.collateral != null) {
            if (Number(this.collateral.tokenClass) === CollateralTokenClass.CLASS1) {
                return CollateralKind.CLASS1;
            } else if (Number(this.collateral.tokenClass) === CollateralTokenClass.POOL) {
                return CollateralKind.POOL;
            }
        } else {
            return CollateralKind.AGENT_POOL_TOKENS;
        }
        throw new Error("Invalid collateral kind");
    }

    tokenDecimals() {
        return this.collateral?.decimals ?? POOL_TOKEN_DECIMALS;
    }
}

export class CollateralDataFactory {
    constructor(
        public settings: AssetManagerSettings,
        public ftsoRegistry: IFtsoRegistryInstance
    ) { }

    static async create(settings: AssetManagerSettings) {
        const ftsoRegistry = await IFtsoRegistry.at(settings.ftsoRegistry);
        return new CollateralDataFactory(settings, ftsoRegistry);
    }

    async class1(collateral: CollateralToken, agentVault: string) {
        return await this.forCollateral(collateral, agentVault);
    }

    async pool(collateral: CollateralToken, collateralPoolAddress: string) {
        return await this.forCollateral(collateral, collateralPoolAddress);
    }

    async forCollateral(collateral: CollateralToken, tokenHolder: string) {
        const token = await IERC20.at(collateral.token);
        const balance = await token.balanceOf(tokenHolder);
        const assetPrice = await TokenPrice.bySymbol(this.ftsoRegistry, collateral.assetFtsoSymbol);
        const tokenPrice = await TokenPrice.bySymbol(this.ftsoRegistry, collateral.tokenFtsoSymbol);
        const amgToTokenWei = collateral.directPricePair
            ? amgToTokenWeiPrice(this.settings, collateral.decimals, 1, 0, assetPrice.price, assetPrice.decimals)
            : amgToTokenWeiPrice(this.settings, collateral.decimals, tokenPrice.price, tokenPrice.decimals, assetPrice.price, assetPrice.decimals);
        return new CollateralData(collateral, balance, assetPrice, tokenPrice, amgToTokenWei);
    }

    async agentPoolTokens(poolCollateral: CollateralData, poolToken: CollateralPoolTokenInstance, agentVault: string) {
        const agentPoolTokens = await poolToken.balanceOf(agentVault);
        const totalPoolTokens = await poolToken.totalSupply();
        // asset price and token price will be expressed in pool collateral (wnat)
        const assetPrice = poolCollateral.collateral!.directPricePair ? poolCollateral.assetPrice : poolCollateral.assetPrice.priceInToken(poolCollateral.tokenPrice, 10);
        const tokenPrice = TokenPrice.fromFraction(poolCollateral.balance, totalPoolTokens, poolCollateral.assetPrice.timestamp, 10);
        const amgToTokenWei = amgToTokenWeiPrice(this.settings, POOL_TOKEN_DECIMALS, tokenPrice.price, tokenPrice.decimals, assetPrice.price, assetPrice.decimals);
        return new CollateralData(null, agentPoolTokens, assetPrice, tokenPrice, amgToTokenWei);
    }
}
