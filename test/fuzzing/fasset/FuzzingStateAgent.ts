import BN from "bn.js";
import { AgentInfo, AgentStatus, CollateralToken, CollateralTokenClass } from "../../../lib/fasset/AssetManagerTypes";
import { NAT_WEI } from "../../../lib/fasset/Conversions";
import { Prices } from "../../../lib/state/Prices";
import { EvmEvent } from "../../../lib/utils/events/common";
import { EvmEventArgs } from "../../../lib/utils/events/IEvmEvents";
import { BN_ZERO, formatBN, latestBlockTimestamp, minBN, sumBN, toBN } from "../../../lib/utils/helpers";
import { ILogger } from "../../../lib/utils/logging";
import {
    AgentAvailable, AvailableAgentExited, CollateralReservationDeleted, CollateralReserved, DustChanged, DustConvertedToTicket, LiquidationPerformed, MintingExecuted, MintingPaymentDefault,
    RedemptionDefault, RedemptionPaymentBlocked, RedemptionPaymentFailed, RedemptionPerformed, RedemptionRequested, SelfClose, UnderlyingBalanceToppedUp, UnderlyingWithdrawalAnnounced, UnderlyingWithdrawalCancelled, UnderlyingWithdrawalConfirmed
} from "../../../typechain-truffle/AssetManager";
import { InitialAgentData, TrackedAgentState } from "../../../lib/state/TrackedAgentState";
import { FuzzingState, FuzzingStateLogRecord } from "./FuzzingState";
import { FuzzingStateComparator } from "./FuzzingStateComparator";
import { ITransaction } from "../../../lib/underlying-chain/interfaces/IBlockChain";

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

type UnderlyingBalanceChangeType = 'minting' | 'redemption' | 'topup' | 'withdrawal';

export interface UnderlyingBalanceChange {
    type: UnderlyingBalanceChangeType,
    amountUBA: BN,
}

const CollateralPool = artifacts.require("CollateralPool");

export class FuzzingStateAgent extends TrackedAgentState {
    constructor(
        parent: FuzzingState,
        data: InitialAgentData,
    ) {
        super(parent, data);
        void CollateralPool.at(data.collateralPool).then(cp => cp.poolToken()).then(poolToken => this.poolTokenAddress = poolToken);
        this.parent = parent;   // override parent type
    }

    override parent: FuzzingState;

    poolTokenAddress?: string;

    // aggregates
    calculatedDustUBA: BN = BN_ZERO;
    totalAgentPoolTokensWei: BN = BN_ZERO;

    // collections
    collateralReservations: Map<number, CollateralReservation> = new Map();
    redemptionTickets: Map<number, RedemptionTicket> = new Map();
    redemptionRequests: Map<number, RedemptionRequest> = new Map();
    underlyingBalanceChanges: UnderlyingBalanceChange[] = [];

    // log
    actionLog: FuzzingStateLogRecord[] = [];

    // init

    override initializeState(agentInfo: AgentInfo) {
        super.initializeState(agentInfo);
        this.calculatedDustUBA = toBN(agentInfo.dustUBA);
        this.totalAgentPoolTokensWei = toBN(agentInfo.totalAgentPoolTokensWei);
    }

    // handlers: agent availability

    override handleAgentAvailable(args: EvmEventArgs<AgentAvailable>) {
        super.handleAgentAvailable(args);
    }

    override handleAvailableAgentExited(args: EvmEventArgs<AvailableAgentExited>) {
        super.handleAvailableAgentExited(args);
    }

    // handlers: minting

    override handleCollateralReserved(args: EvmEventArgs<CollateralReserved>) {
        super.handleCollateralReserved(args);
        this.addCollateralReservation(args);
    }

    override handleMintingExecuted(args: EvmEventArgs<MintingExecuted>) {
        super.handleMintingExecuted(args);
        // update underlying free balance
        const depositUBA = toBN(args.mintedAmountUBA).add(args.agentFeeUBA).add(args.poolFeeUBA);
        this.addUnderlyingBalanceChange(args.$event, 'minting', depositUBA);
        // only whole number of lots will be created as ticket, the remainder is accounted as dust
        const mintedAmount = toBN(args.mintedAmountUBA).add(toBN(args.poolFeeUBA));
        const amountWithDust = mintedAmount.add(this.calculatedDustUBA);
        this.calculatedDustUBA = amountWithDust.mod(this.parent.lotSize());
        const ticketAmountUBA = amountWithDust.sub(this.calculatedDustUBA);
        // create redemption ticket
        this.addRedemptionTicket(args.$event, Number(args.redemptionTicketId), ticketAmountUBA);
        // delete collateral reservation
        const collateralReservationId = Number(args.collateralReservationId);
        if (collateralReservationId > 0) {  // collateralReservationId == 0 for self-minting
            this.deleteCollateralReservation(args.$event, collateralReservationId);
        }
    }

    override handleMintingPaymentDefault(args: EvmEventArgs<MintingPaymentDefault>) {
        super.handleMintingPaymentDefault(args);
        this.deleteCollateralReservation(args.$event, Number(args.collateralReservationId));
    }

    override handleCollateralReservationDeleted(args: EvmEventArgs<CollateralReservationDeleted>) {
        super.handleCollateralReservationDeleted(args);
        this.deleteCollateralReservation(args.$event, Number(args.collateralReservationId));
    }

    // handlers: redemption and self-close

    override handleRedemptionRequested(args: EvmEventArgs<RedemptionRequested>): void {
        super.handleRedemptionRequested(args);
        // create request and close tickets
        const request = this.addRedemptionRequest(args);
        this.closeRedemptionTicketsWholeLots(args.$event, toBN(args.valueUBA));
        this.logAction(`new RedemptionRequest(${request.id}): amount=${formatBN(request.valueUBA)} fee=${formatBN(request.feeUBA)}`, args.$event);
    }

    override handleRedemptionPerformed(args: EvmEventArgs<RedemptionPerformed>): void {
        super.handleRedemptionPerformed(args);
        this.confirmRedemptionPayment('performed', args)
    }

    override handleRedemptionPaymentFailed(args: EvmEventArgs<RedemptionPaymentFailed>): void {
        super.handleRedemptionPaymentFailed(args);
        this.confirmRedemptionPayment('failed', args)
    }

    override handleRedemptionPaymentBlocked(args: EvmEventArgs<RedemptionPaymentBlocked>): void {
        super.handleRedemptionPaymentBlocked(args);
        this.confirmRedemptionPayment('blocked', args)
    }

    override handleRedemptionDefault(args: EvmEventArgs<RedemptionDefault>): void {
        super.handleRedemptionDefault(args);
        // release request
        const request = this.getRedemptionRequest(Number(args.requestId));
        request.collateralReleased = true;
        this.releaseClosedRedemptionRequests(args.$event, request);
    }

    override handleSelfClose(args: EvmEventArgs<SelfClose>): void {
        super.handleSelfClose(args);
        // close tickets, update free balance
        this.closeRedemptionTicketsAnyAmount(args.$event, toBN(args.valueUBA));
    }

    // handlers: dust

    override handleDustConvertedToTicket(args: EvmEventArgs<DustConvertedToTicket>): void {
        super.handleDustConvertedToTicket(args);
        // create redemption ticket
        const ticket = this.newRedemptionTicket(Number(args.redemptionTicketId), toBN(args.valueUBA));
        this.redemptionTickets.set(ticket.id, ticket);
        // recalculate dust
        this.calculatedDustUBA = this.calculatedDustUBA.sub(toBN(args.valueUBA));
        this.logAction(`new RedemptionTicket(${ticket.id}) [from dust]: amount=${formatBN(ticket.amountUBA)} remaining_dust=${formatBN(this.calculatedDustUBA)}`, args.$event);
    }

    override handleDustChanged(args: EvmEventArgs<DustChanged>): void {
        super.handleDustChanged(args);
        // log change
        const change = args.dustUBA.sub(this.dustUBA);
        this.logAction(`dust changed by ${change}, new dust=${formatBN(this.dustUBA)}`, args.$event);
    }

    // handlers: underlying withdrawal

    override handleUnderlyingWithdrawalAnnounced(args: EvmEventArgs<UnderlyingWithdrawalAnnounced>): void {
        this.expect(this.announcedUnderlyingWithdrawalId.isZero(), `underlying withdrawal announcement made twice`, args.$event);
        super.handleUnderlyingWithdrawalAnnounced(args);
    }

    override handleUnderlyingWithdrawalConfirmed(args: EvmEventArgs<UnderlyingWithdrawalConfirmed>): void {
        this.expect(this.announcedUnderlyingWithdrawalId.eq(args.announcementId), `underlying withdrawal id mismatch`, args.$event);
        super.handleUnderlyingWithdrawalConfirmed(args);
        this.addUnderlyingBalanceChange(args.$event, 'withdrawal', toBN(args.spentUBA).neg());
    }

    override handleUnderlyingWithdrawalCancelled(args: EvmEventArgs<UnderlyingWithdrawalCancelled>): void {
        this.expect(this.announcedUnderlyingWithdrawalId.eq(args.announcementId), `underlying withdrawal id mismatch`, args.$event);
        super.handleUnderlyingWithdrawalCancelled(args);
    }

    override handleUnderlyingBalanceToppedUp(args: EvmEventArgs<UnderlyingBalanceToppedUp>): void {
        super.handleUnderlyingBalanceToppedUp(args);
        this.addUnderlyingBalanceChange(args.$event, 'topup', toBN(args.underlyingBalanceChangeUBA));
    }

    // handlers: liquidation

    override handleLiquidationPerformed(args: EvmEventArgs<LiquidationPerformed>): void {
        super.handleLiquidationPerformed(args);
        // close tickets, update free balance
        this.closeRedemptionTicketsAnyAmount(args.$event, toBN(args.valueUBA));
    }

    // handlers: underlying transactions

    handleTransactionFromUnderlying(transaction: ITransaction) {
        this.logAction(`underlying withdraw amount=${formatBN(transaction.outputs[0][1])} to=${transaction.outputs[0][0]}`, "UNDERLYING_TRANSACTION");
    }

    handleTransactionToUnderlying(transaction: ITransaction) {
        this.logAction(`underlying deposit amount=${formatBN(transaction.outputs[0][1])} from=${transaction.inputs[0][0]}`, "UNDERLYING_TRANSACTION");
    }

    // handlers: collateral deposit/withdraw (agent pool tokens)

    depositCollateral(token: string, value: BN) {
        super.depositCollateral(token, value);
        if (token === this.poolTokenAddress) {
            this.totalAgentPoolTokensWei = this.totalAgentPoolTokensWei.add(value);
        }
    }

    withdrawCollateral(token: string, value: BN) {
        super.depositCollateral(token, value);
        if (token === this.poolTokenAddress) {
            this.totalAgentPoolTokensWei = this.totalAgentPoolTokensWei.sub(value);
        }
    }

    // agent state changing

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
        this.logAction(`new CollateralReservation(${cr.id}): amount=${formatBN(cr.valueUBA)} fee=${formatBN(cr.feeUBA)}`, args.$event);
    }

    deleteCollateralReservation(event: EvmEvent, crId: number) {
        const cr = this.collateralReservations.get(crId);
        if (!cr) assert.fail(`Invalid collateral reservation id ${crId}`);
        this.logAction(`delete CollateralReservation(${cr.id}): amount=${formatBN(cr.valueUBA)}`, event);
        this.collateralReservations.delete(crId);
    }

    newRedemptionTicket(ticketId: number, amountUBA: BN): RedemptionTicket {
        return {
            id: ticketId,
            agentVault: this.address,
            amountUBA: amountUBA
        };
    }

    addRedemptionTicket(event: EvmEvent, ticketId: number, amountUBA: BN) {
        const ticket = this.newRedemptionTicket(ticketId, amountUBA);
        this.redemptionTickets.set(ticket.id, ticket);
        this.logAction(`new RedemptionTicket(${ticket.id}): amount=${formatBN(ticket.amountUBA)}`, event);
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
            const redeemLots = minBN(remainingLots, ticketLots);
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
        const remainingUBA = amountUBA.sub(redeemedUBA);
        this.expect(remainingUBA.isZero(), `Redemption mismatch redeemedUBA=${formatBN(redeemedUBA)}, amountUBA=${formatBN(amountUBA)} remainingUBA=${formatBN(remainingUBA)}`, event);
        this.logAction(`redeemed ${count} tickets, ${redeemedLots} lots, remainingUBA=${formatBN(remainingUBA)}, lotSize=${formatBN(lotSize)}`, event);
    }

    closeRedemptionTicketsAnyAmount(event: EvmEvent, amountUBA: BN) {
        const lotSize = this.parent.lotSize();
        const tickets = Array.from(this.redemptionTickets.values());
        tickets.sort((a, b) => a.id - b.id);    // sort by ticketId, so that we close them in correct order
        let remainingUBA = amountUBA;
        // redeem dust
        const redeemedDust = minBN(remainingUBA, this.calculatedDustUBA);
        this.calculatedDustUBA = this.calculatedDustUBA.sub(redeemedDust);
        remainingUBA = remainingUBA.sub(redeemedDust);
        // redeem tickets
        let count = 0;
        for (const ticket of tickets) {
            if (remainingUBA.isZero()) break;
            const redeemUBA = minBN(remainingUBA, ticket.amountUBA);
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
        this.expect(remainingUBA.isZero(), `Ticket close mismatch closedUBA=${formatBN(redeemedUBA)}, amountUBA=${formatBN(amountUBA)} remainingUBA=${formatBN(remainingUBA)}`, event);
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
        return request;
    }

    getRedemptionRequest(requestId: number) {
        return this.redemptionRequests.get(requestId) ?? assert.fail(`Invalid redemption request id ${requestId}`);
    }

    confirmRedemptionPayment(type: 'performed' | 'failed' | 'blocked', args: { $event: EvmEvent, requestId: BN, spentUnderlyingUBA: BN }) {
        // update underlying balance
        this.addUnderlyingBalanceChange(args.$event, 'redemption', toBN(args.spentUnderlyingUBA).neg());
        // release request
        const request = this.getRedemptionRequest(Number(args.requestId));
        if (type === 'performed' || type === 'blocked') {
            request.collateralReleased = true;
        }
        request.underlyingReleased = true;
        this.releaseClosedRedemptionRequests(args.$event, request);
    }

    releaseClosedRedemptionRequests(event: EvmEvent, request: RedemptionRequest) {
        if (request.collateralReleased && request.underlyingReleased) {
            this.redemptionRequests.delete(request.id);
            this.logAction(`delete RedemptionRequest(${request.id}): amount=${formatBN(request.valueUBA)}`, event);
        }
    }

    addUnderlyingBalanceChange(event: EvmEvent, type: UnderlyingBalanceChangeType, amountUBA: BN) {
        const change: UnderlyingBalanceChange = { type, amountUBA };
        this.underlyingBalanceChanges.push(change);
        this.logAction(`new UnderlyingBalanceChange(${type}): amount=${formatBN(amountUBA)}`, event);
    }

    // totals

    calculateReservedUBA() {
        return sumBN(this.collateralReservations.values(), ticket => ticket.valueUBA);
    }

    calculateMintedUBA() {
        return sumBN(this.redemptionTickets.values(), ticket => ticket.amountUBA).add(this.dustUBA);
    }

    calculateRedeemingUBA() {
        return sumBN(this.redemptionRequests.values(), request => request.collateralReleased ? BN_ZERO : request.valueUBA);
    }

    calculateUnderlyingBalanceUBA() {
        return sumBN(this.underlyingBalanceChanges, change => change.amountUBA);
    }

    calculateFreeUnderlyingBalanceUBA() {
        const mintedUBA = this.calculateMintedUBA();
        const redeemingUBA = this.calculateRedeemingUBA();
        return this.calculateUnderlyingBalanceUBA().sub(mintedUBA).sub(redeemingUBA);
    }

    // calculations

    private collateralRatioForPrice(prices: Prices, collateral: CollateralToken) {
        const redeemingUBA = collateral.tokenClass === CollateralTokenClass.CLASS1 ? this.redeemingUBA : this.poolRedeemingUBA;
        const backedAmount = (Number(this.reservedUBA) + Number(this.mintedUBA) + Number(redeemingUBA)) / Number(this.parent.settings.assetUnitUBA);
        if (backedAmount === 0) return Number.POSITIVE_INFINITY;
        const totalCollateralWei = collateral.tokenClass === CollateralTokenClass.CLASS1 ? this.totalClass1CollateralWei : this.totalPoolCollateralNATWei;
        const totalCollateral = Number(totalCollateralWei) / Number(NAT_WEI);
        const assetToTokenPrice = prices.get(collateral).assetToTokenPriceNum();
        const backingCollateral = Number(backedAmount) * assetToTokenPrice;
        return totalCollateral / backingCollateral;
    }

    collateralRatio(collateral: CollateralToken) {
        const ratio = this.collateralRatioForPrice(this.parent.prices, collateral);
        const ratioFromTrusted = this.collateralRatioForPrice(this.parent.trustedPrices, collateral);
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
        // minimum underlying backing (unless in full liquidation)
        if (this.status !== AgentStatus.FULL_LIQUIDATION) {
            const underlyingBalanceUBA = await this.parent.context.chain.getBalance(this.underlyingAddressString);
            problems += checker.checkNumericDifference(`${agentName}.underlyingBalanceUBA`, underlyingBalanceUBA, 'gte', mintedUBA.add(freeUnderlyingBalanceUBA));
        }
        // dust
        problems += checker.checkEquality(`${agentName}.dustUBA`, this.dustUBA, this.calculatedDustUBA);
        // status
        if (!(this.status === AgentStatus.CCB && Number(agentInfo.status) === Number(AgentStatus.LIQUIDATION))) {
            problems += checker.checkStringEquality(`${agentName}.status`, agentInfo.status, this.status);
        } else {
            checker.logger.log(`    ${agentName}.status: CCB -> LIQUIDATION issue, time=${await latestBlockTimestamp() - Number(this.ccbStartTimestamp)}`);
        }
        // log
        if (problems > 0) {
            this.writeActionLog(checker.logger);
        }
    }

    // expectations and logs

    expect(condition: boolean, message: string, event: EvmEvent) {
        if (!condition) {
            const text = `expectation failed for ${this.name()}: ${message}`;
            this.parent.failedExpectations.push({ text, event });
        }
    }

    logAction(text: string, event: EvmEvent | string) {
        this.actionLog.push({ text, event });
    }

    writeActionLog(logger: ILogger) {
        logger.log(`    action log for ${this.name()}`);
        for (const log of this.actionLog) {
            logger.log(`        ${log.text}  ${typeof log.event === 'string' ? log.event : this.parent.eventInfo(log.event)}`);
        }
    }
}
