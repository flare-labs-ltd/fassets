import { AssetManagerContract, AssetManagerInstance } from "../../typechain-truffle";

type _AssetManagerSettings = Parameters<AssetManagerContract['new']>[0];
export interface AssetManagerSettings extends _AssetManagerSettings {}

export enum CollateralTokenClass {
    POOL = 1,
    CLASS1 = 2,
}

type _CollateralToken = Parameters<AssetManagerContract['new']>[1][0];
export interface CollateralToken extends _CollateralToken {}

type _AgentSettings = Parameters<AssetManagerInstance['createAgent']>[0];
export interface AgentSettings extends _AgentSettings {}

type _AgentInfo = Awaited<ReturnType<AssetManagerInstance['getAgentInfo']>>;
export interface AgentInfo extends _AgentInfo {}

type _AvailableAgentInfo = Awaited<ReturnType<AssetManagerInstance['getAvailableAgentsDetailedList']>>[0][0];
export interface AvailableAgentInfo extends _AvailableAgentInfo {}

export type AgentSetting = "feeBIPS" | "poolFeeShareBIPS" | "mintingClass1CollateralRatioBIPS" | "mintingPoolCollateralRatioBIPS" |
    "buyFAssetByAgentFactorBIPS" | "poolExitCollateralRatioBIPS" | "poolTopupCollateralRatioBIPS" | "poolTopupTokenPriceFactorBIPS";
