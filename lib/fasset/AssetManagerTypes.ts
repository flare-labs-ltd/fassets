import { AssetManagerContract, AssetManagerInstance } from "../../typechain-truffle";

export type AssetManagerSettings = Parameters<AssetManagerContract['new']>[0];

export type AgentInfo = Awaited<ReturnType<AssetManagerInstance['getAgentInfo']>>;

export type AvailableAgentInfo = Awaited<ReturnType<AssetManagerInstance['getAvailableAgentsDetailedList']>>[0][0];
