import { CollateralReserved } from "../../../typechain-truffle/AssetManager";
import { EventArgs, requiredEventArgs } from "../../utils/events";
import { AssetContext, AssetContextClient } from "./AssetContext";

export class Minter extends AssetContextClient {
    constructor(
        context: AssetContext,
        public address: string,
        public underlyingAddress: string
    ) {
        super(context);
    }
    
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
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        return this.chain.addSimpleTransaction(this.underlyingAddress, crt.paymentAddress, paymentAmount, 0, crt.paymentReference);
    }
    
    async executeMinting(crt: EventArgs<CollateralReserved>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, crt.paymentAddress);
        const res = await this.assetManager.executeMinting(proof, crt.collateralReservationId, { from: this.address });
        return requiredEventArgs(res, 'MintingExecuted');
    }
}
