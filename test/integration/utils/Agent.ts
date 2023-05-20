import { time } from "@openzeppelin/test-helpers";
import { AgentInfo, AgentSetting, AgentSettings, AgentStatus } from "../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../lib/fasset/PaymentReference";
import { IBlockChainWallet } from "../../../lib/underlying-chain/interfaces/IBlockChainWallet";
import { EventArgs } from "../../../lib/utils/events/common";
import { checkEventNotEmited, eventArgs, filterEvents, requiredEventArgs } from "../../../lib/utils/events/truffle";
import { BN_ZERO, BNish, MAX_BIPS, maxBN, randomAddress, requireNotNull, toBN, toBNExp, toWei } from "../../../lib/utils/helpers";
import { web3DeepNormalize, web3Normalize } from "../../../lib/utils/web3normalize";
import { AgentVaultInstance, CollateralPoolInstance, CollateralPoolTokenInstance } from "../../../typechain-truffle";
import { CollateralReserved, LiquidationEnded, RedemptionDefault, RedemptionPaymentFailed, RedemptionRequested, UnderlyingWithdrawalAnnounced } from "../../../typechain-truffle/AssetManager";
import { createTestAgentSettings } from "../../unit/fasset/test-settings";
import { AgentCollateral } from "../../utils/fasset/AgentCollateral";
import { MockChain, MockChainWallet, MockTransactionOptionsWithFee } from "../../utils/fasset/MockChain";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { AssetContext, AssetContextClient } from "./AssetContext";
import { Minter } from "./Minter";
import { Approximation, assertApproximateMatch } from "../../utils/approximation";

const AgentVault = artifacts.require('AgentVault');
const CollateralPool = artifacts.require('CollateralPool');
const CollateralPoolToken = artifacts.require('CollateralPoolToken');
const Ftso = artifacts.require('FtsoMock');

export type CheckAgentInfo = { [K in keyof AgentInfo]?: AgentInfo[K] extends BN ? BNish | Approximation : AgentInfo[K] }
    & { actualUnderlyingBalance?: BNish };

export const CHECK_DEFAULTS: CheckAgentInfo = {
    status: AgentStatus.NORMAL, mintedUBA: 0, reservedUBA: 0, redeemingUBA: 0,
    announcedClass1WithdrawalWei: 0, announcedPoolTokensWithdrawalWei: 0, announcedUnderlyingWithdrawalId: 0
};

export type AgentCreateOptions = Partial<Omit<AgentSettings, 'underlyingAddressString'>>;

export class Agent extends AssetContextClient {
    constructor(
        context: AssetContext,
        public ownerColdAddress: string,
        public agentVault: AgentVaultInstance,
        public collateralPool: CollateralPoolInstance,
        public collateralPoolToken: CollateralPoolTokenInstance,
        public wallet: IBlockChainWallet,
        public settings: AgentSettings,
    ) {
        super(context);
    }

    vaultAddress = this.agentVault.address;
    underlyingAddress = this.settings.underlyingAddressString;

    static coldToHotOwnerAddress: Map<string, string> = new Map();
    static hotToColdOwnerAddress: Map<string, string> = new Map();

    static setHotAddressMapping(coldAddress: string, hotAddress: string) {
        Agent.coldToHotOwnerAddress.set(coldAddress, hotAddress);
        Agent.hotToColdOwnerAddress.set(hotAddress, coldAddress);
    }

    static getColdAddress(address: string) {
        return this.hotToColdOwnerAddress.get(address) ?? address;
    }

    static getHotAddress(address: string) {
        return this.coldToHotOwnerAddress.get(address) ?? address;
    }

    get ownerHotAddress() {
        return Agent.getHotAddress(this.ownerColdAddress);
    }

    static async changeHotAddress(ctx: AssetContext, coldAddress: string, hotAddress: string) {
        await ctx.assetManager.setOwnerHotAddress(hotAddress, { from: coldAddress });
        this.setHotAddressMapping(coldAddress, hotAddress);
    }

    static async createTest(ctx: AssetContext, ownerAddress: string, underlyingAddress: string, options?: AgentCreateOptions) {
        if (!(ctx.chain instanceof MockChain)) assert.fail("only for mock chains");
        // mint some funds on underlying address (just enough to make EOA proof)
        if (ctx.chainInfo.requireEOAProof) {
            ctx.chain.mint(underlyingAddress, ctx.chain.requiredFee.addn(1));
        }
        // create mock wallet
        const wallet = new MockChainWallet(ctx.chain);
        // complete settings
        const settings = createTestAgentSettings(underlyingAddress, options?.class1CollateralToken ?? ctx.usdc.address, options);
        return await Agent.create(ctx, ownerAddress, wallet, settings);
    }

    static async create(ctx: AssetContext, ownerAddress: string, wallet: IBlockChainWallet, settings: AgentSettings) {
        // create and prove transaction from underlyingAddress if EOA required
        if (ctx.chainInfo.requireEOAProof) {
            const underlyingAddress = settings.underlyingAddressString;
            const txHash = await wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(ownerAddress));
            if (ctx.chain.finalizationBlocks > 0) {
                await ctx.waitForUnderlyingTransactionFinalization(undefined, txHash);
            }
            const proof = await ctx.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
            await ctx.assetManager.proveUnderlyingAddressEOA(proof, { from: ownerAddress });
        }
        // create agent
        const response = await ctx.assetManager.createAgent(web3DeepNormalize(settings), { from: ownerAddress });
        // extract agent vault address from AgentCreated event
        const args = requiredEventArgs(response, 'AgentCreated');
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(args.agentVault);
        // get collateral pool
        const collateralPool = await CollateralPool.at(args.collateralPool);
        // get pool token
        const poolTokenAddress = await collateralPool.poolToken();
        const collateralPoolToken = await CollateralPoolToken.at(poolTokenAddress);
        // create object
        const ownerColdAddress = Agent.getColdAddress(ownerAddress);
        return new Agent(ctx, ownerColdAddress, agentVault, collateralPool, collateralPoolToken, wallet, settings);
    }

    class1Token() {
        return requireNotNull(Object.values(this.context.stablecoins).find(token => token.address === this.settings.class1CollateralToken));
    }

    class1Collateral() {
        return requireNotNull(this.context.collaterals.find(c => c.token === this.settings.class1CollateralToken));
    }

    async usd5ToClass1Wei(usd5: BN) {
        const ftsoAddress = await this.context.ftsoRegistry.getFtsoBySymbol(this.class1Collateral().tokenFtsoSymbol);
        const ftso = await Ftso.at(ftsoAddress);
        const { 0: class1Price, 2: class1Decimals } = await ftso.getCurrentPriceWithDecimals();
        return usd5.mul(toWei(10**class1Decimals.toNumber())).div(class1Price);
    }

    async changeSettings(changes: Partial<Record<AgentSetting, BNish>>) {
        let validAt = BN_ZERO;
        for (const [name, value] of Object.entries(changes)) {
            const res = await this.assetManager.announceAgentSettingUpdate(this.vaultAddress, name, value, { from: this.ownerHotAddress });
            const announcement = requiredEventArgs(res, 'AgentSettingChangeAnnounced');
            validAt = maxBN(validAt, toBN(announcement.validAt));
        }
        if (validAt.isZero()) return;   // no execute needed
        await time.increaseTo(validAt);
        for (const [name, value] of Object.entries(changes)) {
            await this.assetManager.executeAgentSettingUpdate(this.vaultAddress, name, { from: this.ownerHotAddress });
        }
    }

    async depositClass1Collateral(amountTokenWei: BNish) {
        const class1Token = this.class1Token();
        await class1Token.mintAmount(this.ownerHotAddress, amountTokenWei);
        await class1Token.approve(this.agentVault.address, amountTokenWei, { from: this.ownerHotAddress });
        return await this.agentVault.depositCollateral(class1Token.address, amountTokenWei, { from: this.ownerHotAddress });
    }

    // adds pool collateral and agent pool tokens
    async buyCollateralPoolTokens(amountNatWei: BNish) {
        return await this.agentVault.buyCollateralPoolTokens({ from: this.ownerHotAddress, value: toBN(amountNatWei) });
    }

    async hasLiquidationEnded(tx: Truffle.TransactionResponse<any>) {
        // const tr = await web3.eth.getTransaction(res.tx);
        // const res2 = await this.assetManager.getPastEvents('LiquidationEnded', { fromBlock: tr.blockNumber!, toBlock: tr.blockNumber!, filter: { transactionHash: res.tx } })
        // return res2.length > 0 ? (res2[0] as any).args as EventArgs<LiquidationEnded> : undefined;
    }

    async makeAvailable() {
        const res = await this.assetManager.makeAgentAvailable(this.vaultAddress, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'AgentAvailable');
    }

    async depositCollateralsAndMakeAvailable(class1Collateral: BNish, poolCollateral: BNish) {
        await this.depositClass1Collateral(class1Collateral);
        await this.buyCollateralPoolTokens(poolCollateral);
        await this.makeAvailable();
    }

    async announceExitAvailable() {
        const res = await this.assetManager.announceExitAvailableAgentList(this.vaultAddress, { from: this.ownerHotAddress });
        const args = requiredEventArgs(res, 'AvailableAgentExitAnnounced');
        assert.equal(args.agentVault, this.vaultAddress);
        return args.exitAllowedAt;
    }

    async exitAvailable(announceFirst: boolean = true) {
        if (announceFirst) {
            const exitAllowedAt = await this.announceExitAvailable();
            await time.increaseTo(exitAllowedAt);
        }
        const res = await this.assetManager.exitAvailableAgentList(this.vaultAddress, { from: this.ownerHotAddress });
        const args = requiredEventArgs(res, 'AvailableAgentExited');
        assert.equal(args.agentVault, this.vaultAddress);
    }

    async exitAndDestroy(collateral: BNish) {
        // exit available
        await this.exitAvailable();
        // withdraw pool fees
        const poolFeeBalance = await this.poolFeeBalance();
        const ownerFAssetBalance = await this.fAsset.balanceOf(this.ownerHotAddress);
        if (poolFeeBalance.gt(BN_ZERO)) await this.withdrawPoolFees(poolFeeBalance);
        const ownerFAssetBalanceAfter = await this.fAsset.balanceOf(this.ownerHotAddress);
        // check that we received exactly the agent vault's fees in fasset
        assertWeb3Equal(await this.poolFeeBalance(), 0);
        assertWeb3Equal(ownerFAssetBalanceAfter.sub(ownerFAssetBalance), poolFeeBalance);
        // self close all received pool fees - otherwise we cannot withdraw all pool collateral
        if (poolFeeBalance.gt(BN_ZERO)) await this.selfClose(poolFeeBalance);
        // nothing must be minted now
        const info = await this.getAgentInfo();
        assertWeb3Equal(info.mintedUBA, 0);
        // redeem pool tokens to empty the pool (this only works in tests where there are no other pool token holders)
        const poolTokenBalance = await this.poolTokenBalance();
        const { withdrawalAllowedAt } = await this.announcePoolTokenRedemption(poolTokenBalance);
        await time.increaseTo(withdrawalAllowedAt);
        await this.redeemCollateralPoolTokens(poolTokenBalance);
        // ... now the agent should wait for all pool token holders to exit ...
        // destroy (no need to pull out class1 collateral first, it will be withdrawn automatically during destroy)
        const destroyAllowedAt = await this.announceDestroy();
        await time.increaseTo(destroyAllowedAt);
        const class1Token = this.class1Token();
        const ownerClass1Balance = await class1Token.balanceOf(this.ownerHotAddress);
        await this.destroy();
        const ownerClass1BalanceAfterDestroy = await class1Token.balanceOf(this.ownerHotAddress);
        assertWeb3Equal(ownerClass1BalanceAfterDestroy.sub(ownerClass1Balance), collateral);
    }

    async exitAndDestroyWithTerminatedFAsset(collateral: BNish) {
        await this.exitAvailable();
        // note that here we can't redeem anything from the pool as f-asset is terminated
        // TODO: we should still be able to withdraw pool collateral (and leave pool fees behind)
        const destroyAllowedAt = await this.announceDestroy();
        await time.increaseTo(destroyAllowedAt);
        const class1Token = this.class1Token();
        const ownerClass1Balance = await class1Token.balanceOf(this.ownerHotAddress);
        await this.destroy();
        const ownerClass1BalanceAfterDestroy = await class1Token.balanceOf(this.ownerHotAddress);
        assertWeb3Equal(ownerClass1BalanceAfterDestroy.sub(ownerClass1Balance), collateral);
    }

    async announceClass1CollateralWithdrawal(amountWei: BNish) {
        await this.assetManager.announceClass1CollateralWithdrawal(this.vaultAddress, amountWei, { from: this.ownerHotAddress });
    }

    async withdrawClass1Collateral(amountWei: BNish) {
        return await this.agentVault.withdrawCollateral(this.settings.class1CollateralToken, amountWei, this.ownerHotAddress, { from: this.ownerHotAddress });
    }

    async poolTokenBalance() {
        return await this.collateralPoolToken.balanceOf(this.vaultAddress);
    }

    async poolCollateralBalance() {
        const tokens = await this.poolTokenBalance();
        const tokenSupply = await this.collateralPoolToken.totalSupply();
        const poolCollateral = await this.context.wNat.balanceOf(this.collateralPool.address);
        return poolCollateral.mul(tokens).div(tokenSupply);
    }

    async announcePoolTokenRedemption(amountWei: BNish) {
        const res = await this.assetManager.announceAgentPoolTokenRedemption(this.vaultAddress, amountWei, { from: this.ownerHotAddress });
        const args = requiredEventArgs(res, 'PoolTokenRedemptionAnnounced');
        assert.equal(args.agentVault, this.vaultAddress);
        return args;
    }

    async redeemCollateralPoolTokens(amountWei: BNish) {
        return await this.agentVault.redeemCollateralPoolTokens(amountWei, this.ownerHotAddress, { from: this.ownerHotAddress });
    }

    async withdrawPoolFees(amountUBA: BNish) {
        await this.agentVault.withdrawPoolFees(amountUBA, this.ownerHotAddress, { from: this.ownerHotAddress });
    }

    async poolFeeBalance() {
        return await this.collateralPool.fAssetFeesOf(this.vaultAddress);
    }

    async announceDestroy() {
        const res = await this.assetManager.announceDestroyAgent(this.vaultAddress, { from: this.ownerHotAddress });
        const args = requiredEventArgs(res, 'AgentDestroyAnnounced');
        assert.equal(args.agentVault, this.vaultAddress);
        return args.destroyAllowedAt;
    }

    async destroy() {
        const res = await this.assetManager.destroyAgent(this.vaultAddress, this.ownerHotAddress, { from: this.ownerHotAddress });
        const args = requiredEventArgs(res, 'AgentDestroyed');
        assert.equal(args.agentVault, this.vaultAddress);
        return res;
    }

    async performTopupPayment(amount: BNish, mint: boolean = true, underlyingAddress: string = "someAddress") {
        if (mint) {
            if (!(this.chain instanceof MockChain)) assert.fail("only for mock chains");
            this.chain.mint(underlyingAddress, amount);
        }
        return await this.wallet.addTransaction(underlyingAddress, this.underlyingAddress, amount, PaymentReference.topup(this.agentVault.address));
    }

    async confirmTopupPayment(transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, null, this.underlyingAddress);
        await this.assetManager.confirmTopupPayment(proof, this.agentVault.address, { from: this.ownerHotAddress });
    }

    async announceUnderlyingWithdrawal() {
        const res = await this.assetManager.announceUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalAnnounced');
    }

    async performUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, amount: BNish, underlyingAddress: string = "someAddress") {
        return await this.wallet.addTransaction(this.underlyingAddress, underlyingAddress, amount, request.paymentReference);
    }

    async confirmUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, null);
        const res = await this.assetManager.confirmUnderlyingWithdrawal(proof, this.agentVault.address, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalConfirmed');
    }

    async cancelUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>) {
        const res = await this.assetManager.cancelUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalCancelled');
    }

    async performRedemptionPayment(request: EventArgs<RedemptionRequested>, options?: MockTransactionOptionsWithFee) {
        const paymentAmount = request.valueUBA.sub(request.feeUBA);
        return await this.performPayment(request.paymentAddress, paymentAmount, request.paymentReference, options);
    }

    async confirmActiveRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'RedemptionPerformed');
    }

    async confirmDefaultedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerHotAddress });
        checkEventNotEmited(res, 'RedemptionPerformed');
        return res;
    }

    async confirmFailedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string): Promise<[redemptionPaymentFailed: EventArgs<RedemptionPaymentFailed>, redemptionDefault: EventArgs<RedemptionDefault>]>  {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerHotAddress });
        return [requiredEventArgs(res, 'RedemptionPaymentFailed'), requiredEventArgs(res, 'RedemptionDefault')];
    }

    async confirmBlockedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'RedemptionPaymentBlocked');
    }

    async redemptionPaymentDefault(request: EventArgs<RedemptionRequested>) {
        const proof = await this.attestationProvider.proveReferencedPaymentNonexistence(
            request.paymentAddress,
            request.paymentReference,
            request.valueUBA.sub(request.feeUBA),
            request.lastUnderlyingBlock.toNumber(),
            request.lastUnderlyingTimestamp.toNumber());
        const res = await this.assetManager.redemptionPaymentDefault(proof, request.requestId, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'RedemptionDefault');
    }

    async finishRedemptionWithoutPayment(request: EventArgs<RedemptionRequested>): Promise<EventArgs<RedemptionDefault>> {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists();
        const res = await this.assetManager.finishRedemptionWithoutPayment(proof, request.requestId, { from: this.ownerHotAddress });
        return eventArgs(res, "RedemptionDefault");
    }

    async getRedemptionPaymentDefaultValue(lots: BNish): Promise<[BN, BN]> {
        const uba = this.context.convertLotsToUBA(lots);
        const agentInfo = await this.getAgentInfo();
        const totalUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.reservedUBA)).add(toBN(agentInfo.redeemingUBA));
        const maxRedemptionCollateral = toBN(agentInfo.totalClass1CollateralWei).mul(uba).div(totalUBA);
        const priceClass1 = await this.context.getCollateralPrice(this.class1Collateral());
        const redemptionDefaultAgent = priceClass1.convertUBAToTokenWei(uba).mul(
            toBN(this.context.settings.redemptionDefaultFactorAgentC1BIPS)).divn(MAX_BIPS);
        const priceNat = await this.context.getCollateralPrice(this.context.collaterals[0]);
        const redemptionDefaultPool = priceNat.convertUBAToTokenWei(uba).mul(
            toBN(this.context.settings.redemptionDefaultFactorPoolBIPS)).divn(MAX_BIPS);
        if (redemptionDefaultAgent.gt(maxRedemptionCollateral)) {
            // TODO: additional funds taken from pool
        }
        return [redemptionDefaultAgent, redemptionDefaultPool];
    }

    async executeMinting(crt: EventArgs<CollateralReserved>, transactionHash: string, minter?: Minter) {
        let sourceAddress: string;
        if (minter) {
            sourceAddress = minter.underlyingAddress;
        } else {
            const tx = await this.chain.getTransaction(transactionHash);
            sourceAddress = tx?.inputs[0][0]!;
        }
        const proof = await this.attestationProvider.provePayment(transactionHash, sourceAddress, this.underlyingAddress);
        const res = await this.assetManager.executeMinting(proof, crt.collateralReservationId, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async mintingPaymentDefault(crt: EventArgs<CollateralReserved>) {
        const proof = await this.attestationProvider.proveReferencedPaymentNonexistence(
            this.underlyingAddress,
            crt.paymentReference,
            crt.valueUBA.add(crt.feeUBA),
            crt.lastUnderlyingBlock.toNumber(),
            crt.lastUnderlyingTimestamp.toNumber());
        const res = await this.assetManager.mintingPaymentDefault(proof, crt.collateralReservationId, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'MintingPaymentDefault');
    }

    async class1ToNatBurned(burnedWei: BNish): Promise<BN> {
        const class1Price = await this.context.getCollateralPrice(this.class1Collateral())
        const burnedUBA = class1Price.convertTokenWeiToUBA(burnedWei);
        return this.class1ToNatBurned(burnedUBA);
    }

    async class1ToNatBurnedInUBA(uba: BNish): Promise<BN> {
        const natPrice = await this.context.getCollateralPrice(this.context.collaterals[0]);
        const reservedCollateralNAT = natPrice.convertAmgToTokenWei(this.context.convertUBAToAmg(uba));
        return reservedCollateralNAT.mul(toBN(this.context.settings.class1BuyForFlareFactorBIPS)).divn(MAX_BIPS);
    }

    async unstickMintingCostNAT(crt: EventArgs<CollateralReserved>): Promise<BN> {
        const class1Price = await this.context.getCollateralPrice(this.class1Collateral());
        const burnedWei = class1Price.convertUBAToTokenWei(crt.valueUBA);
        return this.class1ToNatBurned(burnedWei);
    }

    async unstickMinting(crt: EventArgs<CollateralReserved>) {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists();
        const unstickMintingCost = await this.unstickMintingCostNAT(crt);
        await this.assetManager.unstickMinting(proof, crt.collateralReservationId, { from: this.ownerHotAddress, value: unstickMintingCost });
    }

    async selfMint(amountUBA: BNish, lots: BNish) {
        if (!(this.context.chain instanceof MockChain)) assert.fail("only for mock chains");
        const randomAddr = randomAddress();
        const poolFeeUBA = toBN(amountUBA).mul(toBN(this.settings.feeBIPS)).divn(MAX_BIPS).mul(toBN(this.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
        const depositUBA = toBN(amountUBA).add(poolFeeUBA);
        this.context.chain.mint(randomAddr, depositUBA);
        const transactionHash = await this.wallet.addTransaction(randomAddr, this.underlyingAddress, depositUBA, PaymentReference.selfMint(this.agentVault.address));
        const proof = await this.attestationProvider.provePayment(transactionHash, null, this.underlyingAddress);
        const res = await this.assetManager.selfMint(proof, this.agentVault.address, lots, { from: this.ownerHotAddress });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async selfClose(amountUBA: BNish): Promise<[dustChangesUBA: BN[], selfClosedValueUBA: BN, liquidationCancelledEvent: EventArgs<LiquidationEnded>]> {
        const res = await this.assetManager.selfClose(this.agentVault.address, amountUBA, { from: this.ownerHotAddress });
        const dustChangedEvents = filterEvents(res, 'DustChanged').map(e => e.args);
        const selfClose = requiredEventArgs(res, 'SelfClose');
        dustChangedEvents.every(dc => assert.equal(dc.agentVault, this.agentVault.address));
        assert.equal(selfClose.agentVault, this.agentVault.address);
        return [dustChangedEvents.map(dc => dc.dustUBA), selfClose.valueUBA, eventArgs(res, "LiquidationEnded")];
    }

    async performPayment(paymentAddress: string, paymentAmount: BNish, paymentReference: string | null = null, options?: MockTransactionOptionsWithFee) {
        return this.wallet.addTransaction(this.underlyingAddress, paymentAddress, paymentAmount, paymentReference, options);
    }

    async getCurrentClass1CollateralRatioBIPS() {
        const agentInfo = await this.getAgentInfo();
        const fullCollateral = agentInfo.totalClass1CollateralWei;
        const mintedUBA = agentInfo.mintedUBA;
        const reservedUBA = agentInfo.reservedUBA;
        const redeemingUBA = agentInfo.redeemingUBA;
        return this.getCollateralRatioBIPS(fullCollateral, mintedUBA, reservedUBA, redeemingUBA);
    }

    async getCollateralRatioBIPS(fullCollateral: BNish, mintedUBA: BNish, reservedUBA: BNish = 0, redeemingUBA: BNish = 0) {
        const mintedAMG = this.context.convertUBAToAmg(mintedUBA);
        const reservedAMG = this.context.convertUBAToAmg(reservedUBA);
        const redeemingAMG = this.context.convertUBAToAmg(redeemingUBA);
        const ratio = await this.collateralRatio(fullCollateral, mintedAMG, reservedAMG, redeemingAMG);
        const ratioTrusted = await this.collateralRatio(fullCollateral, mintedAMG, reservedAMG, redeemingAMG);
        return ratio.gt(ratioTrusted) ? ratio : ratioTrusted;
    }

    private async collateralRatio(fullCollateral: BNish, mintedAMG: BNish, reservedAMG: BNish = 0, redeemingAMG: BNish = 0) {
        const totalAMG = toBN(reservedAMG).add(toBN(mintedAMG)).add(toBN(redeemingAMG));
        if (totalAMG.eqn(0)) return toBN(2).pow(toBN(256)).subn(1);    // nothing minted - ~infinite collateral ratio
        const priceClass1 = await this.context.getCollateralPrice(this.class1Collateral());
        const backingClass1Wei = priceClass1.convertAmgToTokenWei(totalAMG);
        return toBN(fullCollateral).muln(MAX_BIPS).div(backingClass1Wei);
    }

//     async lockedCollateralWei(mintedUBA: BNish, reservedUBA: BNish = 0, redeemingUBA: BNish = 0, withdrawalAnnouncedNATWei: BNish = 0) {
//         const settings = await this.assetManager.getSettings();
//         const agentInfo = await this.assetManager.getAgentInfo(this.agentVault.address);
//         const prices = await this.context.getPrices();
//         const mintedAMG = this.context.convertUBAToAmg(mintedUBA);
//         const reservedAMG = this.context.convertUBAToAmg(reservedUBA);
//         const redeemingAMG = this.context.convertUBAToAmg(redeemingUBA);
//         const mintingAMG = reservedAMG.add(mintedAMG);
//         const minCollateralRatio = agentInfo.agentMinCollateralRatioBIPS;
//         const mintingCollateral = this.context.convertAmgToNATWei(mintingAMG, amgToNATWeiPrice)
//             .mul(toBN(minCollateralRatio)).divn(10_000);
//         const redeemingCollateral = this.context.convertAmgToNATWei(redeemingAMG, amgToNATWeiPrice)
//             .mul(toBN(settings.minCollateralRatioBIPS)).divn(10_000);
//         return mintingCollateral.add(redeemingCollateral).add(toBN(withdrawalAnnouncedNATWei));
//    }

    async endLiquidation() {
        const res = await this.assetManager.endLiquidation(this.vaultAddress, { from: this.ownerHotAddress });
        assert.equal(requiredEventArgs(res, 'LiquidationEnded').agentVault, this.vaultAddress);
    }

    async getBuybackAgentCollateralValue() {
        const agentInfo = await this.getAgentInfo();
        const totalUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.reservedUBA));
        const totalUBAWithBuybackPremium = totalUBA.mul(toBN(this.context.settings.buybackCollateralFactorBIPS)).divn(MAX_BIPS);
        const priceClass1 = await this.context.getCollateralPrice(this.class1Collateral());
        const natBurned = await this.class1ToNatBurnedInUBA(totalUBAWithBuybackPremium);
        const buybackCollateral = priceClass1.convertUBAToTokenWei(totalUBAWithBuybackPremium);
        return [buybackCollateral, totalUBA, natBurned];
    }

    async buybackAgentCollateral() {
        const [,, buybackCost] = await this.getBuybackAgentCollateralValue()
        await this.assetManager.buybackAgentCollateral(this.agentVault.address, { from: this.ownerHotAddress, value: buybackCost });
    }

    // async calculateFreeCollateralLots(freeCollateralUBA: BNish) {
    //     const settings = await this.context.assetManager.getSettings();
    //     const agentInfo = await this.context.assetManager.getAgentInfo(this.agentVault.address);
    //     const minCollateralRatio = Math.max(toBN(agentInfo.agentMinCollateralRatioBIPS).toNumber(), toBN(settings.minCollateralRatioBIPS).toNumber());
    //     const lotCollateral = this.context.convertAmgToNATWei(settings.lotSizeAMG, await this.context.currentAmgToNATWeiPrice())
    //         .muln(minCollateralRatio)
    //         .divn(10_000);
    //     return toBN(freeCollateralUBA).div(lotCollateral);
    // }

    lastAgentInfoCheck: CheckAgentInfo = CHECK_DEFAULTS;

    async checkAgentInfo(check: CheckAgentInfo, keepPreviousChecks: boolean = true) {
        const agentCollateral = await this.getAgentCollateral();
        const agentInfo = agentCollateral.agentInfo;
        // collateral calculation checks
        assertWeb3Equal(agentCollateral.class1.balance, agentInfo.totalClass1CollateralWei);
        assertWeb3Equal(agentCollateral.pool.balance, agentInfo.totalPoolCollateralNATWei);
        assertWeb3Equal(agentCollateral.agentPoolTokens.balance, agentInfo.totalAgentPoolTokensWei);
        assertWeb3Equal(agentCollateral.freeCollateralLots(), agentInfo.freeCollateralLots);
        assertWeb3Equal(agentCollateral.freeCollateralWei(agentCollateral.class1), agentInfo.freeClass1CollateralWei);
        assertWeb3Equal(agentCollateral.freeCollateralWei(agentCollateral.pool), agentInfo.freePoolCollateralNATWei);
        assertApproximateMatch(agentCollateral.freeCollateralWei(agentCollateral.agentPoolTokens), Approximation.absolute(agentInfo.freeAgentPoolTokensWei, 1000));
        // assertWeb3Equal(agentCollateral.freeCollateralWei(agentCollateral.agentPoolTokens), agentInfo.freeAgentPoolTokensWei);
        assertWeb3Equal(agentCollateral.collateralRatioBIPS(agentCollateral.class1), agentInfo.class1CollateralRatioBIPS);
        assertWeb3Equal(agentCollateral.collateralRatioBIPS(agentCollateral.pool), agentInfo.poolCollateralRatioBIPS);
        // keep the check from prevous
        if (keepPreviousChecks) {
            check = { ...this.lastAgentInfoCheck, ...check };
        }
        for (const key of Object.keys(check) as Array<keyof CheckAgentInfo>) {
            let value: any;
            if (key === 'actualUnderlyingBalance') {
                value = await this.chain.getBalance(this.underlyingAddress);
            } else {
                value = agentInfo[key];
            }
            const expected = check[key];
            if (expected instanceof Approximation) {
                expected.assertMatches(value, `Agent info mismatch at '${key}'`);
            } else {
                assertWeb3Equal(value, expected, `Agent info mismatch at '${key}'`);
            }
        }
        this.lastAgentInfoCheck = check;
        return agentInfo;
    }

    async getAgentCollateral() {
        return await AgentCollateral.create(this.assetManager, this.context.settings, this.vaultAddress);
    }

    async getAgentInfo() {
        return await this.assetManager.getAgentInfo(this.agentVault.address);
    }

    async getTotalBackedAssetUBA() {
        const agentInfo = await this.getAgentInfo();
        return toBN(agentInfo.mintedUBA).add(toBN(agentInfo.reservedUBA)).add(toBN(agentInfo.redeemingUBA));
    }

    async setClass1CollateralRatioByChangingAssetPrice(ratioBIPS: number) {
        const class1Collateral = this.class1Collateral();
        const totalUBA = await this.getTotalBackedAssetUBA();
        const agentInfo = await this.getAgentInfo();
        const { 0: class1Price } = await this.context.ftsos[class1Collateral.tokenFtsoSymbol].getCurrentPrice();
        const assetPriceUBA = class1Price.mul(toBN(agentInfo.totalClass1CollateralWei)).div(totalUBA).muln(MAX_BIPS).divn(ratioBIPS);
        const assetPrice = assetPriceUBA.mul(toBNExp(1, this.context.chainInfo.decimals)).div(toBNExp(1, Number(class1Collateral.decimals)));
        await this.context.assetFtso.setCurrentPrice(assetPrice, 0);
        await this.context.assetFtso.setCurrentPriceFromTrustedProviders(assetPrice, 0);
    }

    async setPoolCollateralRatioByChangingAssetPrice(ratioBIPS: number) {
        const poolCollateral = this.context.collaterals[0];
        const totalUBA = await this.getTotalBackedAssetUBA();
        const poolBalance = await this.collateralPool.totalCollateral();
        const { 0: poolPrice } = await this.context.ftsos[poolCollateral.tokenFtsoSymbol].getCurrentPrice();
        const assetPriceUBA = poolPrice.mul(poolBalance).div(totalUBA).divn(ratioBIPS).muln(MAX_BIPS);
        const assetPrice = assetPriceUBA.mul(toBNExp(1, this.context.chainInfo.decimals)).div(toBNExp(1, Number(poolCollateral.decimals)));
        await this.context.assetFtso.setCurrentPrice(assetPrice, 0);
        await this.context.assetFtso.setCurrentPriceFromTrustedProviders(assetPrice, 0);
    }

    async getClass1CollateralToMakeCollateralRatioEqualTo(ratioBIPS: number, mintedUBA: BN) {
        const class1Collateral = this.class1Collateral();
        const { 0: class1Price } = await this.context.ftsos[class1Collateral.tokenFtsoSymbol].getCurrentPrice();
        const { 0: assetPrice } = await this.context.assetFtso.getCurrentPrice();
        return mintedUBA.mul(assetPrice).div(class1Price).muln(ratioBIPS).divn(MAX_BIPS)
            .mul(toBNExp(1, Number(class1Collateral.decimals))).div(toBNExp(1, this.context.chainInfo.decimals));
    }

    async getPoolCollateralToMakeCollateralRatioEqualTo(ratioBIPS: number, mintedUBA: BN) {
        const poolCollateral = this.context.collaterals[0];
        const { 0: natPrice } = await this.context.natFtso.getCurrentPrice();
        const { 0: assetPrice } = await this.context.assetFtso.getCurrentPrice();
        return mintedUBA.mul(assetPrice).div(natPrice).muln(ratioBIPS).divn(MAX_BIPS)
            .mul(toBNExp(1, Number(poolCollateral.decimals))).div(toBNExp(1, this.context.chainInfo.decimals));
    }

    async multiplyAssetPriceWithBIPS(factorBIPS: BNish) {
        const { 0: assetPrice } = await this.context.assetFtso.getCurrentPrice();
        const newAssetPrice = assetPrice.mul(toBN(factorBIPS)).divn(MAX_BIPS);
        await this.context.assetFtso.setCurrentPrice(newAssetPrice, 0);
        await this.context.assetFtso.setCurrentPriceFromTrustedProviders(newAssetPrice, 0);
    }
}
