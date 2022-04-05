import { expectRevert, time } from "@openzeppelin/test-helpers";
import { AddressUpdaterInstance, AssetManagerControllerInstance, AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, WNatInstance } from "../../../typechain-truffle";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { newAssetManager } from "../../utils/fasset/DeployAssetManager";
import { getTestFile, toBN, toBNExp } from "../../utils/helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { assertWeb3Equal, web3ResultStruct } from "../../utils/web3assertions";
import { createTestSettings } from "./test-settings";

const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const AddressUpdater = artifacts.require('AddressUpdater');
const AssetManagerController = artifacts.require('AssetManagerController');

contract(`AssetManagerController.sol; ${getTestFile(__filename)}; Asset manager controller basic tests`, async accounts => {
    const governance = accounts[10];
    let attestationClient: AttestationClientMockInstance;
    let addressUpdater: AddressUpdaterInstance;
    let assetManagerController: AssetManagerControllerInstance;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;
    let wnat: WNatInstance;
    let natFtso: FtsoMockInstance;
    let assetFtso: FtsoMockInstance;
    let settings: AssetManagerSettings;

    beforeEach(async () => {
        // create atetstation client
        attestationClient = await AttestationClient.new();
        // create WNat token
        wnat = await WNat.new(governance, "NetworkNative", "NAT");
        await setDefaultVPContract(wnat, governance);
        // create FTSOs for nat and asset and set some price
        natFtso = await FtsoMock.new("NAT");
        await natFtso.setCurrentPrice(toBNExp(1.12, 5), 0);
        assetFtso = await FtsoMock.new("ETH");
        await assetFtso.setCurrentPrice(toBNExp(3521, 5), 0);
        // create ftso registry
        const ftsoRegistry = await FtsoRegistryMock.new();
        await ftsoRegistry.addFtso(natFtso.address);
        await ftsoRegistry.addFtso(assetFtso.address);
        // create asset manager controller
        addressUpdater = await AddressUpdater.new(governance);
        assetManagerController = await AssetManagerController.new(governance, addressUpdater.address);
        // create asset manager
        settings = await createTestSettings(attestationClient, wnat, ftsoRegistry);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController.address, "Ethereum", "ETH", 18, settings);
        await assetManagerController.addAssetManager(assetManager.address, { from: governance });
    });

    describe("set and update settings with controller", () => {
        it("should correctly set asset manager settings", async () => {
            const settings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(settings.redemptionFeeBIPS, 200);
            await assetManagerController.setRedemptionFeeBips([assetManager.address], 250, { from: governance });
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.redemptionFeeBIPS, 250);
        });

        it("should not change settings if manager not passed", async () => {
            await assetManagerController.setRedemptionFeeBips([], 250, { from: governance });
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.redemptionFeeBIPS, 200);
        });

        it("should change contracts", async () => {
            await addressUpdater.update(["AddressUpdater", "AssetManagerController", "AttestationClient", "FtsoRegistry", "WNat"], 
                [addressUpdater.address, assetManagerController.address, accounts[80], accounts[81], accounts[82]],
                [assetManagerController.address], 
                { from: governance });
            const settings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(settings.attestationClient, accounts[80]);
            assertWeb3Equal(settings.ftsoRegistry, accounts[81]);
            assertWeb3Equal(settings.wNat, accounts[82]);
        });
        
        it("should change collateral settings after timelock", async () => {
            // act
            await assetManagerController.setCollateralRatios([assetManager.address], 2_2000, 1_8000, 2_4000, { from: governance });
            await time.increase(toBN(settings.timelockSeconds).addn(1));
            await time.advanceBlock();
            await assetManagerController.executeSetCollateralRatios([assetManager.address]);
            // assert
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.minCollateralRatioBIPS, 2_2000);
            assertWeb3Equal(newSettings.ccbMinCollateralRatioBIPS, 1_8000);
            assertWeb3Equal(newSettings.safetyMinCollateralRatioBIPS, 2_4000);
        });

        it("shouldn't change collateral settings without timelock", async () => {
            // act
            await assetManagerController.setCollateralRatios([assetManager.address], 2_2000, 1_8000, 2_4000, { from: governance });
            await expectRevert(assetManagerController.executeSetCollateralRatios([assetManager.address]),
                "update not valid yet");
            // assert no changes
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.minCollateralRatioBIPS, settings.minCollateralRatioBIPS);
            assertWeb3Equal(newSettings.ccbMinCollateralRatioBIPS, settings.ccbMinCollateralRatioBIPS);
            assertWeb3Equal(newSettings.safetyMinCollateralRatioBIPS, settings.safetyMinCollateralRatioBIPS);
        });
        
    });
});
