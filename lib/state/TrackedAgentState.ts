import {
    AgentAvailable, AgentCreated, AvailableAgentExited, CollateralReservationDeleted, CollateralReserved, DustChanged, DustConvertedToTicket, LiquidationPerformed, MintingExecuted, MintingPaymentDefault,
    RedemptionDefault, RedemptionPaymentBlocked, RedemptionPaymentFailed, RedemptionPerformed, RedemptionRequested, SelfClose, UnderlyingBalanceToppedUp, UnderlyingWithdrawalAnnounced, UnderlyingWithdrawalCancelled, UnderlyingWithdrawalConfirmed
} from "../../typechain-truffle/AssetManager";
import { AgentInfo, AgentSetting, AgentStatus, CollateralType, CollateralClass } from "../fasset/AssetManagerTypes";
import { roundUBAToAmg } from "../fasset/Conversions";
import { EvmEventArgs } from "../utils/events/IEvmEvents";
import { EventArgs } from "../utils/events/common";
import { BN_ZERO, BNish, MAX_BIPS, formatBN, maxBN, toBN } from "../utils/helpers";
import { ILogger } from "../utils/logging";
import { Prices } from "./Prices";
import { TrackedState } from "./TrackedState";

const MAX_UINT256 = toBN(1).shln(256).subn(1);

export type InitialAgentData = EventArgs<AgentCreated> & { poolWNat: string };

export class TrackedAgentState {
    constructor(
        public parent: TrackedState,
        data: InitialAgentData,
    ) {
        this.address = data.agentVault;
        this.owner = data.owner;
        this.underlyingAddressString = data.underlyingAddress;
        this.collateralPoolAddress = data.collateralPool;
        this.class1Collateral = parent.collaterals.get(CollateralClass.CLASS1, data.class1CollateralToken);
        this.poolWNatCollateral = parent.collaterals.get(CollateralClass.POOL, data.poolWNat);
        this.feeBIPS = toBN(data.feeBIPS);
        this.poolFeeShareBIPS = toBN(data.poolFeeShareBIPS);
        this.mintingClass1CollateralRatioBIPS = toBN(data.mintingClass1CollateralRatioBIPS);
        this.mintingPoolCollateralRatioBIPS = toBN(data.mintingPoolCollateralRatioBIPS);
        this.buyFAssetByAgentFactorBIPS = toBN(data.buyFAssetByAgentFactorBIPS);
        this.poolExitCollateralRatioBIPS = toBN(data.poolExitCollateralRatioBIPS);
        this.poolTopupCollateralRatioBIPS = toBN(data.poolTopupCollateralRatioBIPS);
        this.poolTopupTokenPriceFactorBIPS = toBN(data.poolTopupTokenPriceFactorBIPS);
    }

    // identifying addresses
    address: string;
    owner: string;
    underlyingAddressString: string;
    collateralPoolAddress: string;

    // agent's settings
    class1Collateral: CollateralType;
    poolWNatCollateral: CollateralType;
    feeBIPS: BN;
    poolFeeShareBIPS: BN;
    mintingClass1CollateralRatioBIPS: BN;
    mintingPoolCollateralRatioBIPS: BN;
    buyFAssetByAgentFactorBIPS: BN;
    poolExitCollateralRatioBIPS: BN;
    poolTopupCollateralRatioBIPS: BN;
    poolTopupTokenPriceFactorBIPS: BN;

    // status
    status: AgentStatus = AgentStatus.NORMAL;
    publiclyAvailable: boolean = false;

    // state
    totalClass1CollateralWei: BN = BN_ZERO;
    totalPoolCollateralNATWei: BN = BN_ZERO;
    ccbStartTimestamp: BN = BN_ZERO;                // 0 - not in ccb/liquidation
    liquidationStartTimestamp: BN = BN_ZERO;        // 0 - not in liquidation
    announcedUnderlyingWithdrawalId: BN = BN_ZERO;  // 0 - not announced

    // aggregates
    reservedUBA: BN = BN_ZERO;
    mintedUBA: BN = BN_ZERO;
    redeemingUBA: BN = BN_ZERO;
    poolRedeemingUBA: BN = BN_ZERO;
    dustUBA: BN = BN_ZERO;
    underlyingBalanceUBA: BN = BN_ZERO;

    // calculated getters

    get requiredUnderlyingBalanceUBA() {
        const backedUBA = this.mintedUBA.add(this.redeemingUBA);
        return backedUBA.mul(toBN(this.parent.settings.minUnderlyingBackingBIPS)).divn(MAX_BIPS);
    }

    get freeUnderlyingBalanceUBA() {
        return this.underlyingBalanceUBA.sub(this.requiredUnderlyingBalanceUBA);
    }

    // init

    initializeState(agentInfo: AgentInfo) {
        this.status = Number(agentInfo.status);
        this.publiclyAvailable = agentInfo.publiclyAvailable;
        this.totalClass1CollateralWei = toBN(agentInfo.totalClass1CollateralWei);
        this.totalPoolCollateralNATWei = toBN(agentInfo.totalPoolCollateralNATWei);
        this.ccbStartTimestamp = toBN(agentInfo.ccbStartTimestamp);
        this.liquidationStartTimestamp = toBN(agentInfo.liquidationStartTimestamp);
        this.announcedUnderlyingWithdrawalId = toBN(agentInfo.announcedUnderlyingWithdrawalId);
        this.reservedUBA = toBN(agentInfo.reservedUBA);
        this.mintedUBA = toBN(agentInfo.mintedUBA);
        this.redeemingUBA = toBN(agentInfo.redeemingUBA);
        this.poolRedeemingUBA = toBN(agentInfo.poolRedeemingUBA);
        this.dustUBA = toBN(agentInfo.dustUBA);
        this.underlyingBalanceUBA = toBN(agentInfo.underlyingBalanceUBA);
    }

    // handlers: agent availability

    handleAgentAvailable(args: EvmEventArgs<AgentAvailable>) {
        this.publiclyAvailable = true;
    }

    handleAvailableAgentExited(args: EvmEventArgs<AvailableAgentExited>) {
        this.publiclyAvailable = false;
    }

    // handlers: agent settings

    handleSettingChanged(name: string, value: BNish) {
        if (!["feeBIPS", "poolFeeShareBIPS", "mintingClass1CollateralRatioBIPS", "mintingPoolCollateralRatioBIPS",
            "buyFAssetByAgentFactorBIPS", "poolExitCollateralRatioBIPS", "poolTopupCollateralRatioBIPS", "poolTopupTokenPriceFactorBIPS"].includes(name)) return;
        this[name as AgentSetting] = toBN(value);
    }

    // handlers: minting

    handleCollateralReserved(args: EvmEventArgs<CollateralReserved>) {
        const mintingUBA = toBN(args.valueUBA);
        const poolFeeUBA = this.calculatePoolFee(toBN(args.feeUBA));
        this.reservedUBA = this.reservedUBA.add(mintingUBA).add(poolFeeUBA);
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
            this.reservedUBA = this.reservedUBA.sub(mintedAmountUBA).sub(poolFeeUBA);
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

    handleUnderlyingBalanceToppedUp(args: EvmEventArgs<UnderlyingBalanceToppedUp>): void {
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.add(args.depositedUBA);
    }

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

    depositCollateral(token: string, value: BN) {
        if (token === this.class1Collateral.token) {
            this.totalClass1CollateralWei = this.totalClass1CollateralWei.add(value);
        }
    }

    withdrawCollateral(token: string, value: BN) {
        if (token === this.class1Collateral.token) {
            this.totalClass1CollateralWei = this.totalClass1CollateralWei.sub(value);
        }
    }

    depositPoolCollateral(token: string, value: BN) {
        if (token === this.poolWNatCollateral.token) {
            this.totalPoolCollateralNATWei = this.totalPoolCollateralNATWei.add(value);
        }
    }

    withdrawPoolCollateral(token: string, value: BN) {
        if (token === this.poolWNatCollateral.token) {
            this.totalPoolCollateralNATWei = this.totalPoolCollateralNATWei.sub(value);
        }
    }

    // calculations

    name() {
        return this.parent.eventFormatter.formatAddress(this.address);
    }

    collateralBalance(collateral: CollateralType) {
        return collateral.collateralClass === CollateralClass.CLASS1 ? this.totalClass1CollateralWei : this.totalPoolCollateralNATWei;
    }

    private collateralRatioForPriceBIPS(prices: Prices, collateral: CollateralType) {
        const redeemingUBA = collateral.collateralClass === CollateralClass.CLASS1 ? this.redeemingUBA : this.poolRedeemingUBA;
        const totalUBA = this.reservedUBA.add(this.mintedUBA).add(redeemingUBA);
        if (totalUBA.isZero()) return MAX_UINT256;
        const price = prices.get(collateral);
        const backingCollateralWei = price.convertUBAToTokenWei(totalUBA);
        const totalCollateralWei = this.collateralBalance(collateral);
        return totalCollateralWei.muln(MAX_BIPS).div(backingCollateralWei);
    }

    collateralRatioBIPS(collateral: CollateralType) {
        const ratio = this.collateralRatioForPriceBIPS(this.parent.prices, collateral);
        const ratioFromTrusted = this.collateralRatioForPriceBIPS(this.parent.trustedPrices, collateral);
        return maxBN(ratio, ratioFromTrusted);
    }

    private possibleLiquidationTransitionForCollateral(collateral: CollateralType, timestamp: BN) {
        const cr = this.collateralRatioBIPS(collateral);
        const settings = this.parent.settings;
        if (this.status === AgentStatus.NORMAL) {
            if (cr.lt(toBN(collateral.ccbMinCollateralRatioBIPS))) {
                return AgentStatus.LIQUIDATION;
            } else if (cr.lt(toBN(collateral.minCollateralRatioBIPS))) {
                return AgentStatus.CCB;
            }
        } else if (this.status === AgentStatus.CCB) {
            if (cr.gte(toBN(collateral.minCollateralRatioBIPS))) {
                return AgentStatus.NORMAL;
            } else if (cr.lt(toBN(collateral.ccbMinCollateralRatioBIPS)) || timestamp.gte(this.ccbStartTimestamp.add(toBN(settings.ccbTimeSeconds)))) {
                return AgentStatus.LIQUIDATION;
            }
        } else if (this.status === AgentStatus.LIQUIDATION) {
            if (cr.gte(toBN(collateral.safetyMinCollateralRatioBIPS))) {
                return AgentStatus.NORMAL;
            }
        }
        return this.status;
    }

    possibleLiquidationTransition(timestamp: BN) {
        const class1Transition = this.possibleLiquidationTransitionForCollateral(this.class1Collateral, timestamp);
        const poolTransition = this.possibleLiquidationTransitionForCollateral(this.poolWNatCollateral, timestamp);
        // return the higher status (more severe)
        return class1Transition >= poolTransition ? class1Transition : poolTransition;
    }

    calculatePoolFee(mintingFeeUBA: BN) {
        return roundUBAToAmg(this.parent.settings, toBN(mintingFeeUBA).mul(this.poolFeeShareBIPS).divn(MAX_BIPS));
    }

    // info

    writeAgentSummary(logger: ILogger) {
        const class1CR = Number(this.collateralRatioBIPS(this.class1Collateral)) / MAX_BIPS;
        const poolCR = Number(this.collateralRatioBIPS(this.poolWNatCollateral)) / MAX_BIPS;
        const formatCR = (cr: number) => cr >= 1e10 ? "'INF'" : cr.toFixed(3);
        logger.log(`    ${this.name()}:  minted=${formatBN(this.mintedUBA)}  class1CR=${formatCR(class1CR)}  poolCR=${formatCR(poolCR)}  status=${AgentStatus[this.status]}  available=${this.publiclyAvailable}` +
            `  (reserved=${formatBN(this.reservedUBA)}  redeeming=${formatBN(this.redeemingUBA)}  dust=${formatBN(this.dustUBA)}  freeUnderlying=${formatBN(this.freeUnderlyingBalanceUBA)})`)
    }
}
