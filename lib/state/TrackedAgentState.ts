import BN from "bn.js";
import { AgentInfo, AgentStatus } from "../fasset/AssetManagerTypes";
import { convertUBAToTokenWei } from "../fasset/Conversions";
import { Prices } from "./Prices";
import { EvmEventArgs } from "../utils/events/IEvmEvents";
import { BN_ZERO, formatBN, MAX_BIPS, toBN } from "../utils/helpers";
import { ILogger } from "../utils/logging";
import {
    AgentAvailable, AvailableAgentExited, CollateralReservationDeleted, CollateralReserved, DustChanged, DustConvertedToTicket, LiquidationPerformed, MintingExecuted, MintingPaymentDefault,
    RedemptionDefault, RedemptionPaymentBlocked, RedemptionPaymentFailed, RedemptionPerformed, RedemptionRequested, SelfClose, UnderlyingWithdrawalAnnounced, UnderlyingWithdrawalCancelled, UnderlyingWithdrawalConfirmed
} from "../../typechain-truffle/AssetManager";
import { TrackedState } from "./TrackedState";

const MAX_UINT256 = toBN(1).shln(256).subn(1);

export class TrackedAgentState {
    constructor(
        public parent: TrackedState,
        public address: string,
        public owner: string,
        public underlyingAddressString: string,
    ) {
    }

    // state
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
    dustUBA: BN = BN_ZERO;
    underlyingBalanceUBA: BN = BN_ZERO;

    // calculated getters

    get requiredUnderlyingBalanceUBA() {
        const backedUBA = this.mintedUBA.add(this.redeemingUBA);
        return backedUBA.mul(toBN(this.parent.settings.minUnderlyingBackingBIPS)).divn(MAX_BIPS);
    }

    get freeUnderlyingBalanceUBA() {
        return this,this.underlyingBalanceUBA.sub(this.requiredUnderlyingBalanceUBA);
    }

    // init

    initialize(agentInfo: AgentInfo) {
        this.status = Number(agentInfo.status);
        this.publiclyAvailable = agentInfo.publiclyAvailable;
        this.feeBIPS = toBN(agentInfo.feeBIPS);
        this.agentMinCollateralRatioBIPS = toBN(agentInfo.agentMinCollateralRatioBIPS);
        this.totalCollateralNATWei = toBN(agentInfo.totalCollateralNATWei);
        this.ccbStartTimestamp = toBN(agentInfo.ccbStartTimestamp);
        this.liquidationStartTimestamp = toBN(agentInfo.liquidationStartTimestamp);
        this.announcedUnderlyingWithdrawalId = toBN(agentInfo.announcedUnderlyingWithdrawalId);
        this.reservedUBA = toBN(agentInfo.reservedUBA);
        this.mintedUBA = toBN(agentInfo.mintedUBA);
        this.redeemingUBA = toBN(agentInfo.redeemingUBA);
        this.dustUBA = toBN(agentInfo.dustUBA);
        this.underlyingBalanceUBA = toBN(agentInfo.underlyingBalanceUBA);
    }

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
        this.reservedUBA = this.reservedUBA.add(toBN(args.valueUBA));
    }

    handleMintingExecuted(args: EvmEventArgs<MintingExecuted>) {
        const mintedAmountUBA = toBN(args.mintedAmountUBA);
        const agentFeeUBA = toBN(args.agentFeeUBA);
        const poolFeeUBA = toBN(args.poolFeeUBA);
        // update underlying free balance
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.add(mintedAmountUBA).add(agentFeeUBA).add(poolFeeUBA);
        // create redemption ticket
        this.mintedUBA = this.mintedUBA.add(mintedAmountUBA).add(poolFeeUBA);
        // delete collateral reservation
        const collateralReservationId = Number(args.collateralReservationId);
        if (collateralReservationId > 0) {  // collateralReservationId == 0 for self-minting
            this.reservedUBA = this.reservedUBA.sub(mintedAmountUBA);
        }
    }

    handleMintingPaymentDefault(args: EvmEventArgs<MintingPaymentDefault>) {
        this.reservedUBA = this.reservedUBA.sub(toBN(args.reservedAmountUBA));
    }

    handleCollateralReservationDeleted(args: EvmEventArgs<CollateralReservationDeleted>) {
        this.reservedUBA = this.reservedUBA.sub(toBN(args.reservedAmountUBA));
    }

    // handlers: redemption and self-close

    handleRedemptionRequested(args: EvmEventArgs<RedemptionRequested>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.valueUBA));
        this.redeemingUBA = this.redeemingUBA.add(toBN(args.valueUBA));
    }

    handleRedemptionPerformed(args: EvmEventArgs<RedemptionPerformed>): void {
        this.redeemingUBA = this.redeemingUBA.sub(toBN(args.redemptionAmountUBA));
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUnderlyingUBA);
    }

    handleRedemptionPaymentFailed(args: EvmEventArgs<RedemptionPaymentFailed>): void {
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUnderlyingUBA);
    }

    handleRedemptionPaymentBlocked(args: EvmEventArgs<RedemptionPaymentBlocked>): void {
        this.redeemingUBA = this.redeemingUBA.sub(toBN(args.redemptionAmountUBA));
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUnderlyingUBA);
    }

    handleRedemptionDefault(args: EvmEventArgs<RedemptionDefault>): void {
        this.redeemingUBA = this.redeemingUBA.sub(toBN(args.redemptionAmountUBA));
    }

    handleSelfClose(args: EvmEventArgs<SelfClose>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.valueUBA));
    }

    // handlers: dust

    handleDustConvertedToTicket(args: EvmEventArgs<DustConvertedToTicket>): void {
        // no change to totals
    }

    handleDustChanged(args: EvmEventArgs<DustChanged>): void {
        this.dustUBA = args.dustUBA;
    }

    // handlers: status

    handleStatusChange(status: AgentStatus, timestamp?: BN): void {
        if (timestamp && this.status === AgentStatus.NORMAL && status === AgentStatus.CCB) {
            this.ccbStartTimestamp = timestamp;
        }
        if (timestamp && (this.status === AgentStatus.NORMAL || this.status === AgentStatus.CCB) && (status === AgentStatus.LIQUIDATION || status === AgentStatus.FULL_LIQUIDATION)) {
            this.liquidationStartTimestamp = timestamp;
        }
        this.status = status;
    }

    // handlers: underlying withdrawal

    handleUnderlyingWithdrawalAnnounced(args: EvmEventArgs<UnderlyingWithdrawalAnnounced>): void {
        this.announcedUnderlyingWithdrawalId = args.announcementId;
    }

    handleUnderlyingWithdrawalConfirmed(args: EvmEventArgs<UnderlyingWithdrawalConfirmed>): void {
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUBA);
        this.announcedUnderlyingWithdrawalId = BN_ZERO;
    }

    handleUnderlyingWithdrawalCancelled(args: EvmEventArgs<UnderlyingWithdrawalCancelled>): void {
        this.announcedUnderlyingWithdrawalId = BN_ZERO;
    }

    // handlers: liquidation

    handleLiquidationPerformed(args: EvmEventArgs<LiquidationPerformed>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.valueUBA));
    }

    // agent state changing

    depositCollateral(value: BN) {
        this.totalCollateralNATWei = this.totalCollateralNATWei.add(value);
    }

    withdrawCollateral(value: BN) {
        this.totalCollateralNATWei = this.totalCollateralNATWei.sub(value);
    }
    // calculations

    name() {
        return this.parent.eventFormatter.formatAddress(this.address);
    }

    private collateralRatioForPriceBIPS(prices: Prices) {
        const totalUBA = this.reservedUBA.add(this.mintedUBA).add(this.redeemingUBA);
        if (totalUBA.isZero()) return MAX_UINT256;
        const backingCollateral = convertUBAToTokenWei(this.parent.settings, totalUBA, prices.amgToNatWei);
        return this.totalCollateralNATWei.muln(MAX_BIPS).div(backingCollateral);
    }

    collateralRatioBIPS() {
        const ratio = this.collateralRatioForPriceBIPS(this.parent.prices);
        const ratioFromTrusted = this.collateralRatioForPriceBIPS(this.parent.trustedPrices);
        return BN.max(ratio, ratioFromTrusted);
    }

    possibleLiquidationTransition(timestamp: BN) {
        const cr = this.collateralRatioBIPS();
        const settings = this.parent.settings;
        if (this.status === AgentStatus.NORMAL) {
            if (cr.lt(toBN(settings.ccbMinCollateralRatioBIPS))) {
                return AgentStatus.LIQUIDATION;
            } else if (cr.lt(toBN(settings.minCollateralRatioBIPS))) {
                return AgentStatus.CCB;
            }
        } else if (this.status === AgentStatus.CCB) {
            if (cr.gte(toBN(settings.minCollateralRatioBIPS))) {
                return AgentStatus.NORMAL;
            } else if (cr.lt(toBN(settings.ccbMinCollateralRatioBIPS)) || timestamp.gte(this.ccbStartTimestamp.add(toBN(settings.ccbTimeSeconds)))) {
                return AgentStatus.LIQUIDATION;
            }
        } else if (this.status === AgentStatus.LIQUIDATION) {
            if (cr.gte(toBN(settings.safetyMinCollateralRatioBIPS))) {
                return AgentStatus.NORMAL;
            }
        }
        return this.status;
    }

    // info

    writeAgentSummary(logger: ILogger) {
        const cr = Number(this.collateralRatioBIPS()) / MAX_BIPS;
        logger.log(`    ${this.name()}:  minted=${formatBN(this.mintedUBA)}  cr=${cr.toFixed(3)}  status=${AgentStatus[this.status]}  available=${this.publiclyAvailable}` +
            `  (reserved=${formatBN(this.reservedUBA)}  redeeming=${formatBN(this.redeemingUBA)}  dust=${formatBN(this.dustUBA)}  freeUnderlying=${formatBN(this.freeUnderlyingBalanceUBA)})`)
    }
}
