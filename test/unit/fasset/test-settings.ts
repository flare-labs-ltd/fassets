import { constants } from "@openzeppelin/test-helpers";
import { AttestationClientMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../typechain-truffle";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { toStringExp } from "../../utils/helpers";

export async function createTestSettings(attestationClient: AttestationClientMockInstance, wNat: WNatInstance, ftsoRegistry: FtsoRegistryMockInstance): Promise<AssetManagerSettings> {
    return {
        attestationClient: attestationClient.address,
        wNat: wNat.address,
        ftsoRegistry: ftsoRegistry.address,
        natFtsoIndex: (await ftsoRegistry.getFtsoIndex("NAT")).toString(),
        assetFtsoIndex: (await ftsoRegistry.getFtsoIndex("ETH")).toString(),
        burnAddress: constants.ZERO_ADDRESS,
        chainId: 1,
        collateralReservationFeeBIPS: 100,                      // 1%
        assetUnitUBA: toStringExp(1, 18),                       // 1e18 wei per eth
        assetMintingGranularityUBA: toStringExp(1, 9),          // 1e9 = 1 gwei
        lotSizeAMG: toStringExp(1_000, 9),                      // 1000 eth
        requireEOAAddressProof: true,
        minCollateralRatioBIPS: 2_1000,                  // 2.1
        ccbMinCollateralRatioBIPS: 1_9000,           // 1.9
        safetyMinCollateralRatioBIPS: 2_5000,              // 2.5
        underlyingBlocksForPayment: 10,
        underlyingSecondsForPayment: 120,                       // 12s per block assumed
        redemptionFeeBIPS: 200,                                 // 2%
        redemptionFailureFactorBIPS: 1_2000,                    // 1.2
        confirmationByOthersAfterSeconds: 6 * 3600,              // 6 hours
        confirmationByOthersRewardNATWei: toStringExp(100, 18),    // 100 NAT
        maxRedeemedTickets: 20,                                 // TODO: find number that fits comfortably in gas limits
        paymentChallengeRewardBIPS: 0,
        paymentChallengeRewardNATWei: toStringExp(300, 18),     // 300 NAT
        withdrawalWaitMinSeconds: 300,
        liquidationCollateralPremiumBIPS: [6000, 8000, 10000],
        ccbTimeSeconds: 180,
        liquidationStepSeconds: 90,
        maxTrustedPriceAgeSeconds: 8 * 60,
    };
}
