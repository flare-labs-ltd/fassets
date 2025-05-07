import { AssetManagerControllerInstance, CoreVaultManagerInstance, FAssetInstance, FtsoV2PriceStoreInstance, IERC20Instance, IIAssetManagerInstance, IPriceReaderInstance, WNatInstance } from "../../typechain-truffle";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { IBlockChain } from "../underlying-chain/interfaces/IBlockChain";
import { UnderlyingChainEvents } from "../underlying-chain/UnderlyingChainEvents";
import { ContractWithEvents } from "../utils/events/truffle";
import { ChainInfo } from "./ChainInfo";

export type AddressUpdaterEvents = import('../../typechain-truffle/AddressUpdater').AllEvents;
export type AssetManagerControllerEvents = import('../../typechain-truffle/AssetManagerController').AllEvents;
export type WNatEvents = import('../../typechain-truffle/WNat').AllEvents;
export type RelayEvents = import('../../typechain-truffle/IRelay').AllEvents;
export type FdcHubEvents = import('../../typechain-truffle/IFdcHub').AllEvents;
export type AgentVaultFactoryEvents = import('../../typechain-truffle/AgentVaultFactory').AllEvents;
export type CollateralPoolFactoryEvents = import('../../typechain-truffle/CollateralPoolFactory').AllEvents;
export type CollateralPoolTokenFactoryEvents = import('../../typechain-truffle/CollateralPoolTokenFactory').AllEvents;
export type WhitelistEvents = import('../../typechain-truffle/IWhitelist').AllEvents;
export type FdcVerificationEvents = import('../../typechain-truffle/IFdcVerification').AllEvents;
export type PriceReaderEvents = import('../../typechain-truffle/IPriceReader').AllEvents;
export type FtsoV2PriceStoreEvents = import('../../typechain-truffle/FtsoV2PriceStore').AllEvents;
export type FtsoRegistryEvents = import('../../typechain-truffle/IFtsoRegistry').AllEvents;
export type FtsoEvents = import('../../typechain-truffle/IFtso').AllEvents;
export type FtsoManagerEvents = import('../../typechain-truffle/IFtsoManager').AllEvents;
export type AssetManagerEvents = import('../../typechain-truffle/IIAssetManager').AllEvents;
export type FAssetEvents = import('../../typechain-truffle/FAsset').AllEvents;
export type ERC20Events = import('../../typechain-truffle/IERC20').AllEvents;
export type AgentVaultEvents = import('../../typechain-truffle/IAgentVault').AllEvents;
export type CollateralPoolEvents = import('../../typechain-truffle/ICollateralPool').AllEvents;
export type CollateralPoolTokenEvents = import('../../typechain-truffle/ICollateralPoolToken').AllEvents;
export type AgentOwnerRegistryEvents = import('../../typechain-truffle/IAgentOwnerRegistry').AllEvents;
export type CoreVaultManagerEvents = import('../../typechain-truffle/CoreVaultManager').AllEvents;

export interface IAssetContext {
    chainInfo: ChainInfo;
    chain: IBlockChain;
    chainEvents: UnderlyingChainEvents;
    attestationProvider: AttestationHelper;
    // contracts
    assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>;
    wNat: ContractWithEvents<WNatInstance, WNatEvents>;
    fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>;
    assetManager: ContractWithEvents<IIAssetManagerInstance, AssetManagerEvents>;
    stablecoins: Record<string, ContractWithEvents<IERC20Instance, ERC20Events>>;
    priceReader: ContractWithEvents<IPriceReaderInstance, PriceReaderEvents>;
    priceStore: ContractWithEvents<FtsoV2PriceStoreInstance, FtsoV2PriceStoreEvents>;
    coreVaultManager?: ContractWithEvents<CoreVaultManagerInstance, CoreVaultManagerEvents>;
}
