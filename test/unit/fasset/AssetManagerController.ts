import { expectRevert, time, expectEvent } from "@openzeppelin/test-helpers";
import { AddressUpdaterInstance, AssetManagerControllerInstance, AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, WNatInstance } from "../../../typechain-truffle";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { newAssetManager } from "../../utils/fasset/DeployAssetManager";
import { getTestFile, toBN, toBNExp, toStringExp } from "../../utils/helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { assertWeb3Equal, web3ResultStruct } from "../../utils/web3assertions";
import { createTestSettings } from "./test-settings";

const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const AddressUpdater = artifacts.require('AddressUpdater');
const AssetManagerController = artifacts.require('AssetManagerController');

function randomAddress() {
    return web3.utils.toChecksumAddress(web3.utils.randomHex(20))
}

contract(`AssetManagerController.sol; ${getTestFile(__filename)}; Asset manager controller basic tests`, async accounts => {
    const governance = accounts[10];
    const updateExecutor = accounts[11];
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
        settings = createTestSettings(attestationClient, wnat, ftsoRegistry);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController.address, "Ethereum", "ETH", 18, settings);
        await assetManagerController.addAssetManager(assetManager.address, { from: governance });
    });

    describe("set and update settings with controller", () => {

        it("should know about governance", async () => {
            const governance_test = await assetManagerController.governance();
            assert.equal(governance, governance_test);
        }) 

        it("should get asset managers and check if exist", async () => {
            const managers = await assetManagerController.getAssetManagers();
            assert.equal(assetManager.address, managers[0]);

            const manager_exists = await assetManagerController.assetManagerExists(assetManager.address)
            assert.equal(true, manager_exists);
        });

        it("should add and remove asset manager", async () => {
            let assetManager2: AssetManagerInstance;
            let fAsset2: FAssetInstance;
            const managers_current = await assetManagerController.getAssetManagers();
            [assetManager2, fAsset2] = await newAssetManager(governance, assetManagerController.address, "Ethereum", "ETH", 18, settings);
            
            await assetManagerController.addAssetManager(assetManager2.address, { from: governance });
            const managers_add = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length+1, managers_add.length);

            await assetManagerController.removeAssetManager(assetManager2.address, { from: governance });
            const managers_remove = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length, managers_remove.length);
        });


        it("should update whitelist only with governance", async () => {
            let res = assetManagerController.setWhitelist([assetManager.address], randomAddress());
            await expectRevert(res, "only governance")
        });

        it("should update whitelist", async () => {
            let address = randomAddress();
            let res = await assetManagerController.setWhitelist([assetManager.address], address, { from: governance });
            expectEvent(res, "ContractChanged", { name: "whitelist", value: address })
        });

        it("should revert updating lot size when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let lotSizeAMG_big = toBN(currentSettings.lotSizeAMG).muln(3);
            const res_big = assetManagerController.setLotSizeAmg([assetManager.address], lotSizeAMG_big, { from: governance });
            let lotSizeAMG_small = toBN(currentSettings.lotSizeAMG).divn(5);
            
            const res_small = assetManagerController.setLotSizeAmg([assetManager.address], lotSizeAMG_small, { from: governance });
            
            await expectRevert(res_big, "lot size increase too big");
            await expectRevert(res_small, "lot size decrease too big")
        });

        it("should revert updating payment challenge reward when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            // payment challenge reward could be zero 
            if(!toBN(currentSettings.paymentChallengeRewardNATWei).eqn(0)) {
                let paymentChallengeRewardNATWei_big = toBN(currentSettings.paymentChallengeRewardNATWei).muln(5);
                let paymentChallengeRewardNATWei_small = toBN(currentSettings.paymentChallengeRewardNATWei).divn(5);
                
                let res1 =  assetManagerController.setPaymentChallengeReward([assetManager.address], paymentChallengeRewardNATWei_big, currentSettings.paymentChallengeRewardBIPS, { from: governance });
                await expectRevert(res1, "increase too big");
                let res2 =  assetManagerController.setPaymentChallengeReward([assetManager.address], paymentChallengeRewardNATWei_small, currentSettings.paymentChallengeRewardBIPS, { from: governance });
                await expectRevert(res2, "decrease too big");
            }
            
            if(!toBN(currentSettings.paymentChallengeRewardBIPS).eqn(0)) {
                let paymentChallengeRewardBIPS_big = toBN(currentSettings.paymentChallengeRewardBIPS).add(toBN(100)).muln(5);
                let paymentChallengeRewardBIPS_small = toBN(currentSettings.paymentChallengeRewardBIPS).divn(5);
    
                let res3 =  assetManagerController.setPaymentChallengeReward([assetManager.address], currentSettings.paymentChallengeRewardNATWei, paymentChallengeRewardBIPS_big, { from: governance });
                await expectRevert(res3, "increase too big");
                let res4 =  assetManagerController.setPaymentChallengeReward([assetManager.address], currentSettings.paymentChallengeRewardNATWei, paymentChallengeRewardBIPS_small, { from: governance });
                await expectRevert(res4, "decrease too big");
            }

        });


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
            // set executor
            await assetManagerController.setUpdateExecutors([updateExecutor], { from: governance })
            // change settings
            await assetManagerController.setCollateralRatios([assetManager.address], 2_2000, 1_8000, 2_4000, { from: governance });
            await time.increase(toBN(settings.timelockSeconds).addn(1));
            await time.advanceBlock();
            await assetManagerController.executeSetCollateralRatios([assetManager.address], { from: updateExecutor });
            // assert
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.minCollateralRatioBIPS, 2_2000);
            assertWeb3Equal(newSettings.ccbMinCollateralRatioBIPS, 1_8000);
            assertWeb3Equal(newSettings.safetyMinCollateralRatioBIPS, 2_4000);
        });

        it("settings change should be executed by executor", async () => {
            // change settings
            await assetManagerController.setCollateralRatios([assetManager.address], 2_2000, 1_8000, 2_4000, { from: governance });
            await expectRevert(assetManagerController.executeSetCollateralRatios([assetManager.address]),
                "only update executor");
        });

        it("shouldn't change collateral settings without timelock", async () => {
            // set executor
            await assetManagerController.setUpdateExecutors([updateExecutor], { from: governance })
            // change settings
            await assetManagerController.setCollateralRatios([assetManager.address], 2_2000, 1_8000, 2_4000, { from: governance });
            await expectRevert(assetManagerController.executeSetCollateralRatios([assetManager.address], { from: updateExecutor }),
                "update not valid yet");
            // assert no changes
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.minCollateralRatioBIPS, settings.minCollateralRatioBIPS);
            assertWeb3Equal(newSettings.ccbMinCollateralRatioBIPS, settings.ccbMinCollateralRatioBIPS);
            assertWeb3Equal(newSettings.safetyMinCollateralRatioBIPS, settings.safetyMinCollateralRatioBIPS);
        });

    });
});
