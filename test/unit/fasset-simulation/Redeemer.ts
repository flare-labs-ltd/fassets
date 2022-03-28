import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { EventArgs, filterEvents, findEvent, requiredEventArgs } from "../../utils/events";
import { BN_ZERO } from "../../utils/helpers";
import { AssetContext, AssetContextClient } from "./AssetContext";

export class Redeemer extends AssetContextClient {
    constructor(
        context: AssetContext,
        public address: string,
        public underlyingAddress: string
    ) {
        super(context);
    }
    
    static async create(ctx: AssetContext, address: string, underlyingAddress: string) {
        return new Redeemer(ctx, address, underlyingAddress);
    }
    
    async requestRedemption(lots: number): Promise<[requests: EventArgs<RedemptionRequested>[], remainingLots: BN, dustChangesUBA: BN[]]> {
        const res = await this.assetManager.redeem(lots, this.underlyingAddress, { from: this.address });
        const redemptionRequests = filterEvents(res.logs, 'RedemptionRequested').map(e => e.args);
        const redemptionIncomplete = findEvent(res.logs, 'RedemptionRequestIncomplete')?.args;
        const dustChangedEvents = filterEvents(res.logs, 'DustChanged').map(e => e.args);
        const remainingLots = redemptionIncomplete?.remainingLots ?? BN_ZERO;
        return [redemptionRequests, remainingLots, dustChangedEvents.map(dc => dc.dustUBA)];
    }

    async redemptionPaymentDefault(request: EventArgs<RedemptionRequested>) {
        const proof = await this.attestationProvider.proveReferencedPaymentNonexistence(
            request.paymentAddress,
            request.paymentReference,
            request.valueUBA.sub(request.feeUBA),
            request.lastUnderlyingBlock.toNumber(),
            request.lastUnderlyingTimestamp.toNumber());
        const res = await this.assetManager.redemptionPaymentDefault(proof, request.requestId, { from: this.address });
        return requiredEventArgs(res, 'RedemptionDefault');
    }
}
