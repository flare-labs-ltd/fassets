import { AssetManagerSettings, CollateralToken, CollateralTokenClass } from "../../../lib/fasset/AssetManagerTypes";
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
        public price: TokenPrice,
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
        public ftsoRegistry: IFtsoRegistryInstance,
        public assetPrice: TokenPrice,
    ) { }

    static async create(settings: AssetManagerSettings) {
        const ftsoRegistry = await IFtsoRegistry.at(settings.ftsoRegistry);
        const assetPrice = await TokenPrice.bySymbol(ftsoRegistry, settings.assetFtsoSymbol);
        return new CollateralDataFactory(settings, ftsoRegistry, assetPrice);
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
        const tokenPrice = await TokenPrice.bySymbol(this.ftsoRegistry, collateral.ftsoSymbol);
        const amgToTokenWei = tokenPrice.amgToTokenWei(this.settings, collateral.decimals, this.assetPrice);
        return new CollateralData(collateral, balance, tokenPrice, amgToTokenWei);
    }

    async agentPoolTokens(poolCollateral: CollateralData, poolToken: CollateralPoolTokenInstance, agentVault: string) {
        const agentPoolTokens = await poolToken.balanceOf(agentVault);
        const totalPoolTokens = await poolToken.totalSupply();
        const price = agentPoolTokens.isZero() ? BN_ZERO : poolCollateral.price.price.mul(totalPoolTokens).div(agentPoolTokens);
        const tokenPrice = new TokenPrice(price, poolCollateral.price.timestamp, poolCollateral.price.decimals);
        const amgToTokenWei = tokenPrice.amgToTokenWei(this.settings, POOL_TOKEN_DECIMALS, this.assetPrice);
        return new CollateralData(null, agentPoolTokens, tokenPrice, amgToTokenWei);
    }

}
