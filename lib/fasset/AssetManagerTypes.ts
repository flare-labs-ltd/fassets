import { AssetManagerContract, AssetManagerInstance } from "../../typechain-truffle";

type _AssetManagerSettings = Parameters<AssetManagerContract['new']>[0];
export interface AssetManagerSettings extends _AssetManagerSettings {}

export enum CollateralClass {
    POOL = 1,
    VAULT = 2,
}

type _CollateralType = Parameters<AssetManagerContract['new']>[1][0];
export interface CollateralType extends _CollateralType {}

type _AgentSettings = Parameters<AssetManagerInstance['createAgentVault']>[1];
export interface AgentSettings extends _AgentSettings {}

// status as returned from GetAgentInfo
export enum AgentStatus {
    NORMAL = 0,             // agent is operating normally
    CCB = 1,                // agent in collateral call band
    LIQUIDATION = 2,        // liquidation due to collateral ratio - ends when agent is healthy
    FULL_LIQUIDATION = 3,   // illegal payment liquidation - always liquidates all and then agent must close vault
    DESTROYING = 4,         // agent announced destroy, cannot mint again; all existing mintings have been redeemed before
}

type _AgentInfo = Awaited<ReturnType<AssetManagerInstance['getAgentInfo']>>;
export interface AgentInfo extends _AgentInfo {}

type _AvailableAgentInfo = Awaited<ReturnType<AssetManagerInstance['getAvailableAgentsDetailedList']>>[0][0];
export interface AvailableAgentInfo extends _AvailableAgentInfo {}

export type AgentSetting = "feeBIPS" | "poolFeeShareBIPS" | "mintingVaultCollateralRatioBIPS" | "mintingPoolCollateralRatioBIPS" |
    "buyFAssetByAgentFactorBIPS" | "poolExitCollateralRatioBIPS" | "poolTopupCollateralRatioBIPS" | "poolTopupTokenPriceFactorBIPS";
