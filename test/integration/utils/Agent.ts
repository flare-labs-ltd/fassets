import { time } from "@openzeppelin/test-helpers";
import { AgentInfo, AgentSetting, AgentSettings, AgentStatus, RedemptionTicketInfo } from "../../../lib/fasset/AssetManagerTypes";
import { AssetManagerEvents } from "../../../lib/fasset/IAssetContext";
import { PaymentReference } from "../../../lib/fasset/PaymentReference";
import { IBlockChainWallet } from "../../../lib/underlying-chain/interfaces/IBlockChainWallet";
import { EventArgs } from "../../../lib/utils/events/common";
import { checkEventNotEmited, eventArgs, filterEvents, requiredEventArgs } from "../../../lib/utils/events/truffle";
import { BN_ZERO, BNish, MAX_BIPS, randomAddress, requireNotNull, toBIPS, toBN, toBNExp, toWei } from "../../../lib/utils/helpers";
import { web3DeepNormalize } from "../../../lib/utils/web3normalize";
import { AgentVaultInstance, CollateralPoolInstance, CollateralPoolTokenInstance } from "../../../typechain-truffle";
import { CollateralReserved, LiquidationEnded, RedemptionDefault, RedemptionPaymentFailed, RedemptionRequested, UnderlyingWithdrawalAnnounced } from "../../../typechain-truffle/IIAssetManager";
import { Approximation, assertApproximateMatch } from "../../utils/approximation";
import { AgentCollateral } from "../../utils/fasset/AgentCollateral";
import { MockChain, MockChainWallet, MockTransactionOptionsWithFee } from "../../utils/fasset/MockChain";
import { createTestAgentSettings } from "../../utils/test-settings";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { AssetContext, AssetContextClient } from "./AssetContext";
import { Minter } from "./Minter";
import { deterministicTimeIncrease } from "../../utils/test-helpers";

const AgentVault = artifacts.require('AgentVault');
const CollateralPool = artifacts.require('CollateralPool');
const CollateralPoolToken = artifacts.require('CollateralPoolToken');
const Ftso = artifacts.require('FtsoMock');

export type CheckAgentInfo = { [K in keyof AgentInfo]?: AgentInfo[K] extends BN ? BNish | Approximation : AgentInfo[K] }
    & { actualUnderlyingBalance?: BNish };

export const CHECK_DEFAULTS: CheckAgentInfo = {
    status: AgentStatus.NORMAL, mintedUBA: 0, reservedUBA: 0, redeemingUBA: 0,
    announcedVaultCollateralWithdrawalWei: 0, announcedPoolTokensWithdrawalWei: 0, announcedUnderlyingWithdrawalId: 0
};

export type AgentCreateOptions = Partial<AgentSettings>;

export class Agent extends AssetContextClient {
    static deepCopyWithObjectCreate = true;

    constructor(
        context: AssetContext,
        public ownerManagementAddress: string,
        public agentVault: AgentVaultInstance,
        public collateralPool: CollateralPoolInstance,
        public collateralPoolToken: CollateralPoolTokenInstance,
        public wallet: IBlockChainWallet,
        public settings: AgentSettings,
        public underlyingAddress: string,
    ) {
        super(context);
    }

    vaultAddress = this.agentVault.address;

    static mgmtToWorkOwnerAddress: Map<string, string> = new Map();
    static workToMgmtOwnerAddress: Map<string, string> = new Map();

    static setWorkAddressMapping(managementAddress: string, workAddress: string) {
        Agent.mgmtToWorkOwnerAddress.set(managementAddress, workAddress);
        Agent.workToMgmtOwnerAddress.set(workAddress, managementAddress);
    }

    static getManagementAddress(address: string) {
        return this.workToMgmtOwnerAddress.get(address) ?? address;
    }

    static getWorkAddress(address: string) {
        return this.mgmtToWorkOwnerAddress.get(address) ?? address;
    }

    get ownerWorkAddress() {
        return Agent.getWorkAddress(this.ownerManagementAddress);
    }

    static async changeWorkAddress(ctx: AssetContext, managementAddress: string, workAddress: string) {
        await ctx.agentOwnerRegistry.setWorkAddress(workAddress, { from: managementAddress });
        this.setWorkAddressMapping(managementAddress, workAddress);
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
        const settings = createTestAgentSettings(options?.vaultCollateralToken ?? ctx.usdc.address, options);
        return await Agent.create(ctx, ownerAddress, underlyingAddress, wallet, settings);
    }

    static async create(ctx: AssetContext, ownerAddress: string, underlyingAddress: string, wallet: IBlockChainWallet, settings: AgentSettings) {
        // create and prove transaction from underlyingAddress if EOA required
        if (ctx.chainInfo.requireEOAProof) {
            const txHash = await wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(ownerAddress));
            if (ctx.chain.finalizationBlocks > 0) {
                await ctx.waitForUnderlyingTransactionFinalization(undefined, txHash);
            }
            const proof = await ctx.attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
            await ctx.assetManager.proveUnderlyingAddressEOA(proof, { from: ownerAddress });
        }
        // validate underlying address
        const addressValidityProof = await ctx.attestationProvider.proveAddressValidity(underlyingAddress);
        // create agent
        const response = await ctx.assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(settings), { from: ownerAddress });
        // extract agent vault address from AgentVaultCreated event
        const args = requiredEventArgs(response, 'AgentVaultCreated');
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(args.agentVault);
        // get collateral pool
        const collateralPool = await CollateralPool.at(args.creationData.collateralPool);
        // get pool token
        const collateralPoolToken = await CollateralPoolToken.at(args.creationData.collateralPoolToken);
        // create object
        const ownerManagementAddress = Agent.getManagementAddress(ownerAddress);
        return new Agent(ctx, ownerManagementAddress, agentVault, collateralPool, collateralPoolToken, wallet, settings,
            addressValidityProof.data.responseBody.standardAddress);
    }

    vaultCollateralToken() {
        return requireNotNull(Object.values(this.context.stablecoins).find(token => token.address === this.settings.vaultCollateralToken));
    }

    vaultCollateral() {
        return requireNotNull(this.context.collaterals.find(c => c.token === this.settings.vaultCollateralToken));
    }

    async usd5ToVaultCollateralWei(usd5: BN) {
        const { 0: vaultCollateralPrice, 2: vaultCollateralDecimals } =
            await this.context.priceReader.getPrice(this.vaultCollateral().tokenFtsoSymbol);
        return usd5.mul(toWei(10**vaultCollateralDecimals.toNumber())).divn(1e5).div(vaultCollateralPrice);
    }

    async changeSettings(changes: Partial<Record<AgentSetting, BNish>>) {
        let validity: Array<[name: string, validAt: BN]> = [];
        for (const [name, value] of Object.entries(changes)) {
            const res = await this.assetManager.announceAgentSettingUpdate(this.vaultAddress, name, value, { from: this.ownerWorkAddress });
            const announcement = requiredEventArgs(res, 'AgentSettingChangeAnnounced');
            validity.push([name, announcement.validAt]);
        }
        validity.sort((v1, v2) => v1[1].cmp(v2[1]));
        for (const [name, validAt] of validity) {
            if (validAt.isZero()) continue;   // no execute needed
            if (validAt.gt(await time.latest())) await time.increaseTo(validAt);
            await this.assetManager.executeAgentSettingUpdate(this.vaultAddress, name, { from: this.ownerWorkAddress });
        }
    }

    async depositVaultCollateral(amountTokenWei: BNish) {
        const vaultCollateralToken = this.vaultCollateralToken();
        await vaultCollateralToken.mintAmount(this.ownerWorkAddress, amountTokenWei);
        await vaultCollateralToken.approve(this.agentVault.address, amountTokenWei, { from: this.ownerWorkAddress });
        return await this.agentVault.depositCollateral(vaultCollateralToken.address, amountTokenWei, { from: this.ownerWorkAddress });
    }

    // adds pool collateral and agent pool tokens
    async buyCollateralPoolTokens(amountNatWei: BNish) {
        return await this.agentVault.buyCollateralPoolTokens({ from: this.ownerWorkAddress, value: toBN(amountNatWei) });
    }

    async makeAvailable() {
        const res = await this.assetManager.makeAgentAvailable(this.vaultAddress, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, 'AgentAvailable');
    }

    async depositCollateralsAndMakeAvailable(vaultCollateral: BNish, poolCollateral: BNish) {
        await this.depositVaultCollateral(vaultCollateral);
        await this.buyCollateralPoolTokens(poolCollateral);
        await this.makeAvailable();
    }

    async depositCollateralLotsAndMakeAvailable(lots: BNish, multiplier: number = 1.05) {
        const requiredCollateral = await this.requiredCollateralForLots(lots, multiplier);
        await this.depositCollateralsAndMakeAvailable(requiredCollateral.vault, requiredCollateral.pool);
    }

    async requiredCollateralForLots(lots: BNish, multiplier: number = 1.05) {   // factor 1.05 added for pool fee
        const ac = await this.getAgentCollateral();
        const amountUBA = this.context.convertLotsToUBA(lots);
        const vaultCollateralReq = ac.vault.convertUBAToTokenWei(amountUBA).mul(toBN(ac.agentInfo.mintingVaultCollateralRatioBIPS)).divn(MAX_BIPS);
        const poolCollateralReq = ac.pool.convertUBAToTokenWei(amountUBA).mul(toBN(ac.agentInfo.mintingPoolCollateralRatioBIPS)).divn(MAX_BIPS);
        const vaultCollateral = vaultCollateralReq.mul(toBIPS(multiplier)).divn(MAX_BIPS);
        const poolCollateral = poolCollateralReq.mul(toBIPS(multiplier)).divn(MAX_BIPS);
        return { vault: vaultCollateral, pool: poolCollateral  };
    }

    async announceExitAvailable() {
        const res = await this.assetManager.announceExitAvailableAgentList(this.vaultAddress, { from: this.ownerWorkAddress });
        const args = requiredEventArgs(res, 'AvailableAgentExitAnnounced');
        assert.equal(args.agentVault, this.vaultAddress);
        return args.exitAllowedAt;
    }

    async exitAvailable(announceFirst: boolean = true) {
        if (announceFirst) {
            const exitAllowedAt = await this.announceExitAvailable();
            await time.increaseTo(exitAllowedAt);
        }
        const res = await this.assetManager.exitAvailableAgentList(this.vaultAddress, { from: this.ownerWorkAddress });
        const args = requiredEventArgs(res, 'AvailableAgentExited');
        assert.equal(args.agentVault, this.vaultAddress);
    }

    async exitAndDestroy(expectedCollateral?: BNish) {
        // exit available
        await this.exitAvailable();
        // withdraw pool fees
        const poolFeeBalance = await this.poolFeeBalance();
        const ownerFAssetBalance = await this.fAsset.balanceOf(this.ownerWorkAddress);
        if (poolFeeBalance.gt(BN_ZERO)) await this.withdrawPoolFees(poolFeeBalance);
        const ownerFAssetBalanceAfter = await this.fAsset.balanceOf(this.ownerWorkAddress);
        // check that we received exactly the agent vault's fees in fasset
        assertWeb3Equal(await this.poolFeeBalance(), 0);
        assertWeb3Equal(ownerFAssetBalanceAfter.sub(ownerFAssetBalance), poolFeeBalance);
        // self close all received pool fees - otherwise we cannot withdraw all pool collateral
        if (poolFeeBalance.gt(BN_ZERO)) await this.selfClose(poolFeeBalance);
        // nothing must be minted now
        const info = await this.getAgentInfo();
        if (toBN(info.mintedUBA).gt(BN_ZERO)) {
            throw new Error("agent still backing f-assets");
        }
        // redeem pool tokens to empty the pool (this only works in tests where there are no other pool token holders)
        await deterministicTimeIncrease(await this.context.assetManager.getCollateralPoolTokenTimelockSeconds()); // wait for token timelock to expire
        const poolTokenBalance = await this.poolTokenBalance();
        const { withdrawalAllowedAt } = await this.announcePoolTokenRedemption(poolTokenBalance);
        await time.increaseTo(withdrawalAllowedAt);
        await this.redeemCollateralPoolTokens(poolTokenBalance);
        // ... now the agent should wait for all pool token holders to exit ...
        // destroy (no need to pull out vault collateral first, it will be withdrawn automatically during destroy)
        const destroyAllowedAt = await this.announceDestroy();
        await time.increaseTo(destroyAllowedAt);
        const vaultCollateralToken = this.vaultCollateralToken();
        const ownerVaultCollateralBalance = await vaultCollateralToken.balanceOf(this.ownerWorkAddress);
        await this.destroy();
        const ownerVaultCollateralBalanceAfterDestroy = await vaultCollateralToken.balanceOf(this.ownerWorkAddress);
        if (expectedCollateral != null) {
            assertWeb3Equal(ownerVaultCollateralBalanceAfterDestroy.sub(ownerVaultCollateralBalance), expectedCollateral);
        }
    }

    async exitAndDestroyWithTerminatedFAsset(collateral: BNish) {
        await this.exitAvailable();
        // note that here we can't redeem anything from the pool as f-asset is terminated
        // TODO: we should still be able to withdraw pool collateral (and leave pool fees behind)
        const destroyAllowedAt = await this.announceDestroy();
        await time.increaseTo(destroyAllowedAt);
        const vaultCollateralToken = this.vaultCollateralToken();
        const ownerVaultCollateralBalance = await vaultCollateralToken.balanceOf(this.ownerWorkAddress);
        await this.destroy();
        const ownerVaultCollateralBalanceAfterDestroy = await vaultCollateralToken.balanceOf(this.ownerWorkAddress);
        assertWeb3Equal(ownerVaultCollateralBalanceAfterDestroy.sub(ownerVaultCollateralBalance), collateral);
    }

    async announceVaultCollateralWithdrawal(amountWei: BNish) {
        const res = await this.assetManager.announceVaultCollateralWithdrawal(this.vaultAddress, amountWei, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, 'VaultCollateralWithdrawalAnnounced');
    }

    async withdrawVaultCollateral(amountWei: BNish) {
        return await this.agentVault.withdrawCollateral(this.settings.vaultCollateralToken, amountWei, this.ownerWorkAddress, { from: this.ownerWorkAddress });
    }

    async poolTokenBalance() {
        return await this.collateralPoolToken.balanceOf(this.vaultAddress);
    }

    async poolTimelockedBalance() {
        return await this.collateralPoolToken.timelockedBalanceOf(this.vaultAddress);
    }

    async poolCollateralBalance() {
        const tokens = await this.poolTokenBalance();
        const tokenSupply = await this.collateralPoolToken.totalSupply();
        const poolCollateral = await this.context.wNat.balanceOf(this.collateralPool.address);
        return poolCollateral.mul(tokens).div(tokenSupply);
    }

    async announcePoolTokenRedemption(amountWei: BNish) {
        const res = await this.assetManager.announceAgentPoolTokenRedemption(this.vaultAddress, amountWei, { from: this.ownerWorkAddress });
        const args = requiredEventArgs(res, 'PoolTokenRedemptionAnnounced');
        assert.equal(args.agentVault, this.vaultAddress);
        return args;
    }

    async redeemCollateralPoolTokens(amountWei: BNish) {
        return await this.agentVault.redeemCollateralPoolTokens(amountWei, this.ownerWorkAddress, { from: this.ownerWorkAddress });
    }

    async withdrawPoolFees(amountUBA: BNish, recipient = this.ownerWorkAddress) {
        await this.agentVault.withdrawPoolFees(amountUBA, recipient, { from: this.ownerWorkAddress });
    }

    async poolFeeBalance() {
        return await this.collateralPool.fAssetFeesOf(this.vaultAddress);
    }

    async announceDestroy() {
        const res = await this.assetManager.announceDestroyAgent(this.vaultAddress, { from: this.ownerWorkAddress });
        const args = requiredEventArgs(res, 'AgentDestroyAnnounced');
        assert.equal(args.agentVault, this.vaultAddress);
        return args.destroyAllowedAt;
    }

    async destroy() {
        const res = await this.assetManager.destroyAgent(this.vaultAddress, this.ownerWorkAddress, { from: this.ownerWorkAddress });
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
        await this.assetManager.confirmTopupPayment(proof, this.agentVault.address, { from: this.ownerWorkAddress });
    }

    async announceUnderlyingWithdrawal() {
        const res = await this.assetManager.announceUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalAnnounced');
    }

    async performUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, amount: BNish, underlyingAddress: string = "someAddress") {
        return await this.wallet.addTransaction(this.underlyingAddress, underlyingAddress, amount, request.paymentReference);
    }

    async confirmUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, null);
        const res = await this.assetManager.confirmUnderlyingWithdrawal(proof, this.agentVault.address, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalConfirmed');
    }

    async cancelUnderlyingWithdrawal(request: EventArgs<UnderlyingWithdrawalAnnounced>) {
        const res = await this.assetManager.cancelUnderlyingWithdrawal(this.agentVault.address, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, 'UnderlyingWithdrawalCancelled');
    }

    static async performRedemptions(agents: Agent[], requests: EventArgs<RedemptionRequested>[]) {
        const results: Record<string, Truffle.TransactionResponse<AssetManagerEvents>> = {};
        for (const request of requests) {
            const agent = agents.find(ag => ag.vaultAddress === request.agentVault);
            if (!agent) assert.fail(`No agent for redemption ${request.paymentReference}`);
            // perform redemption
            const txHash = await agent.performRedemptionPayment(request);
            const proof = await agent.attestationProvider.provePayment(txHash, agent.underlyingAddress, request.paymentAddress);
            const res = await agent.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: agent.ownerWorkAddress });
            results[String(request.requestId)] = res;
        }
        return results;
    }

    async performRedemptions(requests: EventArgs<RedemptionRequested>[]) {
        return await Agent.performRedemptions([this], requests);
    }

    async performRedemptionPayment(request: EventArgs<RedemptionRequested>, options?: MockTransactionOptionsWithFee) {
        const paymentAmount = request.valueUBA.sub(request.feeUBA);
        return await this.performPayment(request.paymentAddress, paymentAmount, request.paymentReference, options);
    }

    async confirmActiveRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, 'RedemptionPerformed');
    }

    async confirmDefaultedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerWorkAddress });
        checkEventNotEmited(res, 'RedemptionPerformed');
        return res;
    }

    async confirmFailedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string): Promise<[redemptionPaymentFailed: EventArgs<RedemptionPaymentFailed>, redemptionDefault: EventArgs<RedemptionDefault>]>  {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerWorkAddress });
        return [requiredEventArgs(res, 'RedemptionPaymentFailed'), requiredEventArgs(res, 'RedemptionDefault')];
    }

    async confirmBlockedRedemptionPayment(request: EventArgs<RedemptionRequested>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, request.paymentAddress);
        const res = await this.assetManager.confirmRedemptionPayment(proof, request.requestId, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, 'RedemptionPaymentBlocked');
    }

    async redemptionPaymentDefault(request: EventArgs<RedemptionRequested>) {
        const proof = await this.attestationProvider.proveReferencedPaymentNonexistence(
            request.paymentAddress,
            request.paymentReference,
            request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(),
            request.lastUnderlyingBlock.toNumber(),
            request.lastUnderlyingTimestamp.toNumber());
        const res = await this.assetManager.redemptionPaymentDefault(proof, request.requestId, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, 'RedemptionDefault');
    }

    async finishRedemptionWithoutPayment(request: EventArgs<RedemptionRequested>): Promise<EventArgs<RedemptionDefault>> {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists(this.context.attestationWindowSeconds());
        const res = await this.assetManager.finishRedemptionWithoutPayment(proof, request.requestId, { from: this.ownerWorkAddress });
        return eventArgs(res, "RedemptionDefault");
    }

    async getRedemptionPaymentDefaultValue(lots: BNish, selfCloseExit: boolean = false): Promise<[BN, BN]> {
        const uba = this.context.convertLotsToUBA(lots);
        return await this.getRedemptionPaymentDefaultValueForUBA(uba, selfCloseExit);
    }

    async getRedemptionPaymentDefaultValueForUBA(redemptionAmountUBA: BNish, selfCloseExit: boolean = false): Promise<[BN, BN]> {
        const uba = toBN(redemptionAmountUBA);
        const agentInfo = await this.getAgentInfo();
        const totalUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.reservedUBA)).add(toBN(agentInfo.redeemingUBA));
        const maxRedemptionCollateral = toBN(agentInfo.totalVaultCollateralWei).mul(uba).div(totalUBA);
        const priceVaultCollateral = await this.context.getCollateralPrice(this.vaultCollateral());
        const priceNat = await this.context.getCollateralPrice(this.context.collaterals[0]);
        let redemptionDefaultAgent;
        let redemptionDefaultPool;
        if (!selfCloseExit) {
            redemptionDefaultAgent = priceVaultCollateral.convertUBAToTokenWei(uba).mul(
                toBN(this.context.settings.redemptionDefaultFactorVaultCollateralBIPS)).divn(MAX_BIPS);
            redemptionDefaultPool = priceNat.convertUBAToTokenWei(uba).mul(
                toBN(this.context.settings.redemptionDefaultFactorPoolBIPS)).divn(MAX_BIPS);
        } else {
            redemptionDefaultAgent = priceVaultCollateral.convertUBAToTokenWei(uba);
            redemptionDefaultPool = toBN(0);
        }
        if (redemptionDefaultAgent.gt(maxRedemptionCollateral)) {
            const extraPoolAmg = this.context.convertUBAToAmg(uba).mul
                (redemptionDefaultAgent.sub(maxRedemptionCollateral)).divRound(redemptionDefaultAgent);
            return [maxRedemptionCollateral, redemptionDefaultPool.add(priceNat.convertAmgToTokenWei(extraPoolAmg))];
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
        const res = await this.assetManager.executeMinting(proof, crt.collateralReservationId, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async mintingPaymentDefault(crt: EventArgs<CollateralReserved>) {
        const proof = await this.attestationProvider.proveReferencedPaymentNonexistence(
            this.underlyingAddress,
            crt.paymentReference,
            crt.valueUBA.add(crt.feeUBA),
            crt.firstUnderlyingBlock.toNumber(),
            crt.lastUnderlyingBlock.toNumber(),
            crt.lastUnderlyingTimestamp.toNumber());
        const res = await this.assetManager.mintingPaymentDefault(proof, crt.collateralReservationId, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, 'MintingPaymentDefault');
    }

    async vaultCollateralToNatBurned(burnedWei: BNish): Promise<BN> {
        const vaultCollateralPrice = await this.context.getCollateralPrice(this.vaultCollateral())
        const burnedUBA = vaultCollateralPrice.convertTokenWeiToUBA(burnedWei);
        return this.vaultCollateralToNatBurnedInUBA(burnedUBA);
    }

    async vaultCollateralToNatBurnedInUBA(uba: BNish): Promise<BN> {
        const natPrice = await this.context.getCollateralPrice(this.context.collaterals[0]);
        const reservedCollateralNAT = natPrice.convertAmgToTokenWei(this.context.convertUBAToAmg(uba));
        return reservedCollateralNAT.mul(toBN(this.context.settings.vaultCollateralBuyForFlareFactorBIPS)).divn(MAX_BIPS);
    }

    async unstickMintingCostNAT(crt: EventArgs<CollateralReserved>): Promise<BN> {
        const vaultCollateralPrice = await this.context.getCollateralPrice(this.vaultCollateral());
        const burnedWei = vaultCollateralPrice.convertUBAToTokenWei(crt.valueUBA);
        return this.vaultCollateralToNatBurned(burnedWei);
    }

    async unstickMinting(crt: EventArgs<CollateralReserved>) {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists(this.context.attestationWindowSeconds());
        const unstickMintingCost = await this.unstickMintingCostNAT(crt);
        await this.assetManager.unstickMinting(proof, crt.collateralReservationId, { from: this.ownerWorkAddress, value: unstickMintingCost });
    }

    async selfMint(amountUBA: BNish, lots: BNish) {
        if (!(this.context.chain instanceof MockChain)) assert.fail("only for mock chains");
        const randomAddr = randomAddress();
        const poolFeeUBA = toBN(amountUBA).mul(toBN(this.settings.feeBIPS)).divn(MAX_BIPS).mul(toBN(this.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
        const depositUBA = toBN(amountUBA).add(poolFeeUBA);
        this.context.chain.mint(randomAddr, depositUBA);
        const transactionHash = await this.wallet.addTransaction(randomAddr, this.underlyingAddress, depositUBA, PaymentReference.selfMint(this.agentVault.address));
        const proof = await this.attestationProvider.provePayment(transactionHash, null, this.underlyingAddress);
        const res = await this.assetManager.selfMint(proof, this.agentVault.address, lots, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, 'SelfMint');
    }

    async mintFromFreeUnderlying(lots: BNish) {
        const res = await this.assetManager.mintFromFreeUnderlying(this.agentVault.address, lots, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, 'SelfMint');
    }

    async selfClose(amountUBA: BNish): Promise<[dustChangesUBA: BN[], selfClosedValueUBA: BN, liquidationCancelledEvent: EventArgs<LiquidationEnded>]> {
        const res = await this.assetManager.selfClose(this.agentVault.address, amountUBA, { from: this.ownerWorkAddress });
        const dustChangedEvents = filterEvents(res, 'DustChanged').map(e => e.args);
        const selfClose = requiredEventArgs(res, 'SelfClose');
        dustChangedEvents.every(dc => assert.equal(dc.agentVault, this.agentVault.address));
        assert.equal(selfClose.agentVault, this.agentVault.address);
        return [dustChangedEvents.map(dc => dc.dustUBA), selfClose.valueUBA, eventArgs(res, "LiquidationEnded")];
    }

    async performPayment(paymentAddress: string, paymentAmount: BNish, paymentReference: string | null = null, options?: MockTransactionOptionsWithFee) {
        return this.wallet.addTransaction(this.underlyingAddress, paymentAddress, paymentAmount, paymentReference, options);
    }

    async getCurrentVaultCollateralRatioBIPS() {
        const agentInfo = await this.getAgentInfo();
        const fullCollateral = agentInfo.totalVaultCollateralWei;
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
        const priceVaultCollateral = await this.context.getCollateralPrice(this.vaultCollateral());
        const backingVaultCollateralWei = priceVaultCollateral.convertAmgToTokenWei(totalAMG);
        return toBN(fullCollateral).muln(MAX_BIPS).div(backingVaultCollateralWei);
    }

    async endLiquidation() {
        const res = await this.assetManager.endLiquidation(this.vaultAddress, { from: this.ownerWorkAddress });
        assert.equal(requiredEventArgs(res, 'LiquidationEnded').agentVault, this.vaultAddress);
    }

    async getBuybackAgentCollateralValue() {
        const agentInfo = await this.getAgentInfo();
        const totalUBA = toBN(agentInfo.mintedUBA).add(toBN(agentInfo.reservedUBA));
        const totalUBAWithBuybackPremium = totalUBA.mul(toBN(this.context.settings.buybackCollateralFactorBIPS)).divn(MAX_BIPS);
        const priceVaultCollateral = await this.context.getCollateralPrice(this.vaultCollateral());
        const natBurned = await this.vaultCollateralToNatBurnedInUBA(totalUBAWithBuybackPremium);
        const buybackCollateral = priceVaultCollateral.convertUBAToTokenWei(totalUBAWithBuybackPremium);
        return [buybackCollateral, totalUBA, natBurned];
    }

    async buybackAgentCollateral() {
        const [,, buybackCost] = await this.getBuybackAgentCollateralValue()
        await this.assetManager.buybackAgentCollateral(this.agentVault.address, { from: this.ownerWorkAddress, value: buybackCost });
    }

    async transferFeeShare(maxEpochs: BNish) {
        return await this.context.assetManager.agentTransferFeeShare(this.vaultAddress, maxEpochs);
    }

    async claimTransferFees(recipient: string, maxEpochs: BNish) {
        const res = await this.context.assetManager.claimTransferFees(this.vaultAddress, recipient, maxEpochs, { from: this.ownerWorkAddress });
        return requiredEventArgs(res, "TransferFeesClaimed");
    }

    lastAgentInfoCheck: CheckAgentInfo = CHECK_DEFAULTS;

    async checkAgentInfo(check: CheckAgentInfo, previousCheck: "inherit" | "reset" = "inherit") {
        const agentCollateral = await this.getAgentCollateral();
        const agentInfo = agentCollateral.agentInfo;
        // collateral calculation checks
        assertWeb3Equal(agentCollateral.vault.balance, agentInfo.totalVaultCollateralWei);
        assertWeb3Equal(agentCollateral.pool.balance, agentInfo.totalPoolCollateralNATWei);
        assertWeb3Equal(agentCollateral.agentPoolTokens.balance, agentInfo.totalAgentPoolTokensWei);
        assertWeb3Equal(agentCollateral.freeCollateralLots(), agentInfo.freeCollateralLots);
        assertWeb3Equal(agentCollateral.freeCollateralWei(agentCollateral.vault), agentInfo.freeVaultCollateralWei);
        assertWeb3Equal(agentCollateral.freeCollateralWei(agentCollateral.pool), agentInfo.freePoolCollateralNATWei);
        assertApproximateMatch(agentCollateral.freeCollateralWei(agentCollateral.agentPoolTokens), Approximation.relative(agentInfo.freeAgentPoolTokensWei, 1e-10));
        // assertWeb3Equal(agentCollateral.freeCollateralWei(agentCollateral.agentPoolTokens), agentInfo.freeAgentPoolTokensWei);
        assertWeb3Equal(agentCollateral.collateralRatioBIPS(agentCollateral.vault), agentInfo.vaultCollateralRatioBIPS);
        assertWeb3Equal(agentCollateral.collateralRatioBIPS(agentCollateral.pool), agentInfo.poolCollateralRatioBIPS);
        // keep the check from prevous
        if (previousCheck === "inherit") {
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

    async setVaultCollateralRatioByChangingAssetPrice(ratioBIPS: number) {
        const vaultCollateral = this.vaultCollateral();
        const totalUBA = await this.getTotalBackedAssetUBA();
        const agentInfo = await this.getAgentInfo();
        const { 0: vaultCollateralPrice, 2: vaultDecimals } = await this.context.priceReader.getPrice(vaultCollateral.tokenFtsoSymbol);
        const { 2: assetDecimals } = await this.context.priceReader.getPrice(this.context.chainInfo.symbol);
        const assetPriceUBA = vaultCollateralPrice.mul(toBN(agentInfo.totalVaultCollateralWei)).div(totalUBA).muln(MAX_BIPS).divn(ratioBIPS);
        let assetPrice = assetPriceUBA.mul(toBNExp(1, this.context.chainInfo.decimals)).div(toBNExp(1, Number(vaultCollateral.decimals) + Number(vaultDecimals) - Number(assetDecimals)));
        assetPrice = await this.adjustPriceAndDecimalsToFitUInt32(this.context.chainInfo.symbol, assetPrice);
        await this.context.priceStore.setCurrentPrice(this.context.chainInfo.symbol,  assetPrice, 0);
        await this.context.priceStore.setCurrentPriceFromTrustedProviders(this.context.chainInfo.symbol,  assetPrice, 0);
    }

    async setPoolCollateralRatioByChangingAssetPrice(ratioBIPS: number) {
        const poolCollateral = this.context.collaterals[0];
        const totalUBA = await this.getTotalBackedAssetUBA();
        const poolBalance = await this.collateralPool.totalCollateral();
        const { 0: poolPrice, 2: poolDecimals } = await this.context.priceReader.getPrice(poolCollateral.tokenFtsoSymbol);
        const { 2: assetDecimals } = await this.context.priceReader.getPrice(this.context.chainInfo.symbol);
        const assetPriceUBA = poolPrice.mul(poolBalance).div(totalUBA).divn(ratioBIPS).muln(MAX_BIPS);
        let assetPrice = assetPriceUBA.mul(toBNExp(1, this.context.chainInfo.decimals)).div(toBNExp(1, Number(poolCollateral.decimals) + Number(poolDecimals) - Number(assetDecimals)));
        assetPrice = await this.adjustPriceAndDecimalsToFitUInt32(this.context.chainInfo.symbol, assetPrice);
        await this.context.priceStore.setCurrentPrice(this.context.chainInfo.symbol,  assetPrice, 0);
        await this.context.priceStore.setCurrentPriceFromTrustedProviders(this.context.chainInfo.symbol,  assetPrice, 0);
    }

    async getVaultCollateralToMakeCollateralRatioEqualTo(ratioBIPS: number, mintedUBA: BN) {
        const vaultCollateral = this.vaultCollateral();
        const { 0: vaultCollateralPrice } = await this.context.priceReader.getPrice(vaultCollateral.tokenFtsoSymbol);
        const { 0: assetPrice } = await this.context.priceReader.getPrice(this.context.chainInfo.symbol);
        return mintedUBA.mul(assetPrice).div(vaultCollateralPrice).muln(ratioBIPS).divn(MAX_BIPS)
            .mul(toBNExp(1, Number(vaultCollateral.decimals))).div(toBNExp(1, this.context.chainInfo.decimals));
    }

    async getPoolCollateralToMakeCollateralRatioEqualTo(ratioBIPS: number, mintedUBA: BN) {
        const poolCollateral = this.context.collaterals[0];
        const { 0: natPrice } = await this.context.priceReader.getPrice("NAT");
        const { 0: assetPrice } = await this.context.priceReader.getPrice(this.context.chainInfo.symbol);
        return mintedUBA.mul(assetPrice).div(natPrice).muln(ratioBIPS).divn(MAX_BIPS)
            .mul(toBNExp(1, Number(poolCollateral.decimals))).div(toBNExp(1, this.context.chainInfo.decimals));
    }

    async multiplyAssetPriceWithBIPS(factorBIPS: BNish) {
        const { 0: assetPrice } = await this.context.priceReader.getPrice(this.context.chainInfo.symbol);
        let newAssetPrice = assetPrice.mul(toBN(factorBIPS)).divn(MAX_BIPS);
        newAssetPrice = await this.adjustPriceAndDecimalsToFitUInt32(this.context.chainInfo.symbol, newAssetPrice);
        await this.context.priceStore.setCurrentPrice(this.context.chainInfo.symbol,  newAssetPrice, 0);
        await this.context.priceStore.setCurrentPriceFromTrustedProviders(this.context.chainInfo.symbol,  newAssetPrice, 0);
    }

    private async adjustPriceAndDecimalsToFitUInt32(symbol: string, price: BN) {
        const maxUInt32 = toBN(1).shln(32);
        let { 2: decimals } = await this.context.priceReader.getPrice(symbol);
        console.log(`Adjusting price=${price} decimals=${decimals}`);
        if (price.lt(maxUInt32)) return price;
        // console.log(`Before price=${price} decimals=${decimals}`);
        while (price.gte(maxUInt32)) {
            price = price.divn(10);
            decimals = decimals.subn(1);
        }
        console.log(`After price=${price} decimals=${decimals}`);
        await this.context.priceStore.setDecimals(symbol, decimals);
        return price;
    }

    poolFeeShare(fee: BNish) {
        return toBN(fee).mul(toBN(this.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
    }

    // pool's CR can fall below exitCR
    async getLotsToMintThatGetPoolCRTo(ratioBIPS: number) {
        const { 0: assetPriceMul, 1: assetPriceDiv } = await this.assetManager.assetPriceNatWei();
        const poolBalanceWei = await this.collateralPool.totalCollateral();
        const totalBackedUBA = await this.getTotalBackedAssetUBA();
        const toMintUBA = poolBalanceWei.mul(assetPriceDiv).muln(MAX_BIPS).div(assetPriceMul).divn(ratioBIPS).sub(totalBackedUBA);
        return this.context.convertUBAToLots(toMintUBA);
    }

    async getRedemptionQueue(pageSize: BNish) {
        const result: RedemptionTicketInfo[] = [];
        let firstTicketId = BN_ZERO;
        do {
            const { 0: chunk, 1: nextId } = await this.assetManager.agentRedemptionQueue(this.vaultAddress, firstTicketId, pageSize);
            result.splice(result.length, 0, ...chunk);
            firstTicketId = nextId;
        } while (!firstTicketId.eqn(0));
        return result;
    }

    async poolCRFee(lots: BNish) {
        const crFee = await this.assetManager.collateralReservationFee(lots);
        return this.poolFeeShare(crFee);
    }

    async wnatToPoolTokens(wnat: BNish) {
        const totalCollateral = await this.collateralPool.totalCollateral();
        const totalTokens = await this.collateralPoolToken.totalSupply();
        return totalCollateral.eq(BN_ZERO) ? toBN(wnat) : toBN(wnat).mul(totalTokens).div(totalCollateral);
    }

    async poolTokensToWnat(wnat: BNish) {
        const totalCollateral = await this.collateralPool.totalCollateral();
        const totalTokens = await this.collateralPoolToken.totalSupply();
        return totalTokens.eq(BN_ZERO) ? toBN(wnat) : toBN(wnat).mul(totalCollateral).div(totalTokens);
    }
}
