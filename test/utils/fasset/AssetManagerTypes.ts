import { AssetManagerContract } from "../../../typechain-truffle";

export type AssetManagerSettings = Parameters<AssetManagerContract['new']>[0];
