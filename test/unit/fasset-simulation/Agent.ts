import { AgentVaultInstance } from "../../../typechain-truffle";
import { PaymentReference } from "../../utils/fasset/PaymentReference";
import { BNish, findRequiredEvent, toBN } from "../../utils/helpers";
import { AssetContext } from "./AssetContext";

const AgentVault = artifacts.require('AgentVault');

export class Agent {
    constructor(
        public context: AssetContext,
        public address: string,
        public agentVault: AgentVaultInstance,
        public agentAddress: string,
        public underlyingAddress: string,
    ) {
    }
    
    private assetManager = this.context.assetManager;
    
    static async create(ctx: AssetContext, ownerAddress: string, underlyingAddress: string) {
        // mint some funds on underlying address (just enough to make EOA proof)
        ctx.chain.mint(underlyingAddress, 1);
        // create and prove transaction from underlyingAddress
        const tx = ctx.chain.addSimpleTransaction(underlyingAddress, underlyingAddress, 1, 0, PaymentReference.addressOwnership(ownerAddress));
        const proof = await ctx.attestationProvider.provePayment(tx.hash, underlyingAddress, underlyingAddress);
        await ctx.assetManager.proveUnderlyingAddressEOA(proof, { from: ownerAddress });
        // create agent
        const response = await ctx.assetManager.createAgent(underlyingAddress, { from: ownerAddress });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        const agentVaultAddress = event.args.agentVault;
        // get vault contract at this address
        const agentVault = await AgentVault.at(agentVaultAddress);
        // creater object
        return new Agent(ctx, ownerAddress, agentVault, agentVaultAddress, underlyingAddress);
    }
    
    async depositCollateral(amount: BNish) {
        await this.agentVault.deposit({ from: this.address, value: toBN(amount) });
    }
    
    async makeAvailable(feeBIPS: BNish, collateralRatioBIPS: BNish) {
        await this.assetManager.makeAgentAvailable(this.agentAddress, feeBIPS, collateralRatioBIPS, { from: this.address });
    }
}
