import BN from "bn.js";
import { AgentAvailable, AllEvents, AvailableAgentExited, CollateralReservationDeleted, CollateralReserved, MintingExecuted, MintingPaymentDefault, RedemptionDefault, RedemptionFinished, RedemptionPaymentBlocked, RedemptionPaymentFailed, RedemptionPerformed, RedemptionRequested, SelfClose } from "../../../typechain-truffle/AssetManager";
import { EventArgs, ExtractedEventArgs } from "../../utils/events";
import { BN_ZERO, formatBN, sumBN, toBN } from "../../utils/helpers";
import { FuzzingState } from "./FuzzingState";

// status as returned from getAgentInfo
export enum AgentStatus {
    NORMAL = 0,             // agent is operating normally
    CCB = 1,                // agent in collateral call band
    LIQUIDATION = 2,        // liquidation due to collateral ratio - ends when agent is healthy
    FULL_LIQUIDATION = 3,   // illegal payment liquidation - always liquidates all and then agent must close vault
    DESTROYING = 4,         // agent announced destroy, cannot mint again; all existing mintings have been redeemed before
}

export interface CollateralReservation {
    id: number;
    agentVault: string;
    minter: string;
    valueUBA: BN;
    feeUBA: BN;
    lastUnderlyingBlock: BN;
    lastUnderlyingTimestamp: BN;
    paymentAddress: string;
    paymentReference: string;
}

export interface RedemptionTicket {
    id: number;
    agentVault: string;
    amountUBA: BN;
}

export interface RedemptionRequest {
    id: number;
    agentVault: string;
    valueUBA: BN;
    feeUBA: BN;
    lastUnderlyingBlock: BN;
    lastUnderlyingTimestamp: BN;
    paymentAddress: string;
    paymentReference: string;
    // stateful part
    collateralReleased: boolean;
    underlyingReleased: boolean;
}

export interface FreeUnderlyingBalanceChange {
    type: 'minting' | 'redemption' | 'self-close' | 'topup' | 'withdrawal',
    amountUBA: BN,
}

export class FuzzingStateAgent {
    constructor(
        public parent: FuzzingState,
        public owner: string,
        public address: string,
        public underlyingAddressString: string,
    ) {
    }
    
    status: AgentStatus = AgentStatus.NORMAL;
    publiclyAvailable: boolean = false;
    feeBIPS: BN = BN_ZERO;
    agentMinCollateralRatioBIPS: BN = BN_ZERO;
    totalCollateralNATWei: BN = BN_ZERO;
    dustUBA: BN = BN_ZERO;
    ccbStartTimestamp: BN = BN_ZERO;                // 0 - not in ccb/liquidation
    liquidationStartTimestamp: BN = BN_ZERO;        // 0 - not in liquidation
    announcedUnderlyingWithdrawalId: BN = BN_ZERO;  // 0 - not announced
    
    // collections
    collateralReservations: Map<number, CollateralReservation> = new Map();
    redemptionTickets: Map<number, RedemptionTicket> = new Map();
    redemptionRequests: Map<number, RedemptionRequest> = new Map();
    freeUnderlyingBalanceChanges: FreeUnderlyingBalanceChange[] = [];

    // handlers: agent availability
    
    handleAgentAvailable(args: EventArgs<AgentAvailable>) {
        this.publiclyAvailable = true;
        this.agentMinCollateralRatioBIPS = toBN(args.agentMinCollateralRatioBIPS);
        this.feeBIPS = toBN(args.feeBIPS);
    }
    
    handleAvailableAgentExited(args: EventArgs<AvailableAgentExited>) {
        this.publiclyAvailable = false;
    }
    
    // handlers: minting
    
    handleCollateralReserved(args: EventArgs<CollateralReserved>) {
        const cr = this.newCollateralReservation(args);
        this.collateralReservations.set(cr.id, cr);
    }
    
    handleMintingExecuted(args: EventArgs<MintingExecuted>) {
        // update underlying free balance
        this.freeUnderlyingBalanceChanges.push({ type: 'minting', amountUBA: toBN(args.receivedFeeUBA) });
        // create redemption ticket
        const ticket = this.newRedemptionTicket(args.redemptionTicketId, toBN(args.mintedAmountUBA));
        this.redemptionTickets.set(ticket.id, ticket);
        // delete collateral reservation
        const collateralReservationId = Number(args.collateralReservationId);
        if (collateralReservationId > 0) {  // collateralReservationId == 0 for self-minting
            this.deleteCollateralReservation(collateralReservationId);
        }
    }
    
    handleMintingPaymentDefault(args: EventArgs<MintingPaymentDefault>) {
        this.deleteCollateralReservation(Number(args.collateralReservationId));
    }
    
    handleCollateralReservationDeleted(args: EventArgs<CollateralReservationDeleted>) {
        this.deleteCollateralReservation(Number(args.collateralReservationId));
    }
    
    // handlers: redemption and self-close

    handleRedemptionRequested(args: EventArgs<RedemptionRequested>): void {
        const request = this.newRedemptionRequest(args);
        this.redemptionRequests.set(request.id, request);
    }
    
    handleRedemptionPerformed(args: EventArgs<RedemptionPerformed>): void {
        const request = this.getRedemptionRequest(Number(args.requestId));
        request.collateralReleased = true;
        this.releaseClosedRedemptionRequests(request);
    }

    handleRedemptionPaymentFailed(args: EventArgs<RedemptionPaymentFailed>): void {
        // irrelevant to agent
    }

    handleRedemptionPaymentBlocked(args: EventArgs<RedemptionPaymentBlocked>): void {
        const request = this.getRedemptionRequest(Number(args.requestId));
        request.collateralReleased = true;
        this.releaseClosedRedemptionRequests(request);
    }

    handleRedemptionDefault(args: EventArgs<RedemptionDefault>): void {
        const request = this.getRedemptionRequest(Number(args.requestId));
        request.collateralReleased = true;
        this.releaseClosedRedemptionRequests(request);
    }

    handleRedemptionFinished(args: EventArgs<RedemptionFinished>): void {
        const request = this.getRedemptionRequest(Number(args.requestId));
        request.underlyingReleased = true;
        this.freeUnderlyingBalanceChanges.push({ type: 'redemption', amountUBA: toBN(args.freedUnderlyingBalanceUBA) });
        this.releaseClosedRedemptionRequests(request);
    }
    
    handleSelfClose(args: EventArgs<SelfClose>): void {
        this.freeUnderlyingBalanceChanges.push({ type: 'self-close', amountUBA: toBN(args.valueUBA) });
    }
    
    // agent state changing
    
    depositCollateral(value: BN) {
        this.totalCollateralNATWei = this.totalCollateralNATWei.add(value);
    }

    withdrawCollateral(value: BN) {
        this.totalCollateralNATWei = this.totalCollateralNATWei.sub(value);
    }
    
    newCollateralReservation(args: EventArgs<CollateralReserved>): CollateralReservation {
        return {
            id: Number(args.collateralReservationId),
            agentVault: args.agentVault,
            minter: args.minter,
            valueUBA: toBN(args.valueUBA),
            feeUBA: toBN(args.feeUBA),
            lastUnderlyingBlock: toBN(args.lastUnderlyingBlock),
            lastUnderlyingTimestamp: toBN(args.lastUnderlyingTimestamp),
            paymentAddress: args.paymentAddress,
            paymentReference: args.paymentReference,
        };
    }

    deleteCollateralReservation(crId: number) {
        const deleted = this.collateralReservations.delete(crId);
        assert.isTrue(deleted, `Invalid collateral reservation id ${crId}`);
    }

    newRedemptionTicket(ticketId: BN, mintedAmountUBA: BN): RedemptionTicket {
        return {
            id: Number(ticketId),
            agentVault: this.address,
            amountUBA: mintedAmountUBA
        };
    }
    
    newRedemptionRequest(args: EventArgs<RedemptionRequested>): RedemptionRequest {
        return {
            id: Number(args.requestId),
            agentVault: args.agentVault,
            valueUBA: toBN(args.valueUBA),
            feeUBA: toBN(args.feeUBA),
            lastUnderlyingBlock: toBN(args.lastUnderlyingBlock),
            lastUnderlyingTimestamp: toBN(args.lastUnderlyingTimestamp),
            paymentAddress: args.paymentAddress,
            paymentReference: args.paymentReference,
            collateralReleased: false,
            underlyingReleased: false,
        };
    }

    getRedemptionRequest(requestId: number) {
        return this.redemptionRequests.get(requestId) ?? assert.fail(`Invalid redemption request id ${requestId}`);
    }
    
    releaseClosedRedemptionRequests(request: RedemptionRequest) {
        if (request.collateralReleased && request.underlyingReleased) {
            this.redemptionRequests.delete(request.id);
        }
    }
    
    // totals
    
    reservedUBA() {
        return sumBN(this.collateralReservations.values(), ticket => ticket.valueUBA);
    }
    
    mintedUBA() {
        return sumBN(this.redemptionTickets.values(), ticket => ticket.amountUBA);
    }
    
    freeUnderlyingBalanceUBA() {
        return sumBN(this.freeUnderlyingBalanceChanges, change => change.amountUBA);
    }
    
    // checking
    
    async checkInvariants(log: string[]): Promise<number> {
        let differences = 0;
        // get actual agent state
        const agentInfo = await this.parent.context.assetManager.getAgentInfo(this.address);
        // reserved
        const reservedUBA = this.reservedUBA();
        differences += this.parent.checkEquality(log, `${this.address}.reservedUBA`, agentInfo.reservedUBA, reservedUBA);
        // minted
        const mintedUBA = this.mintedUBA();
        differences += this.parent.checkEquality(log, `${this.address}.mintedUBA`, agentInfo.mintedUBA, mintedUBA);
        // free balance
        const freeUnderlyingBalanceUBA = this.freeUnderlyingBalanceUBA();
        differences += this.parent.checkEquality(log, `${this.address}.underlyingFreeBalanceUBA`, agentInfo.freeUnderlyingBalanceUBA, freeUnderlyingBalanceUBA);
        // minimum underlying backing (TODO: check that all illegel payments have been challenged already)
        const underlyingBalanceUBA = await this.parent.context.chain.getBalance(this.underlyingAddressString);
        const expectedMinUnderlyingBalanceUBA = mintedUBA.add(freeUnderlyingBalanceUBA);
        if (underlyingBalanceUBA.lt(expectedMinUnderlyingBalanceUBA)) {
            log.push(`${this.address}.underlying balance too small: expected at least ${formatBN(expectedMinUnderlyingBalanceUBA)}, actual ${formatBN(underlyingBalanceUBA)}, diff=${formatBN(underlyingBalanceUBA.sub(expectedMinUnderlyingBalanceUBA))}`);
            ++differences;
        }
        //
        return differences;
    }
    
}
