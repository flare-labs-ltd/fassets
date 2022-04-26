import { AgentVaultInstance, AssetManagerInstance } from "../../../typechain-truffle";
import { Agent } from "../../integration/utils/Agent";
import { AssetContext } from "../../integration/utils/AssetContext";
import { BaseEvent, eventIs, truffleEventSource, TruffleEventSourceFromMethodResponse } from "../../utils/events";
import { IChainWallet } from "../../utils/fasset/ChainInterfaces";

export type AssetManagerEventSource = TruffleEventSourceFromMethodResponse<AssetManagerInstance, 'updateSettings'>;

export class FuzzingAgent extends Agent {
    static byVaultAddress: Map<string, FuzzingAgent> = new Map();
    static byUnderlyingAddress: Map<string, FuzzingAgent> = new Map();
    
    constructor(
        context: AssetContext,
        ownerAddress: string,
        agentVault: AgentVaultInstance,
        underlyingAddress: string,
        wallet: IChainWallet,
    ) {
        super(context, ownerAddress, agentVault, underlyingAddress, wallet);
        FuzzingAgent.byVaultAddress.set(agentVault.address, this);
        FuzzingAgent.byUnderlyingAddress.set(underlyingAddress, this);
    }
    
    static dispatchEvent(context: AssetContext, event: BaseEvent) {
        const assetManagerEvents = truffleEventSource<AssetManagerEventSource>(context.assetManager);
        if (eventIs(event, assetManagerEvents, 'RedemptionRequested')) {
            
        }
    }
}
