import { AssetManagerControllerEvents, AssetManagerEvents, FAssetEvents, FtsoManagerMockEvents, FtsoMockEvents, FtsoRegistryMockEvents, WNatEvents } from "../../test/integration/utils/AssetContext";
import { AssetManagerControllerInstance, AssetManagerInstance, FAssetInstance, FtsoManagerMockInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../typechain-truffle";
import { AttestationHelper } from "../underlying-chain/AttestationHelper";
import { IBlockChain } from "../underlying-chain/interfaces/IBlockChain";
import { UnderlyingChainEvents } from "../underlying-chain/UnderlyingChainEvents";
import { ContractWithEvents } from "../utils/events/truffle";
import { ChainInfo } from "./ChainInfo";


export interface IAssetContext {
    chainInfo: ChainInfo;
    chain: IBlockChain;
    chainEvents: UnderlyingChainEvents;
    attestationProvider: AttestationHelper;
    // contracts
    assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>;
    ftsoRegistry: ContractWithEvents<FtsoRegistryMockInstance, FtsoRegistryMockEvents>;
    ftsoManager: ContractWithEvents<FtsoManagerMockInstance, FtsoManagerMockEvents>;
    wnat: ContractWithEvents<WNatInstance, WNatEvents>;
    natFtso: ContractWithEvents<FtsoMockInstance, FtsoMockEvents>;
    fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>;
    assetFtso: ContractWithEvents<FtsoMockInstance, FtsoMockEvents>;
    assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>;
}
