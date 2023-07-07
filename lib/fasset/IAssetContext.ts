import { AssetManagerControllerInstance, AssetManagerInstance, FAssetInstance, IERC20Instance, IFtsoInstance, IFtsoManagerInstance, IFtsoRegistryInstance, IPriceReaderInstance, WNatInstance } from "../../typechain-truffle";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { IBlockChain } from "../underlying-chain/interfaces/IBlockChain";
import { UnderlyingChainEvents } from "../underlying-chain/UnderlyingChainEvents";
import { ContractWithEvents } from "../utils/events/truffle";
import { ChainInfo } from "./ChainInfo";

export type AddressUpdaterEvents = import('../../typechain-truffle/AddressUpdater').AllEvents;
export type AssetManagerControllerEvents = import('../../typechain-truffle/AssetManagerController').AllEvents;
export type WNatEvents = import('../../typechain-truffle/WNat').AllEvents;
export type StateConnectorEvents = import('../../typechain-truffle/IStateConnector').AllEvents;
export type AgentVaultFactoryEvents = import('../../typechain-truffle/AgentVaultFactory').AllEvents;
export type CollateralPoolFactoryEvents = import('../../typechain-truffle/CollateralPoolFactory').AllEvents;
export type CollateralPoolTokenFactoryEvents = import('../../typechain-truffle/CollateralPoolTokenFactory').AllEvents;
export type WhitelistEvents = import('../../typechain-truffle/Whitelist').AllEvents;
export type SCProofVerifierEvents = import('../../typechain-truffle/SCProofVerifier').AllEvents;
export type PriceReaderEvents = import('../../typechain-truffle/IPriceReader').AllEvents;
export type FtsoRegistryEvents = import('../../typechain-truffle/IFtsoRegistry').AllEvents;
export type FtsoEvents = import('../../typechain-truffle/IFtso').AllEvents;
export type FtsoManagerEvents = import('../../typechain-truffle/IFtsoManager').AllEvents;
export type AssetManagerEvents = import('../../typechain-truffle/IAssetManager').AllEvents;
export type FAssetEvents = import('../../typechain-truffle/FAsset').AllEvents;
export type ERC20Events = import('../../typechain-truffle/IERC20').AllEvents;
export type AgentVaultEvents = import('../../typechain-truffle/IAgentVault').AllEvents;
export type CollateralPoolEvents = import('../../typechain-truffle/ICollateralPool').AllEvents;
export type CollateralPoolTokenEvents = import('../../typechain-truffle/ICollateralPoolToken').AllEvents;

export interface IAssetContext {
    chainInfo: ChainInfo;
    chain: IBlockChain;
    chainEvents: UnderlyingChainEvents;
    attestationProvider: AttestationHelper;
    // contracts
    assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>;
    ftsoRegistry: ContractWithEvents<IFtsoRegistryInstance, FtsoRegistryEvents>;
    ftsoManager: ContractWithEvents<IFtsoManagerInstance, FtsoManagerEvents>;
    wNat: ContractWithEvents<WNatInstance, WNatEvents>;
    natFtso: ContractWithEvents<IFtsoInstance, FtsoEvents>;
    fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>;
    assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>;
    stablecoins: Record<string, ContractWithEvents<IERC20Instance, ERC20Events>>;
    ftsos: Record<string, ContractWithEvents<IFtsoInstance, FtsoEvents>>;
    priceReader: ContractWithEvents<IPriceReaderInstance, PriceReaderEvents>;
}
