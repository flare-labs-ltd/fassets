import { constants } from "@openzeppelin/test-helpers";
import { setDefaultVPContract } from "flare-smart-contracts/test/utils/token-test-helpers";
import { AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, WNatInstance } from "../../../typechain-truffle";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { newAssetManager } from "../../utils/fasset/DeployAssetManager";
import { MockAttestationProvider } from "../../utils/fasset/MockAttestationProvider";
import { MockChain } from "../../utils/fasset/MockChain";
import { toBNExp, toStringExp } from "../../utils/helpers";

const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');

export interface ChainInfo {
    chainId: number;
    name: string;
    symbol: string;
    decimals: number;
    amgDecimals: number;
    startPrice: number;
    blockTime: number;
    underlyingBlocksForPayment: number;
    lotSize: number;
    requireEOAProof: boolean;
}

export interface CommonContext {
    governance: string;
    assetManagerController: string;
    wnat: WNatInstance;
    natFtso: FtsoMockInstance;
    attestationClient: AttestationClientMockInstance;
}

export interface AssetContext extends CommonContext {
    chainId: number;
    chainInfo: ChainInfo;
    chain: MockChain;
    attestationProvider: MockAttestationProvider;
    settings: AssetManagerSettings;
    assetManager: AssetManagerInstance;
    fAsset: FAssetInstance;
    assetFtso: FtsoMockInstance;
}

export const testChainInfo: { [name: string]: ChainInfo } = {
    eth: {
        chainId: 1,
        name: "Ethereum",
        symbol: "ETH",
        decimals: 18,
        amgDecimals: 9,
        startPrice: 3251.0,
        blockTime: 12,
        underlyingBlocksForPayment: 10,
        lotSize: 1000,
        requireEOAProof: true,
    },
    btc: {
        chainId: 2,
        name: "Bitcoin",
        symbol: "BTC",
        decimals: 8,
        amgDecimals: 0,
        startPrice: 45213.0,
        blockTime: 600,
        underlyingBlocksForPayment: 8,
        lotSize: 100,
        requireEOAProof: false,
    }
}

export async function createCommonContext(governance: string, assetManagerController: string): Promise<CommonContext> {
    // create atetstation client
    const attestationClient = await AttestationClient.new();
    // create WNat token
    const wnat = await WNat.new(governance, "NetworkNative", "NAT");
    await setDefaultVPContract(wnat, governance);
    // create NAT ftso
    const natFtso = await FtsoMock.new();
    await natFtso.setCurrentPrice(toBNExp(1.12, 5));
    return { governance, assetManagerController, attestationClient, wnat, natFtso };
}

export async function createAssetContext(common: CommonContext, chainInfo: ChainInfo): Promise<AssetContext> {
    // create mock chain attestation provider
    const chain = new MockChain();
    const attestationProvider = new MockAttestationProvider(chain, common.attestationClient, chainInfo.chainId);
    // create asset FTSO and set some price
    const assetFtso = await FtsoMock.new();
    await assetFtso.setCurrentPrice(toBNExp(chainInfo.startPrice, 5));
    // create asset manager
    const settings = createTestSettings(common, chainInfo, assetFtso);
    const [assetManager, fAsset] = await newAssetManager(common.governance, common.assetManagerController, 
        chainInfo.name, chainInfo.symbol, chainInfo.decimals, settings);
    return { ...common, chainId: chainInfo.chainId, chainInfo, chain, attestationProvider, assetFtso, settings, assetManager, fAsset };
}

function createTestSettings(ctx: CommonContext, ci: ChainInfo, assetFtso: FtsoMockInstance): AssetManagerSettings {
    return {
        attestationClient: ctx.attestationClient.address,
        wNat: ctx.wnat.address,
        natFtso: ctx.natFtso.address,
        assetFtso: assetFtso.address,
        chainId: ci.chainId,
        assetUnitUBA: toStringExp(1, ci.decimals),
        assetMintingGranularityUBA: toStringExp(1, ci.amgDecimals),
        lotSizeAMG: toStringExp(ci.lotSize, ci.decimals - ci.amgDecimals),
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
        redemptionConfirmRewardNATWei: toStringExp(100, 18), // 100 NAT
        maxRedeemedTickets: 20,                         // TODO: find number that fits comfortably in gas limits
        paymentChallengeRewardBIPS: 0,
        paymentChallengeRewardNATWei: toStringExp(300, 18), // 300 NAT
        withdrawalWaitMinSeconds: 60,
        liquidationPricePremiumBIPS: 1_2500,            // 1.25
        liquidationCollateralPremiumBIPS: [6000, 8000, 10000],
        newLiquidationStepAfterMinSeconds: 90,
    };
}
