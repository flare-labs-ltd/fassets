import { AssetContextClient, AssetContext } from "../../integration/utils/AssetContext";
import { Minter } from "../../integration/utils/Minter";
import { Redeemer } from "../../integration/utils/Redeemer";
import { IChainWallet } from "../../utils/fasset/ChainInterfaces";
import { MockChain, MockChainWallet } from "../../utils/fasset/MockChain";

export class FuzzingCustomer extends AssetContextClient {
    minter: Minter;
    redeemer: Redeemer;
    
    constructor(
        context: AssetContext,
        public address: string,
        public underlyingAddress: string,
        public wallet: IChainWallet,
    ) {
        super(context);
        this.minter = new Minter(context, address, underlyingAddress, wallet);
        this.redeemer = new Redeemer(context, address, underlyingAddress);
    }
    
    static async createTest(ctx: AssetContext, address: string, underlyingAddress: string, underlyingBalance: BN) {
        if (!(ctx.chain instanceof MockChain)) assert.fail("only for mock chains");
        ctx.chain.mint(underlyingAddress, underlyingBalance);
        const wallet = new MockChainWallet(ctx.chain);
        return new FuzzingCustomer(ctx, address, underlyingAddress, wallet);
    }
}
