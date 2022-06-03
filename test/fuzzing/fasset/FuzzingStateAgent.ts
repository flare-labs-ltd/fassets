import BN from "bn.js";
import {
    AgentAvailable, AvailableAgentExited, CollateralReservationDeleted, CollateralReserved, DustChanged, DustConvertedToTicket, MintingExecuted, MintingPaymentDefault,
    RedemptionDefault, RedemptionFinished, RedemptionPaymentBlocked, RedemptionPaymentFailed, RedemptionPerformed, RedemptionRequested, SelfClose
} from "../../../typechain-truffle/AssetManager";
import { NAT_WEI } from "../../integration/utils/AssetContext";
import { EvmEvent } from "../../utils/events";
import { BN_ZERO, formatBN, MAX_BIPS, sumBN, toBN } from "../../utils/helpers";
import { ILogger } from "../../utils/LogFile";
import { FuzzingState, Prices } from "./FuzzingState";
import { FuzzingStateComparator } from "./FuzzingStateComparator";
import { EvmEventArgs } from "./WrappedEvents";

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

type FreeUnderlyingBalanceChangeType = 'minting' | 'redemption' | 'self-close' | 'topup' | 'withdrawal';

export interface FreeUnderlyingBalanceChange {
    type: FreeUnderlyingBalanceChangeType,
    amountUBA: BN,
}

type ActionLogRecord = {
    text: string;
    event: EvmEvent;
};

const MAX_UINT256 = toBN(1).shln(256).subn(1);

export class FuzzingStateAgent {
    constructor(
        public parent: FuzzingState,
        public address: string,
        public owner: string,
        public underlyingAddressString: string,
    ) {
    }

    status: AgentStatus = AgentStatus.NORMAL;
    publiclyAvailable: boolean = false;
    feeBIPS: BN = BN_ZERO;
    agentMinCollateralRatioBIPS: BN = BN_ZERO;
    totalCollateralNATWei: BN = BN_ZERO;
    ccbStartTimestamp: BN = BN_ZERO;                // 0 - not in ccb/liquidation
    liquidationStartTimestamp: BN = BN_ZERO;        // 0 - not in liquidation
    announcedUnderlyingWithdrawalId: BN = BN_ZERO;  // 0 - not announced

    // aggregates
    reservedUBA: BN = BN_ZERO;
    mintedUBA: BN = BN_ZERO;
    redeemingUBA: BN = BN_ZERO;
    calculatedDustUBA: BN = BN_ZERO;
    reportedDustUBA: BN = BN_ZERO;
    freeUnderlyingBalanceUBA: BN = BN_ZERO;

    // collections
    collateralReservations: Map<number, CollateralReservation> = new Map();
    redemptionTickets: Map<number, RedemptionTicket> = new Map();
    redemptionRequests: Map<number, RedemptionRequest> = new Map();
    freeUnderlyingBalanceChanges: FreeUnderlyingBalanceChange[] = [];
    
    // log
    actionLog: Array<ActionLogRecord> = [];

    // handlers: agent availability

    handleAgentAvailable(args: EvmEventArgs<AgentAvailable>) {
        this.publiclyAvailable = true;
        this.agentMinCollateralRatioBIPS = toBN(args.agentMinCollateralRatioBIPS);
        this.feeBIPS = toBN(args.feeBIPS);
    }

    handleAvailableAgentExited(args: EvmEventArgs<AvailableAgentExited>) {
        this.publiclyAvailable = false;
    }

    // handlers: minting

    handleCollateralReserved(args: EvmEventArgs<CollateralReserved>) {
        const cr = this.addCollateralReservation(args);
        this.logAction(`new CollateralReservation(${cr.id}): amount=${formatBN(cr.valueUBA)} fee=${formatBN(cr.feeUBA)}`, args.$event);
    }

    handleMintingExecuted(args: EvmEventArgs<MintingExecuted>) {
        // update underlying free balance
        this.addFreeUnderlyingBalanceChange(args.$event, 'minting', toBN(args.receivedFeeUBA));
        // create redemption ticket
        const ticket = this.addRedemptionTicket(Number(args.redemptionTicketId), toBN(args.mintedAmountUBA));
        this.logAction(`new RedemptionTicket(${ticket.id}): amount=${formatBN(ticket.amountUBA)}`, args.$event);
        // delete collateral reservation
        const collateralReservationId = Number(args.collateralReservationId);
        if (collateralReservationId > 0) {  // collateralReservationId == 0 for self-minting
            this.deleteCollateralReservation(args.$event, collateralReservationId);
        }
    }

    handleMintingPaymentDefault(args: EvmEventArgs<MintingPaymentDefault>) {
        this.deleteCollateralReservation(args.$event, Number(args.collateralReservationId));
    }

    handleCollateralReservationDeleted(args: EvmEventArgs<CollateralReservationDeleted>) {
        this.deleteCollateralReservation(args.$event, Number(args.collateralReservationId));
    }

    // handlers: redemption and self-close

    handleRedemptionRequested(args: EvmEventArgs<RedemptionRequested>): void {
        const request = this.addRedemptionRequest(args);
        this.closeRedemptionTicketsWholeLots(args.$event, toBN(args.valueUBA));
        this.logAction(`new RedemptionRequest(${request.id}): amount=${formatBN(request.valueUBA)} fee=${formatBN(request.feeUBA)}`, args.$event);
    }

    handleRedemptionPerformed(args: EvmEventArgs<RedemptionPerformed>): void {
        const request = this.getRedemptionRequest(Number(args.requestId));
        this.releaseRedemptionCollateral(request);
        this.releaseClosedRedemptionRequests(args.$event, request);
    }

    handleRedemptionPaymentFailed(args: EvmEventArgs<RedemptionPaymentFailed>): void {
        // irrelevant to agent
    }

    handleRedemptionPaymentBlocked(args: EvmEventArgs<RedemptionPaymentBlocked>): void {
        const request = this.getRedemptionRequest(Number(args.requestId));
        this.releaseRedemptionCollateral(request);
        this.releaseClosedRedemptionRequests(args.$event, request);
    }

    handleRedemptionDefault(args: EvmEventArgs<RedemptionDefault>): void {
        const request = this.getRedemptionRequest(Number(args.requestId));
        this.releaseRedemptionCollateral(request);
        this.releaseClosedRedemptionRequests(args.$event, request);
    }

    handleRedemptionFinished(args: EvmEventArgs<RedemptionFinished>): void {
        const request = this.getRedemptionRequest(Number(args.requestId));
        request.underlyingReleased = true;
        this.addFreeUnderlyingBalanceChange(args.$event, 'redemption', toBN(args.freedUnderlyingBalanceUBA));
        this.releaseClosedRedemptionRequests(args.$event, request);
    }

    handleSelfClose(args: EvmEventArgs<SelfClose>): void {
        this.closeRedemptionTicketsAnyAmount(args.$event, toBN(args.valueUBA));
        this.addFreeUnderlyingBalanceChange(args.$event, 'self-close', toBN(args.valueUBA));
    }

    // handlers: dust
    
    handleDustConvertedToTicket(args: EvmEventArgs<DustConvertedToTicket>): void {
        // create redemption ticket
        const ticket = this.newRedemptionTicket(Number(args.redemptionTicketId), toBN(args.valueUBA));
        this.redemptionTickets.set(ticket.id, ticket);
        // recalculate dust
        this.calculatedDustUBA = this.calculatedDustUBA.sub(toBN(args.valueUBA));
        this.logAction(`new RedemptionTicket(${ticket.id}) [from dust]: amount=${formatBN(ticket.amountUBA)} remaining_dust=${formatBN(this.calculatedDustUBA)}`, args.$event);
    }
    
    handleDustChanged(args: EvmEventArgs<DustChanged>): void {
        const change = args.dustUBA.sub(this.reportedDustUBA);
        this.reportedDustUBA = args.dustUBA;
        this.logAction(`dust changed by ${change}, new dust=${formatBN(this.reportedDustUBA)}`, args.$event);
    }
    
    handleStatusChange(status: AgentStatus, timestamp?: BN): void {
        if (timestamp && status === AgentStatus.NORMAL && this.status === AgentStatus.CCB) {
            this.ccbStartTimestamp = timestamp;
        }
        if (timestamp && (status === AgentStatus.NORMAL || status === AgentStatus.CCB) && (this.status === AgentStatus.LIQUIDATION || this.status === AgentStatus.FULL_LIQUIDATION)) {
            this.liquidationStartTimestamp = timestamp;
        }
        this.status = status;
    }
    
    // agent state changing

    depositCollateral(value: BN) {
        this.totalCollateralNATWei = this.totalCollateralNATWei.add(value);
    }

    withdrawCollateral(value: BN) {
        this.totalCollateralNATWei = this.totalCollateralNATWei.sub(value);
    }

    newCollateralReservation(args: EvmEventArgs<CollateralReserved>): CollateralReservation {
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

    addCollateralReservation(args: EvmEventArgs<CollateralReserved>) {
        const cr = this.newCollateralReservation(args);
        this.collateralReservations.set(cr.id, cr);
        this.reservedUBA = this.reservedUBA.add(cr.valueUBA);
        return cr;
    }

    deleteCollateralReservation(event: EvmEvent, crId: number) {
        const cr = this.collateralReservations.get(crId);
        if (!cr) assert.fail(`Invalid collateral reservation id ${crId}`);
        this.logAction(`delete CollateralReservation(${cr.id}): amount=${formatBN(cr.valueUBA)}`, event);
        this.reservedUBA = this.reservedUBA.sub(cr.valueUBA);
        this.collateralReservations.delete(crId);
    }

    newRedemptionTicket(ticketId: number, amountUBA: BN): RedemptionTicket {
        return {
            id: ticketId,
            agentVault: this.address,
            amountUBA: amountUBA
        };
    }
    
    addRedemptionTicket(ticketId: number, amountUBA: BN) {
        const ticket = this.newRedemptionTicket(ticketId, amountUBA);
        this.redemptionTickets.set(ticket.id, ticket);
        this.mintedUBA = this.mintedUBA.add(ticket.amountUBA);
        return ticket;
    }

    closeRedemptionTicketsWholeLots(event: EvmEvent, amountUBA: BN) {
        const lotSize = this.parent.lotSize();
        const tickets = Array.from(this.redemptionTickets.values());
        tickets.sort((a, b) => a.id - b.id);    // sort by ticketId, so that we close them in correct order
        const amountLots = amountUBA.div(lotSize);
        let remainingLots = amountLots;
        let count = 0;
        for (const ticket of tickets) {
            if (remainingLots.isZero()) break;
            const ticketLots = ticket.amountUBA.div(lotSize);
            const redeemLots = BN.min(remainingLots, ticketLots);
            const redeemUBA = redeemLots.mul(lotSize);
            remainingLots = remainingLots.sub(redeemLots);
            const newTicketAmountUBA = ticket.amountUBA.sub(redeemUBA);
            if (newTicketAmountUBA.lt(lotSize)) {
                this.calculatedDustUBA = this.calculatedDustUBA.add(newTicketAmountUBA);
                this.logAction(`delete RedemptionTicket(${ticket.id}): amount=${formatBN(ticket.amountUBA)} created_dust=${formatBN(newTicketAmountUBA)}`, event);
                this.redemptionTickets.delete(ticket.id);
            } else {
                ticket.amountUBA = newTicketAmountUBA;
                this.logAction(`partial redeemption RedemptionTicket(${ticket.id}): old_amount=${formatBN(ticket.amountUBA)} new_amount=${formatBN(newTicketAmountUBA)}`, event);
            }
            ++count;
        }
        const redeemedLots = amountLots.sub(remainingLots);
        const redeemedUBA = redeemedLots.mul(lotSize);
        this.mintedUBA = this.mintedUBA.sub(redeemedUBA);
        const remainingUBA = amountUBA.sub(redeemedUBA);
        this.logAction(`redeemed ${count} tickets, ${redeemedLots} lots, remainingUBA=${formatBN(remainingUBA)}, lotSize=${formatBN(lotSize)}`, event);
    }

    closeRedemptionTicketsAnyAmount(event: EvmEvent, amountUBA: BN) {
        const lotSize = this.parent.lotSize();
        const tickets = Array.from(this.redemptionTickets.values());
        tickets.sort((a, b) => a.id - b.id);    // sort by ticketId, so that we close them in correct order
        let remainingUBA = amountUBA;
        // redeem dust
        const redeemedDust = BN.min(remainingUBA, this.calculatedDustUBA);
        this.calculatedDustUBA = this.calculatedDustUBA.sub(redeemedDust);
        remainingUBA = remainingUBA.sub(redeemedDust);
        // redeem tickets
        let count = 0;
        for (const ticket of tickets) {
            if (remainingUBA.isZero()) break;
            const redeemUBA = BN.min(remainingUBA, ticket.amountUBA);
            remainingUBA = remainingUBA.sub(redeemUBA);
            const newTicketAmountUBA = ticket.amountUBA.sub(redeemUBA);
            if (newTicketAmountUBA.lt(lotSize)) {
                this.calculatedDustUBA = this.calculatedDustUBA.add(newTicketAmountUBA);
                this.logAction(`delete RedemptionTicket(${ticket.id}): amount=${formatBN(ticket.amountUBA)} created_dust=${formatBN(newTicketAmountUBA)}`, event);
                this.redemptionTickets.delete(ticket.id);
            } else {
                ticket.amountUBA = newTicketAmountUBA;
                this.logAction(`partial redeemption RedemptionTicket(${ticket.id}): old_amount=${formatBN(ticket.amountUBA)} new_amount=${formatBN(newTicketAmountUBA)}`, event);
            }
            ++count;
        }
        const redeemedUBA = amountUBA.sub(remainingUBA);
        this.mintedUBA = this.mintedUBA.sub(redeemedUBA);
        this.logAction(`redeemed (any amount) ${count} tickets, redeemed=${formatBN(redeemedUBA)}, remainingUBA=${formatBN(remainingUBA)}, lotSize=${formatBN(lotSize)}`, event);
    }
    
    newRedemptionRequest(args: EvmEventArgs<RedemptionRequested>): RedemptionRequest {
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
    
    addRedemptionRequest(args: EvmEventArgs<RedemptionRequested>) {
        const request = this.newRedemptionRequest(args);
        this.redemptionRequests.set(request.id, request);
        this.redeemingUBA = this.redeemingUBA.add(request.valueUBA);
        return request;
    }

    getRedemptionRequest(requestId: number) {
        return this.redemptionRequests.get(requestId) ?? assert.fail(`Invalid redemption request id ${requestId}`);
    }

    releaseRedemptionCollateral(request: RedemptionRequest) {
        request.collateralReleased = true;
        this.redeemingUBA = this.redeemingUBA.sub(request.valueUBA);
    }

    releaseClosedRedemptionRequests(event: EvmEvent, request: RedemptionRequest) {
        if (request.collateralReleased && request.underlyingReleased) {
            this.redemptionRequests.delete(request.id);
            this.logAction(`delete RedemptionRequest(${request.id}): amount=${formatBN(request.valueUBA)}`, event);
        }
    }

    addFreeUnderlyingBalanceChange(event: EvmEvent, type: FreeUnderlyingBalanceChangeType, amountUBA: BN) {
        const change: FreeUnderlyingBalanceChange = { type, amountUBA };
        this.freeUnderlyingBalanceChanges.push(change);
        this.freeUnderlyingBalanceUBA = this.freeUnderlyingBalanceUBA.add(amountUBA);
        this.logAction(`new FreeUnderlyingBalanceChange(${type}): amount=${formatBN(amountUBA)}`, event);
    }

    logAction(text: string, event: EvmEvent) {
        this.actionLog.push({ text, event });
    }

    // totals

    calculateReservedUBA() {
        return sumBN(this.collateralReservations.values(), ticket => ticket.valueUBA);
    }

    calculateMintedUBA() {
        return sumBN(this.redemptionTickets.values(), ticket => ticket.amountUBA).add(this.reportedDustUBA);
    }

    calculateFreeUnderlyingBalanceUBA() {
        return sumBN(this.freeUnderlyingBalanceChanges, change => change.amountUBA);
    }
    
    // calculations
    
    name() {
        return this.parent.eventFormatter.formatAddress(this.address);
    }

    private collateralRatioForPriceBIPS(amgToNATWeiPrice: BN) {
        if (this.mintedUBA.isZero()) return MAX_UINT256;
        const reservedUBA = this.reservedUBA.add(this.redeemingUBA)
        const reservedCollateral = this.parent.context.convertUBAToNATWei(reservedUBA, amgToNATWeiPrice)
            .mul(toBN(this.parent.settings.minCollateralRatioBIPS)).divn(MAX_BIPS);
        const availableCollateral = BN.max(this.totalCollateralNATWei.sub(reservedCollateral), BN_ZERO);
        const backingCollateral = this.parent.context.convertUBAToNATWei(this.mintedUBA, amgToNATWeiPrice);
        return availableCollateral.muln(MAX_BIPS).div(backingCollateral);
    }

    collateralRatioBIPS() {
        const ratio = this.collateralRatioForPriceBIPS(this.parent.amgPriceNatWei);
        const ratioFromTrusted = this.collateralRatioForPriceBIPS(this.parent.amgPriceNatWeiFromTrusted);
        return BN.max(ratio, ratioFromTrusted);
    }

    private collateralRatioForPrice(prices: Prices) {
        if (this.mintedUBA.isZero()) return Number.MAX_VALUE;
        const assetUnitUBA = Number(this.parent.settings.assetUnitUBA);
        const reserved = (Number(this.reservedUBA) + Number(this.redeemingUBA)) / assetUnitUBA;
        const minCollateralRatio = Number(this.parent.settings.minCollateralRatioBIPS) / MAX_BIPS;
        const reservedCollateral = reserved * prices.assetNat * minCollateralRatio;
        const totalCollateral = Number(this.totalCollateralNATWei) / Number(NAT_WEI);
        const availableCollateral = Math.max(totalCollateral - reservedCollateral, 0);
        const backingCollateral = Number(this.mintedUBA) / assetUnitUBA * prices.assetNat;
        return availableCollateral / backingCollateral;
    }
    
    collateralRatio() {
        const ratio = this.collateralRatioForPrice(this.parent.prices);
        const ratioFromTrusted = this.collateralRatioForPrice(this.parent.trustedPrices);
        return Math.max(ratio, ratioFromTrusted);
    }

    // checking

    async checkInvariants(checker: FuzzingStateComparator) {
        const agentName = this.name();
        // get actual agent state
        const agentInfo = await this.parent.context.assetManager.getAgentInfo(this.address);
        let problems = 0;
        // reserved
        const reservedUBA = this.calculateReservedUBA();
        problems += checker.checkEquality(`${agentName}.reservedUBA`, agentInfo.reservedUBA, reservedUBA);
        problems += checker.checkEquality(`${agentName}.reservedUBA.cumulative`, this.reservedUBA, reservedUBA);
        // minted
        const mintedUBA = this.calculateMintedUBA();
        problems += checker.checkEquality(`${agentName}.mintedUBA`, agentInfo.mintedUBA, mintedUBA);
        problems += checker.checkEquality(`${agentName}.mintedUBA.cumulative`, this.mintedUBA, mintedUBA);
        // free balance
        const freeUnderlyingBalanceUBA = this.calculateFreeUnderlyingBalanceUBA();
        problems += checker.checkEquality(`${agentName}.underlyingFreeBalanceUBA`, agentInfo.freeUnderlyingBalanceUBA, freeUnderlyingBalanceUBA);
        problems += checker.checkEquality(`${agentName}.underlyingFreeBalanceUBA.cumulative`, this.freeUnderlyingBalanceUBA, freeUnderlyingBalanceUBA);
        // minimum underlying backing (TODO: check that all illegel payments have been challenged already)
        const underlyingBalanceUBA = await this.parent.context.chain.getBalance(this.underlyingAddressString);
        problems += checker.checkNumericDifference(`${agentName}.underlyingBalanceUBA`, underlyingBalanceUBA, 'gte', mintedUBA.add(freeUnderlyingBalanceUBA));
        // dust
        problems += checker.checkEquality(`${agentName}.dustUBA`, this.reportedDustUBA, this.calculatedDustUBA);
        // status
        const statusProblem = checker.checkEquality(`${agentName}.status`, agentInfo.status, this.status);
        if (statusProblem != 0 && !(this.status === AgentStatus.CCB && Number(agentInfo.status) === AgentStatus.LIQUIDATION)) {
            // transition CCB->LIQUIDATION can happen due to timing (without event) so it's not a problem
            problems += statusProblem;
        }
        // log
        if (problems > 0) {
            this.writeActionLog(checker.logger);
        }
    }
    
    writeActionLog(logger: ILogger) {
        logger.log(`    action log for ${this.name()}`);
        for (const log of this.actionLog) {
            const eventInfo = `event=${log.event.event} at ${log.event.blockNumber}.${log.event.logIndex}`;
            logger.log(`        ${log.text}  ${eventInfo}`);
        }
    }
}
