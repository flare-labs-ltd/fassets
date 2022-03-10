import { findEvent } from "flare-smart-contracts/test/utils/EventDecoder";
import { AgentVaultInstance, AssetManagerInstance } from "../../../typechain-truffle";
import { MockAttestationProvider } from "../../utils/fasset/MockAttestationProvider";
import { PaymentReference } from "../../utils/fasset/PaymentReference";
import { AssetContext } from "./AssetContext";

const AgentVault = artifacts.require('AgentVault');

export class Agent {
    constructor(
        public ctx: AssetContext,
        public owner: string,
        public vault: AgentVaultInstance,
        public address: string,
        public underlyingAddress: string,
    ) { }
    
    static async create(ctx: AssetContext, owner: string, underlyingAddress: string) {
        // mint some funds on underlying address (just enough to make EOA proof)
        ctx.chain.mint(underlyingAddress, 101);
        // create and prove transaction from underlyingAddress
        const tx = ctx.chain.addSimpleTransaction(underlyingAddress, underlyingAddress, 1, 100, PaymentReference.addressOwnership(owner));
        const proof = await ctx.attestationProvider.provePayment(tx.hash, underlyingAddress, underlyingAddress);
        await ctx.assetManager.proveUnderlyingAddressEOA(proof, { from: owner });
        // create agent
        const response = await ctx.assetManager.createAgent(underlyingAddress, { from: owner });
        // extract agent vault address from AgentCreated event
        const event = findEvent(response.logs, 'AgentCreated');
        assert.isNotNull(event, "Missing event AgentCreated");
        const agentVaultAddress = event!.args.agentVault;
        // get vault contract at this address
        const agentVault = await AgentVault.at(agentVaultAddress);
        // creater object
        return new Agent(ctx, owner, agentVault, agentVaultAddress, underlyingAddress);
    }
}
