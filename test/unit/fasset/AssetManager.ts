import { constants, expectRevert } from "@openzeppelin/test-helpers";
import { getTestFile } from "flare-smart-contracts/test/utils/constants";
import { toStringFixedPrecision } from "flare-smart-contracts/test/utils/test-helpers";
import { AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, WNatInstance } from "../../../typechain-truffle";
import { AssetManagerSettings, PaymentProof } from "../../utils/fasset/AssetManagerTypes";
import { newAssetManager } from "../../utils/fasset/DeployAssetManager";
import { assertWeb3DeepEqual, web3ResultStruct } from "../../utils/web3assertions";

const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');

function createTestSettings(attestationClient: AttestationClientMockInstance, wNat: WNatInstance, natFtso: FtsoMockInstance, assetFtso: FtsoMockInstance): AssetManagerSettings {
    return {
        attestationClient: attestationClient.address,
        wNat: wNat.address,
        natFtso: natFtso.address,
        assetFtso: assetFtso.address,
        burnAddress: constants.ZERO_ADDRESS,
        chainId: 1,
        collateralReservationFeeBIPS: 100,              // 1%
        assetUnitUBA: toStringFixedPrecision(1, 18),                // 1e18 wei per eth
        assetMintingGranularityUBA: toStringFixedPrecision(1, 9),   // 1e9 = 1 gwei
        lotSizeAMG: toStringFixedPrecision(1_000, 9),       // 1000 eth
        requireEOAAddressProof: true,
        initialMinCollateralRatioBIPS: 2_1000,          // 2.1
        liquidationMinCollateralCallBandBIPS: 1_9000,   // 1.9
        liquidationMinCollateralRatioBIPS: 2_5000,      // 2.5
        underlyingBlocksForPayment: 10,
        underlyingSecondsForPayment: 120,               // 12s per block assumed
        redemptionFeeBips: 200,                         // 2%
        redemptionFailureFactorBIPS: 1_2000,            // 1.2
        redemptionByAnybodyAfterSeconds: 6 * 3600,      // 6 hours
        redemptionConfirmRewardNATWei: toStringFixedPrecision(100, 18), // 100 NAT
        maxRedeemedTickets: 20,                         // TODO: find number that fits comfortably in gas limits
        paymentChallengeRewardBIPS: 0,
        paymentChallengeRewardAMG: toStringFixedPrecision(2, 9),    // 2 eth
        withdrawalWaitMinSeconds: 300,
        liquidationPricePremiumBIPS: 1_2500,            // 1.25
        liquidationCollateralPremiumBIPS: [6000, 8000, 10000],
        newLiquidationStepAfterMinSeconds: 90,
    };
}

// function mockPaymentProof(): PaymentProof {
//     return {
//         stateConnectorRound: 0,
//         merkleProof: [],
//         blockNumber: number | BN | string;
//         blockTimestamp: number | BN | string;
//         transactionHash: string;
//         utxo: number | BN | string;
//         sourceAddress: string;
//         receivingAddress: string;
//         paymentReference: number | BN | string;
//         spentAmount: number | BN | string;
//         receivedAmount: number | BN | string;
//         oneToOne: boolean;
//         status: number | BN | string;
        
//     };
// }

contract(`AssetManager.sol; ${getTestFile(__filename)}; Asset manager basic tests`, async accounts => {
    const governance = accounts[10];
    const assetManagerController = accounts[11];
    let attestationClient: AttestationClientMockInstance;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;
    let wnat: WNatInstance;
    let natFtso: FtsoMockInstance;
    let assetFtso: FtsoMockInstance;
    let settings: AssetManagerSettings;
    
    beforeEach(async () => {
        attestationClient = await AttestationClient.new();
        wnat = await WNat.new(governance, "NetworkNative", "NAT");
        natFtso = await FtsoMock.new();
        assetFtso = await FtsoMock.new();
        settings = createTestSettings(attestationClient, wnat, natFtso, assetFtso);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings);
    });

    describe("set and update settings", () => {
        it("should correctly set asset manager settings", async () => {
            const resFAsset = await assetManager.fAsset();
            assert.notEqual(resFAsset, constants.ZERO_ADDRESS);
            assert.equal(resFAsset, fAsset.address);
            const resSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3DeepEqual(resSettings, settings);
        });

        it("should update settings correctly", async () => {
            // act
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            newSettings.collateralReservationFeeBIPS = 150;
            await assetManager.updateSettings(newSettings, { from: assetManagerController });
            // assert
            const res = web3ResultStruct(await assetManager.getSettings());
            assertWeb3DeepEqual(newSettings, res);
        });

        it("should fail updating immutable settings", async () => {
            // act
            const currentSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            // assert
            const settingImmutable = "setting immutable";
            await expectRevert(assetManager.updateSettings({ ...currentSettings, burnAddress: "0x0000000000000000000000000000000000000001" }, { from: assetManagerController }),
                settingImmutable);
            await expectRevert(assetManager.updateSettings({ ...currentSettings, chainId: 2 }, { from: assetManagerController }),
                settingImmutable);
            await expectRevert(assetManager.updateSettings({ ...currentSettings, assetUnitUBA: 10000 }, { from: assetManagerController }),
                settingImmutable);
            await expectRevert(assetManager.updateSettings({ ...currentSettings, assetMintingGranularityUBA: 10000 }, { from: assetManagerController }),
                settingImmutable);
            await expectRevert(assetManager.updateSettings({ ...currentSettings, requireEOAAddressProof: false }, { from: assetManagerController }),
                settingImmutable);
        });
    });

    describe("create agent", () => {
        it("should prove EOA address", async () => {
            
        });
    });
});
