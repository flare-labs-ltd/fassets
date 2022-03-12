import { CollateralReserved } from "../../../typechain-truffle/AssetManager";
import { EventArgs, requiredEventArgs } from "../../utils/helpers";
import { AssetContext } from "./AssetContext";

export class Minter {
    constructor(
        public context: AssetContext,
        public address: string,
        public underlyingAddress: string
    ) {
    }
    
    private assetManager = this.context.assetManager;
    private chain = this.context.chain;
    private attestationProvider = this.context.attestationProvider;

    static async create(ctx: AssetContext, address: string, underlyingAddress: string, underlyingBalance: BN) {
        ctx.chain.mint(underlyingAddress, underlyingBalance);
        return new Minter(ctx, address, underlyingAddress);
    }
    
    async reserveCollateral(agent: string, lots: number) {
        const crFee = await this.assetManager.collateralReservationFee(lots);
        const res = await this.assetManager.reserveCollateral(agent, lots, { from: this.address, value: crFee });
        return requiredEventArgs(res, 'CollateralReserved');
    }
    
    async performMintingPayment(crt: EventArgs<CollateralReserved>) {
        const paymentAmount = crt.underlyingValueUBA.add(crt.underlyingFeeUBA);
        return this.chain.addSimpleTransaction(this.underlyingAddress, crt.paymentAddress, paymentAmount, 0, crt.paymentReference);
    }
    
    async executeMinting(crt: EventArgs<CollateralReserved>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, crt.paymentAddress);
        const res = await this.assetManager.executeMinting(proof, crt.collateralReservationId, { from: this.address });
        return requiredEventArgs(res, 'MintingExecuted');
    }
}
