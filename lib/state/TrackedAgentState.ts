import {
    AgentAvailable, AgentVaultCreated, AvailableAgentExited, CollateralReservationDeleted, CollateralReserved, DustChanged, LiquidationPerformed, MintingExecuted, MintingPaymentDefault,
    RedeemedInCollateral, RedemptionDefault, RedemptionPaymentBlocked, RedemptionPaymentFailed, RedemptionPerformed, RedemptionRequested, RedemptionTicketCreated, RedemptionTicketDeleted,
    RedemptionTicketUpdated, SelfClose, UnderlyingBalanceToppedUp, UnderlyingWithdrawalAnnounced, UnderlyingWithdrawalCancelled, UnderlyingWithdrawalConfirmed
} from "../../typechain-truffle/IIAssetManager";
import { AgentInfo, AgentSetting, AgentStatus, CollateralType, CollateralClass } from "../fasset/AssetManagerTypes";
import { roundUBAToAmg } from "../fasset/Conversions";
import { EvmEventArgs } from "../utils/events/IEvmEvents";
import { EventArgs } from "../utils/events/common";
import { BN_ONE, BN_ZERO, BNish, MAX_BIPS, formatBN, maxBN, toBN } from "../utils/helpers";
import { ILogger } from "../utils/logging";
import { Prices } from "./Prices";
import { TrackedState } from "./TrackedState";

const MAX_UINT256 = toBN(1).shln(256).subn(1);

export type InitialAgentData = EventArgs<AgentVaultCreated>;

export class TrackedAgentState {
    constructor(
        public parent: TrackedState,
        data: InitialAgentData,
    ) {
        this.address = data.agentVault;
        this.owner = data.owner;
        this.underlyingAddressString = data.creationData.underlyingAddress;
        this.collateralPoolAddress = data.creationData.collateralPool;
        this.collateralPoolTokenAddress = data.creationData.collateralPoolToken;
        this.vaultCollateral = parent.collaterals.get(CollateralClass.VAULT, data.creationData.vaultCollateralToken);
        this.poolWNatCollateral = parent.collaterals.get(CollateralClass.POOL, data.creationData.poolWNatToken);
        this.feeBIPS = toBN(data.creationData.feeBIPS);
        this.poolFeeShareBIPS = toBN(data.creationData.poolFeeShareBIPS);
        this.mintingVaultCollateralRatioBIPS = toBN(data.creationData.mintingVaultCollateralRatioBIPS);
        this.mintingPoolCollateralRatioBIPS = toBN(data.creationData.mintingPoolCollateralRatioBIPS);
        this.buyFAssetByAgentFactorBIPS = toBN(data.creationData.buyFAssetByAgentFactorBIPS);
        this.poolExitCollateralRatioBIPS = toBN(data.creationData.poolExitCollateralRatioBIPS);
        this.poolTopupCollateralRatioBIPS = toBN(data.creationData.poolTopupCollateralRatioBIPS);
        this.poolTopupTokenPriceFactorBIPS = toBN(data.creationData.poolTopupTokenPriceFactorBIPS);
        this.handshakeType = toBN(data.creationData.handshakeType);
    }

    // identifying addresses
    address: string;
    owner: string;
    underlyingAddressString: string;
    collateralPoolAddress: string;
    collateralPoolTokenAddress: string;

    // agent's settings
    vaultCollateral: CollateralType;
    poolWNatCollateral: CollateralType;
    feeBIPS: BN;
    poolFeeShareBIPS: BN;
    mintingVaultCollateralRatioBIPS: BN;
    mintingPoolCollateralRatioBIPS: BN;
    buyFAssetByAgentFactorBIPS: BN;
    poolExitCollateralRatioBIPS: BN;
    poolTopupCollateralRatioBIPS: BN;
    poolTopupTokenPriceFactorBIPS: BN;
    handshakeType: BN;

    // status
    status: AgentStatus = AgentStatus.NORMAL;
    publiclyAvailable: boolean = false;

    // state
    totalVaultCollateralWei: BN = BN_ZERO;
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
        this.totalVaultCollateralWei = toBN(agentInfo.totalVaultCollateralWei);
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
        if (!["feeBIPS", "poolFeeShareBIPS", "mintingVaultCollateralRatioBIPS", "mintingPoolCollateralRatioBIPS", "buyFAssetByAgentFactorBIPS",
            "poolExitCollateralRatioBIPS", "poolTopupCollateralRatioBIPS", "poolTopupTokenPriceFactorBIPS", "handshakeType"].includes(name)) return;
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
        this.updateRedeemingUBA(args.requestId, toBN(args.valueUBA));
    }

    handleRedemptionPerformed(args: EvmEventArgs<RedemptionPerformed>): void {
        this.updateRedeemingUBA(args.requestId, toBN(args.redemptionAmountUBA).neg());
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUnderlyingUBA);
    }

    handleRedemptionPaymentFailed(args: EvmEventArgs<RedemptionPaymentFailed>): void {
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUnderlyingUBA);
    }

    handleRedemptionPaymentBlocked(args: EvmEventArgs<RedemptionPaymentBlocked>): void {
        this.updateRedeemingUBA(args.requestId, toBN(args.redemptionAmountUBA).neg());
        this.underlyingBalanceUBA = this.underlyingBalanceUBA.sub(args.spentUnderlyingUBA);
    }

    handleRedemptionDefault(args: EvmEventArgs<RedemptionDefault>): void {
        this.updateRedeemingUBA(args.requestId, toBN(args.redemptionAmountUBA).neg());
    }

    handleRedeemedInCollateral(args: EvmEventArgs<RedeemedInCollateral>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.redemptionAmountUBA));
    }

    handleSelfClose(args: EvmEventArgs<SelfClose>): void {
        this.mintedUBA = this.mintedUBA.sub(toBN(args.valueUBA));
    }

    private updateRedeemingUBA(requestId: BNish, valueUBA: BN) {
        this.redeemingUBA = this.redeemingUBA.add(valueUBA);
        if (!this.isPoolSelfCloseRedemption(requestId)) {
            this.poolRedeemingUBA = this.poolRedeemingUBA.add(valueUBA);
        }
    }

    protected isPoolSelfCloseRedemption(requestId: BNish) {
        return !toBN(requestId).and(BN_ONE).isZero();
    }

    // handlers: tickets

    handleRedemptionTicketCreated(args: EvmEventArgs<RedemptionTicketCreated>): void {
    }

    handleRedemptionTicketUpdated(args: EvmEventArgs<RedemptionTicketUpdated>): void {
    }

    handleRedemptionTicketDeleted(args: EvmEventArgs<RedemptionTicketDeleted>): void {
    }

    // handlers: dust

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
        if (token === this.vaultCollateral.token) {
            this.totalVaultCollateralWei = this.totalVaultCollateralWei.add(value);
        }
    }

    withdrawCollateral(token: string, value: BN) {
        if (token === this.vaultCollateral.token) {
            this.totalVaultCollateralWei = this.totalVaultCollateralWei.sub(value);
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
        return collateral.collateralClass === CollateralClass.VAULT ? this.totalVaultCollateralWei : this.totalPoolCollateralNATWei;
    }

    private collateralRatioForPriceBIPS(prices: Prices, collateral: CollateralType) {
        const redeemingUBA = collateral.collateralClass === CollateralClass.VAULT ? this.redeemingUBA : this.poolRedeemingUBA;
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
        const vaultCollateralTransition = this.possibleLiquidationTransitionForCollateral(this.vaultCollateral, timestamp);
        const poolTransition = this.possibleLiquidationTransitionForCollateral(this.poolWNatCollateral, timestamp);
        // return the higher status (more severe)
        return vaultCollateralTransition >= poolTransition ? vaultCollateralTransition : poolTransition;
    }

    calculatePoolFee(mintingFeeUBA: BN) {
        return roundUBAToAmg(this.parent.settings, toBN(mintingFeeUBA).mul(this.poolFeeShareBIPS).divn(MAX_BIPS));
    }

    // info

    writeAgentSummary(logger: ILogger) {
        const vaultCR = Number(this.collateralRatioBIPS(this.vaultCollateral)) / MAX_BIPS;
        const poolCR = Number(this.collateralRatioBIPS(this.poolWNatCollateral)) / MAX_BIPS;
        const formatCR = (cr: number) => cr >= 1e10 ? "'INF'" : cr.toFixed(3);
        logger.log(`    ${this.name()}:  minted=${formatBN(this.mintedUBA)}  vaultCR=${formatCR(vaultCR)}  poolCR=${formatCR(poolCR)}  status=${AgentStatus[this.status]}  available=${this.publiclyAvailable}` +
            `  (reserved=${formatBN(this.reservedUBA)}  redeeming=${formatBN(this.redeemingUBA)}  dust=${formatBN(this.dustUBA)}  freeUnderlying=${formatBN(this.freeUnderlyingBalanceUBA)})`)
    }
}
