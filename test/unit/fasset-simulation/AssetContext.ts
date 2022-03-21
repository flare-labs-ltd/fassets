import { constants } from "@openzeppelin/test-helpers";
import { AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../typechain-truffle";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { newAssetManager } from "../../utils/fasset/DeployAssetManager";
import { MockAttestationProvider } from "../../utils/fasset/MockAttestationProvider";
import { MockChain } from "../../utils/fasset/MockChain";
import { toBN, toBNExp, toWei } from "../../utils/helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { web3DeepNormalize } from "../../utils/web3assertions";
import { ChainInfo, NatInfo } from "./ChainInfo";

const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');

// common context shared between several asset managers
export class CommonContext {
    constructor(
        public governance: string,
        public assetManagerController: string,
        public attestationClient: AttestationClientMockInstance,
        public ftsoRegistry: FtsoRegistryMockInstance,
        public wnat: WNatInstance,
        public natFtso: FtsoMockInstance,
    ) {}

    static async create(governance: string, assetManagerController: string, natInfo: NatInfo): Promise<CommonContext> {
        // create atetstation client
        const attestationClient = await AttestationClient.new();
        // create WNat token
        const wnat = await WNat.new(governance, natInfo.name, natInfo.symbol);
        await setDefaultVPContract(wnat, governance);
        // create NAT ftso
        const natFtso = await FtsoMock.new(natInfo.symbol);
        await natFtso.setCurrentPrice(toBNExp(natInfo.startPrice, 5));
        // create ftso registry
        const ftsoRegistry = await FtsoRegistryMock.new();
        await ftsoRegistry.addFtso(natFtso.address);
        return new CommonContext(governance, assetManagerController, attestationClient, ftsoRegistry, wnat, natFtso);
    }
}

// context, specific for each asset manager (includes common context vars)
export class AssetContext {
    constructor(
        // common context
        public governance: string,
        public assetManagerController: string,
        public attestationClient: AttestationClientMockInstance,
        public ftsoRegistry: FtsoRegistryMockInstance,
        public wnat: WNatInstance,
        public natFtso: FtsoMockInstance,
        // asset context
        public chainInfo: ChainInfo,
        public chain: MockChain,
        public attestationProvider: MockAttestationProvider,
        public settings: AssetManagerSettings,
        public assetManager: AssetManagerInstance,
        public fAsset: FAssetInstance,
        public assetFtso: FtsoMockInstance,
    ) {
    }

    get chainId() {
        return this.chainInfo.chainId;
    }
    
    /**
     * Convert underlying amount to base units (e.g. eth to wei)
     */
    underlyingAmount(value: number) {
        return toBNExp(value, this.chainInfo.decimals);
    }
    
    lotsSize() {
        return toBN(this.settings.lotSizeAMG).mul(toBN(this.settings.assetMintingGranularityUBA));
    }
    
    async updateUnderlyingBlock() {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists(this.chain.blocks.length - 1);
        await this.assetManager.updateCurrentBlock(proof);
    }
    
    static async create(common: CommonContext, chainInfo: ChainInfo): Promise<AssetContext> {
        // create mock chain attestation provider
        const chain = new MockChain();
        const attestationProvider = new MockAttestationProvider(chain, common.attestationClient, chainInfo.chainId);
        // create asset FTSO and set some price
        const assetFtso = await FtsoMock.new(chainInfo.symbol);
        await assetFtso.setCurrentPrice(toBNExp(chainInfo.startPrice, 5));
        await common.ftsoRegistry.addFtso(assetFtso.address);
        // create asset manager
        const settings = await AssetContext.createTestSettings(common, chainInfo);
        // web3DeepNormalize is required when passing structs, otherwise BN is incorrectly serialized
        const [assetManager, fAsset] = await newAssetManager(common.governance, common.assetManagerController,
            chainInfo.name, chainInfo.symbol, chainInfo.decimals, web3DeepNormalize(settings));
        return new AssetContext(common.governance, common.assetManagerController, common.attestationClient, common.ftsoRegistry, common.wnat, common.natFtso,
            chainInfo, chain, attestationProvider, settings, assetManager, fAsset, assetFtso);
    }
    
    static async createTestSettings(ctx: CommonContext, ci: ChainInfo): Promise<AssetManagerSettings> {
        return {
            attestationClient: ctx.attestationClient.address,
            wNat: ctx.wnat.address,
            ftsoRegistry: ctx.ftsoRegistry.address,
            natFtsoIndex: await ctx.ftsoRegistry.getFtsoIndex(await ctx.wnat.symbol()),
            assetFtsoIndex: await ctx.ftsoRegistry.getFtsoIndex(ci.symbol),
            chainId: ci.chainId,
            assetUnitUBA: toBNExp(1, ci.decimals),
            assetMintingGranularityUBA: toBNExp(1, ci.amgDecimals),
            lotSizeAMG: toBNExp(ci.lotSize, ci.decimals - ci.amgDecimals),
            requireEOAAddressProof: ci.requireEOAProof,
            underlyingBlocksForPayment: ci.underlyingBlocksForPayment,
            underlyingSecondsForPayment: ci.underlyingBlocksForPayment * ci.blockTime,
            // settings that are more or less chain independent
            burnAddress: constants.ZERO_ADDRESS,            // burn address on local chain - same for all assets
            collateralReservationFeeBIPS: 100,              // 1%
            initialMinCollateralRatioBIPS: 2_1000,          // 2.1
            liquidationMinCollateralCallBandBIPS: 1_9000,   // 1.9
            liquidationMinCollateralRatioBIPS: 2_5000,      // 2.5
            redemptionFeeBips: 200,                         // 2%
            redemptionFailureFactorBIPS: 1_2000,            // 1.2
            redemptionByAnybodyAfterSeconds: 6 * 3600,      // 6 hours
            redemptionConfirmRewardNATWei: toWei(100),      // 100 NAT
            maxRedeemedTickets: 20,                         // TODO: find number that fits comfortably in gas limits
            paymentChallengeRewardBIPS: 0,
            paymentChallengeRewardNATWei: toWei(300),       // 300 NAT
            withdrawalWaitMinSeconds: 60,
            liquidationPricePremiumBIPS: 1_2500,            // 1.25
            liquidationCollateralPremiumBIPS: [6000, 8000, 10000],
            newLiquidationStepAfterMinSeconds: 90,
        };
    }
}

export class AssetContextClient {
    constructor(
        public context: AssetContext,
    ) {}
    
    protected assetManager = this.context.assetManager;
    protected chain = this.context.chain;
    protected attestationProvider = this.context.attestationProvider;
    protected wnat = this.context.wnat;
    protected fAsset = this.context.fAsset;
}
