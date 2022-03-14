import { filterEvents, findEvent } from "flare-smart-contracts/test/utils/EventDecoder";
import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { BN_ZERO, EventArgs, requiredEventArgs } from "../../utils/helpers";
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
    
    async requestRedemption(lots: number): Promise<[requests: EventArgs<RedemptionRequested>[], remainingLots: BN]> {
        const res = await this.assetManager.redeem(lots, this.underlyingAddress, { from: this.address });
        const redemptionRequests = filterEvents(res.logs, 'RedemptionRequested').map(e => e.args);
        const redemptionIncomplete = findEvent(res.logs, 'RedemptionRequestIncomplete')?.args;
        const remainingLots = redemptionIncomplete?.remainingLots ?? BN_ZERO;
        return [redemptionRequests, remainingLots];
    }
}
