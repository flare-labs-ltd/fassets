import { IBlockChainWallet } from "../../../lib/underlying-chain/interfaces/IBlockChainWallet";
import { EventArgs } from "../../../lib/utils/events/common";
import { requiredEventArgs } from "../../../lib/utils/events/truffle";
import { BN_ZERO, BNish, ZERO_ADDRESS, requireNotNull, toBN } from "../../../lib/utils/helpers";
import { CollateralReserved } from "../../../typechain-truffle/IIAssetManager";
import { MockChain, MockChainWallet } from "../../utils/fasset/MockChain";
import { AssetContext, AssetContextClient } from "./AssetContext";

export class Minter extends AssetContextClient {
    static deepCopyWithObjectCreate = true;

    constructor(
        context: AssetContext,
        public address: string,
        public underlyingAddress: string,
        public wallet: IBlockChainWallet,
    ) {
        super(context);
    }

    static async createTest(ctx: AssetContext, address: string, underlyingAddress: string, underlyingBalance: BN) {
        if (!(ctx.chain instanceof MockChain)) assert.fail("only for mock chains");
        ctx.chain.mint(underlyingAddress, underlyingBalance);
        const wallet = new MockChainWallet(ctx.chain);
        return Minter.create(ctx, address, underlyingAddress, wallet);
    }

    static async create(ctx: AssetContext, address: string, underlyingAddress: string, wallet: IBlockChainWallet) {
        return new Minter(ctx, address, underlyingAddress, wallet);
    }

    async reserveCollateral(agent: string, lots: BNish, executorAddress?: string, executorFeeNatWei?: BNish) {
        const agentInfo = await this.assetManager.getAgentInfo(agent);
        const crFee = await this.getCollateralReservationFee(lots);
        const totalNatFee = executorAddress ? crFee.add(toBN(requireNotNull(executorFeeNatWei, "executor fee required if executor used"))) : crFee;
        const res = await this.assetManager.reserveCollateral(agent, lots, agentInfo.feeBIPS, executorAddress ?? ZERO_ADDRESS, [],
            { from: this.address, value: totalNatFee });
        return requiredEventArgs(res, 'CollateralReserved');
    }

    async reserveCollateralHSRequired(agent: string, lots: BNish, underlyingAddresses?: string[], executorAddress?: string, executorFeeNatWei?: BNish) {
        const agentInfo = await this.assetManager.getAgentInfo(agent);
        const crFee = await this.getCollateralReservationFee(lots);
        const totalNatFee = executorAddress ? crFee.add(toBN(requireNotNull(executorFeeNatWei, "executor fee required if executor used"))) : crFee;
        const res = await this.assetManager.reserveCollateral(agent, lots, agentInfo.feeBIPS, executorAddress ?? ZERO_ADDRESS, underlyingAddresses ?? [],
            { from: this.address, value: totalNatFee });
        return requiredEventArgs(res, 'HandShakeRequired');
    }

    async performMintingPayment(crt: EventArgs<CollateralReserved>) {
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        return this.performPayment(crt.paymentAddress, paymentAmount, crt.paymentReference);
    }

    async executeMinting(crt: EventArgs<CollateralReserved>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, crt.paymentAddress);
        const executorAddress = crt.executor !== ZERO_ADDRESS ? crt.executor : this.address;
        const res = await this.assetManager.executeMinting(proof, crt.collateralReservationId, { from: executorAddress });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async performMinting(agent: string, lots: BNish) {
        const crt = await this.reserveCollateral(agent, lots);
        const txHash = await this.performMintingPayment(crt);
        const minted = await this.executeMinting(crt, txHash);
        return [minted, crt, txHash] as const;
    }

    async getCollateralReservationFee(lots: BNish) {
        return await this.assetManager.collateralReservationFee(lots);
    }

    async performPayment(paymentAddress: string, paymentAmount: BNish, paymentReference: string | null = null) {
        return this.wallet.addTransaction(this.underlyingAddress, paymentAddress, paymentAmount, paymentReference);
    }
}
