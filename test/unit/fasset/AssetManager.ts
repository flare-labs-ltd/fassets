import { constants } from "@openzeppelin/test-helpers";
import { getTestFile } from "flare-smart-contracts/test/utils/constants";
import { toBNFixedPrecision } from "flare-smart-contracts/test/utils/test-helpers";
import { AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, WNatInstance } from "../../../typechain-truffle";
import { AssetManagerSettings, newAssetManager } from "../../utils/DeployAssetManager";

const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');

function createTestSettings(attestationClient: AttestationClientMockInstance, wNat: WNatInstance, natFtso: FtsoMockInstance, assetFtso: FtsoMockInstance): AssetManagerSettings {
    return {
        attestationClient: attestationClient.address,
        wNat: wNat.address,
        natFtso: natFtso.address,
        assetFtso: assetFtso.address,
        chainId: 1,
        collateralReservationFeeBIPS: 100,              // 1%
        burnAddress: constants.ZERO_ADDRESS,
        assetUnitUBA: toBNFixedPrecision(1, 18),                // 1e18 wei per eth
        assetMintingGranularityUBA: toBNFixedPrecision(1, 9),   // 1e9 = 1 gwei
        lotSizeAMG: toBNFixedPrecision(1_000, 9),       // 1000 eth
        requireEOAAddressProof: true,
        initialMinCollateralRatioBIPS: 2_1000,          // 2.1
        liquidationMinCollateralCallBandBIPS: 1_9000,   // 1.9
        liquidationMinCollateralRatioBIPS: 2_5000,      // 2.5
        underlyingBlocksForPayment: 10,
        underlyingSecondsForPayment: 120,               // 12s per block assumed
        redemptionFeeBips: 200,                         // 2%
        redemptionFailureFactorBIPS: 1_2000,            // 1.2
        redemptionByAnybodyAfterSeconds: 6 * 3600,      // 6 hours
        redemptionConfirmRewardNATWei: toBNFixedPrecision(100, 18), // 100 NAT
        maxRedeemedTickets: 20,                         // TODO: find number that fits comfortably in gas limits
        paymentChallengeRewardBIPS: 0,
        paymentChallengeRewardAMG: toBNFixedPrecision(2, 9),    // 2 eth
        withdrawalWaitMinSeconds: 300,
        liquidationPricePremiumBIPS: 1_2500,            // 1.25
        liquidationCollateralPremiumBIPS: [6000, 8000, 10000],
        newLiquidationStepAfterMinSeconds: 90,
    };
}

contract(`AssetManager.sol; ${getTestFile(__filename)}; Check point unit tests`, async accounts => {
    const governance = accounts[10];
    const assetManagerController = accounts[11];
    let attestationClient: AttestationClientMockInstance;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;
    let wnat: WNatInstance;
    let natFtso: FtsoMockInstance;
    let assetFtso: FtsoMockInstance;
    
    beforeEach(async () => {
        attestationClient = await AttestationClient.new();
        wnat = await WNat.new(governance, "NetworkNative", "NAT");
        natFtso = await FtsoMock.new();
        assetFtso = await FtsoMock.new();
        const settings = createTestSettings(attestationClient, wnat, natFtso, assetFtso);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings);
    });

    it("can create", async () => {
        
    });
});
