import { AssetManagerContract, AssetManagerInstance, FAssetInstance } from "../../typechain-truffle";

export type AssetManagerSettings = Parameters<AssetManagerContract['new']>[0];

export async function newAssetManager(governanceAddress: string,
    assetManagerControllerAddress: string,
    name: string, symbol: string, decimals: number,
    assetManagerSettings: AssetManagerSettings
): Promise<[AssetManagerInstance, FAssetInstance]> {
    const AssetManager = await linkAssetManager();
    const FAsset = artifacts.require('FAsset');
    const fAsset = await FAsset.new(governanceAddress, name, symbol, decimals);
    const assetManager = await AssetManager.new(assetManagerSettings, fAsset.address, assetManagerControllerAddress);
    await fAsset.setAssetManager(assetManager.address);
    return [assetManager, fAsset];
}

export async function linkAssetManager() {
    // libraries without dependencies
    const Agents = await artifacts.require('Agents' as any).new();
    const AllowedPaymentAnnouncement = await artifacts.require('AllowedPaymentAnnouncement' as any).new();
    const AvailableAgents = await artifacts.require('AvailableAgents' as any).new();
    const CollateralReservations = await artifacts.require('CollateralReservations' as any).new();
    const Liquidation = await artifacts.require('Liquidation' as any).new();
    const Minting = await artifacts.require('Minting' as any).new();
    const Redemption = await artifacts.require('Redemption' as any).new();
    // Challenges
    const IllegalPaymentChallengeLibrary = artifacts.require('Challenges' as any);
    IllegalPaymentChallengeLibrary.link('Liquidation', Liquidation.address);
    const Challenges = await IllegalPaymentChallengeLibrary.new();
    // UnderlyingFreeBalance
    const UnderlyingFreeBalanceLibrary = artifacts.require('UnderlyingFreeBalance' as any);
    UnderlyingFreeBalanceLibrary.link('Liquidation', Liquidation.address);
    const UnderlyingFreeBalance = await UnderlyingFreeBalanceLibrary.new();
    // AssetManagerContract
    const AssetManager = artifacts.require('AssetManager');
    AssetManager.link('Agents', Agents.address);
    AssetManager.link('AllowedPaymentAnnouncement', AllowedPaymentAnnouncement.address);
    AssetManager.link('AvailableAgents', AvailableAgents.address);
    AssetManager.link('CollateralReservations', CollateralReservations.address);
    AssetManager.link('Liquidation', Liquidation.address);
    AssetManager.link('Minting', Minting.address);
    AssetManager.link('Redemption', Redemption.address);
    AssetManager.link('Challenges', Challenges.address);
    AssetManager.link('UnderlyingFreeBalance', UnderlyingFreeBalance.address);
    return AssetManager;
}
