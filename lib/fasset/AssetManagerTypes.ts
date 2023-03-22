import { AssetManagerContract, AssetManagerInstance } from "../../typechain-truffle";

export type AssetManagerSettings = Parameters<AssetManagerContract['new']>[0];

export enum CollateralTokenClass {
    POOL = 1,
    CLASS1 = 2,
}

export type CollateralToken = Parameters<AssetManagerContract['new']>[1][0];

export type AgentSettings = Parameters<AssetManagerInstance['createAgent']>[0];

export type AgentInfo = Awaited<ReturnType<AssetManagerInstance['getAgentInfo']>>;

export type AvailableAgentInfo = Awaited<ReturnType<AssetManagerInstance['getAvailableAgentsDetailedList']>>[0][0];

export type AgentSetting = "feeBIPS" | "poolFeeShareBIPS" | "mintingClass1CollateralRatioBIPS" | "mintingPoolCollateralRatioBIPS" |
    "buyFAssetByAgentFactorBIPS" | "poolExitCollateralRatioBIPS" | "poolTopupCollateralRatioBIPS" | "poolTopupTokenPriceFactorBIPS";
