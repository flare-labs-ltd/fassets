import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AddressUpdaterInstance, AssetManagerControllerInstance, AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, WhitelistInstance, WNatInstance } from "../../../../typechain-truffle";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { DAYS, getTestFile, HOURS, MAX_BIPS, randomAddress, toBN, toBNExp, toStringExp } from "../../../utils/helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { assertWeb3Equal, web3ResultStruct } from "../../../utils/web3assertions";
import { createTestSettings } from "../test-settings";

const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const AddressUpdater = artifacts.require('AddressUpdater');
const AssetManagerController = artifacts.require('AssetManagerController');
const Whitelist = artifacts.require('Whitelist');

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
    let whitelist: WhitelistInstance;

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
        // create whitelist
        whitelist = await Whitelist.new(governance);
        // create asset manager controller
        addressUpdater = await AddressUpdater.new(governance);
        assetManagerController = await AssetManagerController.new(governance, addressUpdater.address);
        // create asset manager
        settings = createTestSettings(attestationClient, wnat, ftsoRegistry);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController.address, "Ethereum", "ETH", 18, settings);
        await assetManagerController.addAssetManager(assetManager.address, { from: governance });
        await assetManagerController.setUpdateExecutors([updateExecutor], { from: governance });
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
            assert.equal(managers_current.length + 1, managers_add.length);

            await assetManagerController.removeAssetManager(assetManager.address, { from: governance });
            const managers_remove = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length, managers_remove.length);
        });

        it("should not add asset manager twice", async () => {
            const managers_current = await assetManagerController.getAssetManagers();

            await assetManagerController.addAssetManager(managers_current[0], { from: governance });
            const managers_add = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length, managers_add.length);
        });

        it("should do nothing if removing unexisting asset manager", async () => {
            let assetManager2: AssetManagerInstance;
            let fAsset2: FAssetInstance;
            const managers_current = await assetManagerController.getAssetManagers();
            [assetManager2, fAsset2] = await newAssetManager(governance, assetManagerController.address, "Ethereum", "ETH", 18, settings);

            await assetManagerController.addAssetManager(assetManager2.address, { from: governance });
            const managers_add = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length + 1, managers_add.length);

            await assetManagerController.removeAssetManager(assetManager2.address, { from: governance });
            const managers_remove = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length, managers_remove.length);

            await assetManagerController.removeAssetManager(assetManager2.address, { from: governance });
            const managers_remove2 = await assetManagerController.getAssetManagers();
            assert.equal(managers_current.length, managers_remove2.length);
        });

        it("should revert setting whitelist without governance", async () => {
            let res = assetManagerController.setWhitelist([assetManager.address], randomAddress());
            await expectRevert(res, "only governance")
        });


        it("should refresh ftso indexes", async () => {
            await assetManagerController.refreshFtsoIndexes([assetManager.address], {from: updateExecutor });
        });

        it("should revert refreshing ftso indexes if asset manager not managed", async () => {
            const promise = assetManagerController.refreshFtsoIndexes([assetManager.address, accounts[2]], {from: updateExecutor });
            await expectRevert(promise, "Asset manager not managed");
        });

        it("should set whitelist address", async () => {
            let res = await assetManagerController.setWhitelist([assetManager.address], whitelist.address, { from: governance });
            expectEvent(res, "ContractChangeScheduled", { name: "whitelist", value: whitelist.address })
        });

        it("should execute set whitelist", async () => {
            await assetManagerController.setWhitelist([assetManager.address], whitelist.address, { from: governance });

            await time.increase(toBN(settings.timelockSeconds).addn(1));
            await time.advanceBlock();
            await assetManagerController.executeSetWhitelist([assetManager.address], { from: updateExecutor });
            // assert
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.whitelist, whitelist.address);
        });

        it("should not execute set whitelist", async () => {
            await assetManagerController.setWhitelist([assetManager.address], whitelist.address, { from: governance });
            let res = assetManagerController.executeSetWhitelist([assetManager.address], { from: updateExecutor });
            await expectRevert(res, "update not valid yet");
        });

        it("should revert setting lot size when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let lotSizeAMG_big = toBN(currentSettings.lotSizeAMG).muln(3);
            let lotSizeAMG_small = toBN(currentSettings.lotSizeAMG).divn(5);
            const res_big = assetManagerController.setLotSizeAmg([assetManager.address], lotSizeAMG_big, { from: governance });
            const res_small = assetManagerController.setLotSizeAmg([assetManager.address], lotSizeAMG_small, { from: governance });

            await expectRevert(res_big, "lot size increase too big");
            await expectRevert(res_small, "lot size decrease too big")
        });

        it("should revert setting payment challenge reward when increase or decrease is too big", async () => {
            let paymentChallengeRewardNATWei = toStringExp(300, 18);
            let paymentChallengeRewardBIPS = 100;
            await assetManagerController.setPaymentChallengeReward([assetManager.address], paymentChallengeRewardNATWei, paymentChallengeRewardBIPS, { from: governance });
            await time.increase(toBN(settings.timelockSeconds).addn(1));
            await time.advanceBlock();

            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            let paymentChallengeRewardNATWei_big = toBN(newSettings.paymentChallengeRewardNATWei).muln(5);
            let paymentChallengeRewardNATWei_small = toBN(newSettings.paymentChallengeRewardNATWei).divn(5);

            let res1 = assetManagerController.setPaymentChallengeReward([assetManager.address], paymentChallengeRewardNATWei_big, newSettings.paymentChallengeRewardBIPS, { from: governance });
            await expectRevert(res1, "increase too big");
            let res2 = assetManagerController.setPaymentChallengeReward([assetManager.address], paymentChallengeRewardNATWei_small, newSettings.paymentChallengeRewardBIPS, { from: governance });
            await expectRevert(res2, "decrease too big");

            let paymentChallengeRewardBIPS_big = toBN(newSettings.paymentChallengeRewardBIPS).add(toBN(100)).muln(5);
            let paymentChallengeRewardBIPS_small = toBN(newSettings.paymentChallengeRewardBIPS).divn(5);

            let res3 = assetManagerController.setPaymentChallengeReward([assetManager.address], newSettings.paymentChallengeRewardNATWei, paymentChallengeRewardBIPS_big, { from: governance });
            await expectRevert(res3, "increase too big");
            let res4 = assetManagerController.setPaymentChallengeReward([assetManager.address], newSettings.paymentChallengeRewardNATWei, paymentChallengeRewardBIPS_small, { from: governance });
            await expectRevert(res4, "decrease too big");
        });

        it("should set payment challenge reward", async () => {
            const currentSettings = await assetManager.getSettings();
            // payment challenge reward could be zero 
            if (!toBN(currentSettings.paymentChallengeRewardNATWei).eqn(0)) {
                let paymentChallengeRewardNATWei_new = toBN(currentSettings.paymentChallengeRewardNATWei).muln(4);
                let paymentChallengeRewardBIPS_new = toBN(currentSettings.paymentChallengeRewardBIPS).muln(4);

                let res = await assetManagerController.setPaymentChallengeReward([assetManager.address], paymentChallengeRewardNATWei_new, paymentChallengeRewardBIPS_new, { from: governance });
                expectEvent(res, "SettingChanged", { name: "paymentChallengeRewardNATWei", value: paymentChallengeRewardNATWei_new })
                expectEvent(res, "SettingChanged", { name: "paymentChallengeRewardBIPS", value: paymentChallengeRewardBIPS_new })
            }
        });       

        it("should set time for payment", async () => {
            const currentSettings = await assetManager.getSettings();
            let underlyingBlocksForPayment_new = toBN(currentSettings.underlyingBlocksForPayment).muln(2);
            let underlyingSecondsForPayment_new = toBN(currentSettings.underlyingSecondsForPayment).muln(2);
            let res = await assetManagerController.setTimeForPayment([assetManager.address], underlyingBlocksForPayment_new, underlyingSecondsForPayment_new, { from: governance });
            expectEvent(res, "SettingChangeScheduled", { name: "underlyingBlocksForPayment", value: toBN(underlyingBlocksForPayment_new) });
            expectEvent(res, "SettingChangeScheduled", { name: "underlyingSecondsForPayment", value: toBN(underlyingSecondsForPayment_new) });
        });

        it("should revert setting max trusted price age seconds when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let maxTrustedPriceAgeSeconds_big = toBN(currentSettings.maxTrustedPriceAgeSeconds).muln(60);
            let maxTrustedPriceAgeSeconds_small = toBN(currentSettings.maxTrustedPriceAgeSeconds).divn(60);
            let res_big = assetManagerController.setMaxTrustedPriceAgeSeconds([assetManager.address], maxTrustedPriceAgeSeconds_big, { from: governance });
            let res_small = assetManagerController.setMaxTrustedPriceAgeSeconds([assetManager.address], maxTrustedPriceAgeSeconds_small, { from: governance });
            await expectRevert(res_big, "fee increase too big");
            await expectRevert(res_small, "fee decrease too big");
        });

        it("should set max trusted price age seconds", async () => {
            const currentSettings = await assetManager.getSettings();
            let maxTrustedPriceAgeSeconds_new = toBN(currentSettings.maxTrustedPriceAgeSeconds).addn(20);
            let res = await assetManagerController.setMaxTrustedPriceAgeSeconds([assetManager.address], maxTrustedPriceAgeSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "maxTrustedPriceAgeSeconds", value: toBN(maxTrustedPriceAgeSeconds_new) });
        });

        it("should revert setting collateral reservation fee bips when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let collateralReservationFeeBIPS_big = toBN(currentSettings.collateralReservationFeeBIPS).muln(5);
            let collateralReservationFeeBIPS_small = toBN(currentSettings.collateralReservationFeeBIPS).divn(5);
            let collateralReservationFeeBIPS_too_high = toBN(MAX_BIPS).addn(1);
            let res_big = assetManagerController.setCollateralReservationFeeBips([assetManager.address], collateralReservationFeeBIPS_big, { from: governance });
            let res_small = assetManagerController.setCollateralReservationFeeBips([assetManager.address], collateralReservationFeeBIPS_small, { from: governance });
            let res_too_high = assetManagerController.setCollateralReservationFeeBips([assetManager.address], collateralReservationFeeBIPS_too_high, { from: governance });
            await expectRevert(res_big, "fee increase too big");
            await expectRevert(res_small, "fee decrease too big");
            await expectRevert(res_too_high, "bips value too high");
        });

        it("should set collateral reservation fee bips", async () => {
            const currentSettings = await assetManager.getSettings();
            let collateralReservationFeeBIPS_new = toBN(currentSettings.collateralReservationFeeBIPS).muln(2);
            let res = await assetManagerController.setCollateralReservationFeeBips([assetManager.address], collateralReservationFeeBIPS_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "collateralReservationFeeBIPS", value: toBN(collateralReservationFeeBIPS_new) });
        });

        it("should revert setting redemption fee bips when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let redemptionFeeBIPS_big = toBN(currentSettings.redemptionFeeBIPS).muln(5);
            let redemptionFeeBIPS_small = toBN(currentSettings.redemptionFeeBIPS).divn(5);
            let redemptionFeeBIPS_too_high = toBN(MAX_BIPS).addn(1);
            let res_big = assetManagerController.setRedemptionFeeBips([assetManager.address], redemptionFeeBIPS_big, { from: governance });
            let res_small = assetManagerController.setRedemptionFeeBips([assetManager.address], redemptionFeeBIPS_small, { from: governance });
            let res_too_high = assetManagerController.setRedemptionFeeBips([assetManager.address], redemptionFeeBIPS_too_high, { from: governance });
            await expectRevert(res_big, "fee increase too big");
            await expectRevert(res_small, "fee decrease too big");
            await expectRevert(res_too_high, "bips value too high");
        });

        it("should revert setting confirmation by others after seconds when value too low", async () => {
            let confirmationByOthersAfterSeconds_small = 1.8 * HOURS;
            let res_big = assetManagerController.setConfirmationByOthersAfterSeconds([assetManager.address], confirmationByOthersAfterSeconds_small, { from: governance });
            await expectRevert(res_big, "must be at least two hours");
        });

        it("should set confirmation by others after seconds", async () => {
            const currentSettings = await assetManager.getSettings();
            let confirmationByOthersAfterSeconds_new = toBN(currentSettings.confirmationByOthersAfterSeconds).muln(2);
            let res = await assetManagerController.setConfirmationByOthersAfterSeconds([assetManager.address], confirmationByOthersAfterSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "confirmationByOthersAfterSeconds", value: toBN(confirmationByOthersAfterSeconds_new) });
        });

        it("should revert setting confirmation by others reward NATWei when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let confirmationByOthersRewardNATWei_big = toBN(currentSettings.confirmationByOthersRewardNATWei).muln(5);
            let confirmationByOthersRewardNATWei_small = toBN(currentSettings.confirmationByOthersRewardNATWei).divn(5);
            let res_big = assetManagerController.setConfirmationByOthersRewardNatWei([assetManager.address], confirmationByOthersRewardNATWei_big, { from: governance });
            let res_small = assetManagerController.setConfirmationByOthersRewardNatWei([assetManager.address], confirmationByOthersRewardNATWei_small, { from: governance });
            await expectRevert(res_big, "fee increase too big");
            await expectRevert(res_small, "fee decrease too big");
        });

        it("should set confirmation by others reward NATWei", async () => {
            const currentSettings = await assetManager.getSettings();
            let confirmationByOthersRewardNATWei_new = toBN(currentSettings.confirmationByOthersRewardNATWei).muln(2);
            let res = await assetManagerController.setConfirmationByOthersRewardNatWei([assetManager.address], confirmationByOthersRewardNATWei_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "confirmationByOthersRewardNATWei", value: toBN(confirmationByOthersRewardNATWei_new) });
        });

        it("should revert setting max redeemed tickets when increase or decrease is too big or value is < 1", async () => {
            const currentSettings = await assetManager.getSettings();
            let maxRedeemedTickets_big = toBN(currentSettings.maxRedeemedTickets).muln(3);
            let maxRedeemedTickets_small = toBN(currentSettings.maxRedeemedTickets).divn(5);
            let maxRedeemedTickets_zero = 0;

            let res_big = assetManagerController.setMaxRedeemedTickets([assetManager.address], maxRedeemedTickets_big, { from: governance });
            let res_small = assetManagerController.setMaxRedeemedTickets([assetManager.address], maxRedeemedTickets_small, { from: governance });
            let res_zero = assetManagerController.setMaxRedeemedTickets([assetManager.address], maxRedeemedTickets_zero, { from: governance });

            await expectRevert(res_big, "increase too big");
            await expectRevert(res_small, "decrease too big");
            await expectRevert(res_zero, "cannot be zero");
        });

        it("should set max redeemed tickets", async () => {
            const currentSettings = await assetManager.getSettings();
            let maxRedeemedTickets_new = toBN(currentSettings.maxRedeemedTickets).muln(2);
            let res = await assetManagerController.setMaxRedeemedTickets([assetManager.address], maxRedeemedTickets_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "maxRedeemedTickets", value: toBN(maxRedeemedTickets_new) });
        });

        it("should revert setting withdrawal wait when increase is too big or value is < 1", async () => {
            const currentSettings = await assetManager.getSettings();
            let withdrawalWaitMinSeconds_big = toBN(currentSettings.withdrawalWaitMinSeconds).addn(11 * 60);
            let withdrawalWaitMinSeconds_zero = 0;

            let res_big = assetManagerController.setWithdrawalOrDestroyWaitMinSeconds([assetManager.address], withdrawalWaitMinSeconds_big, { from: governance });
            let res_zero = assetManagerController.setWithdrawalOrDestroyWaitMinSeconds([assetManager.address], withdrawalWaitMinSeconds_zero, { from: governance });

            await expectRevert(res_big, "increase too big");
            await expectRevert(res_zero, "cannot be zero");
        });

        it("should set withdrawal wait", async () => {
            const currentSettings = await assetManager.getSettings();
            let withdrawalWaitMinSeconds_new = toBN(currentSettings.withdrawalWaitMinSeconds).muln(2);
            let res = await assetManagerController.setWithdrawalOrDestroyWaitMinSeconds([assetManager.address], withdrawalWaitMinSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "withdrawalWaitMinSeconds", value: toBN(withdrawalWaitMinSeconds_new) });
        });

        it("should revert setting ccb time when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let ccbTimeSeconds_big = toBN(currentSettings.ccbTimeSeconds).muln(3);
            let ccbTimeSeconds_small = toBN(currentSettings.ccbTimeSeconds).divn(3);

            let res_big = assetManagerController.setCcbTimeSeconds([assetManager.address], ccbTimeSeconds_big, { from: governance });
            let res_small = assetManagerController.setCcbTimeSeconds([assetManager.address], ccbTimeSeconds_small, { from: governance });

            await expectRevert(res_big, "increase too big");
            await expectRevert(res_small, "decrease too big");
        });

        it("should set ccb time", async () => {
            const currentSettings = await assetManager.getSettings();
            let ccbTimeSeconds_new = toBN(currentSettings.ccbTimeSeconds).muln(2);
            let res = await assetManagerController.setCcbTimeSeconds([assetManager.address], ccbTimeSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "ccbTimeSeconds", value: toBN(ccbTimeSeconds_new) });
        });

        it("should revert setting liquidation step when increase or decrease is too big", async () => {
            const currentSettings = await assetManager.getSettings();
            let liquidationStepSeconds_big = toBN(currentSettings.liquidationStepSeconds).muln(3);
            let liquidationStepSeconds_small = toBN(currentSettings.liquidationStepSeconds).divn(3);

            let res_big = assetManagerController.setLiquidationStepSeconds([assetManager.address], liquidationStepSeconds_big, { from: governance });
            let res_small = assetManagerController.setLiquidationStepSeconds([assetManager.address], liquidationStepSeconds_small, { from: governance });

            await expectRevert(res_big, "increase too big");
            await expectRevert(res_small, "decrease too big");
        });

        it("should set liquidation step", async () => {
            const currentSettings = await assetManager.getSettings();
            let liquidationStepSeconds_new = toBN(currentSettings.liquidationStepSeconds).muln(2);
            let res = await assetManagerController.setLiquidationStepSeconds([assetManager.address], liquidationStepSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "liquidationStepSeconds", value: toBN(liquidationStepSeconds_new) });
        });

        it("should revert setting liquidation collateral factor bips", async () => {
            const currentSettings = await assetManager.getSettings();
            let liquidationCollateralFactorBIPS_empty: (string | number | import("bn.js"))[] = [];
            let liquidationCollateralFactorBIPS_notIncreasing = [12000, 1200];
            let liquidationCollateralFactorBIPS_tooHigh = [toBN(currentSettings.safetyMinCollateralRatioBIPS).addn(1)];
            let liquidationCollateralFactorBIPS_maxBips = [1200, MAX_BIPS+1];

            let res_empty = assetManagerController.setLiquidationCollateralFactorBips([assetManager.address], liquidationCollateralFactorBIPS_empty, { from: governance });
            let res_notIncreasing = assetManagerController.setLiquidationCollateralFactorBips([assetManager.address], liquidationCollateralFactorBIPS_notIncreasing, { from: governance });
            let res_tooHigh = assetManagerController.setLiquidationCollateralFactorBips([assetManager.address], liquidationCollateralFactorBIPS_tooHigh, { from: governance });
            let res_tooMaxBips = assetManagerController.setLiquidationCollateralFactorBips([assetManager.address], liquidationCollateralFactorBIPS_maxBips, { from: governance }); 
            
            await expectRevert(res_empty, "at least one factor required");
            await expectRevert(res_notIncreasing, "factors not increasing");
            await expectRevert(res_tooHigh, "liquidation factor too high");
            await expectRevert(res_tooMaxBips, "factor not above 1");
        });

        it("should set liquidation collateral factor bips", async () => {
            const currentSettings = await assetManager.getSettings();
            let liquidationCollateralFactorBIPS_new = [2_0000, 2_5000];
            let res = await assetManagerController.setLiquidationCollateralFactorBips([assetManager.address], liquidationCollateralFactorBIPS_new, { from: governance });
            expectEvent(res, "SettingArrayChanged", { name: "liquidationCollateralFactorBIPS", value: [toBN(2_0000), toBN(2_5000)] });
        });

        it("should revert setting attestation window when window is less than a day", async () => {
            let attestationWindowSeconds_small = 0.8 * DAYS;
            let res_small = assetManagerController.setAttestationWindowSeconds([assetManager.address], attestationWindowSeconds_small, { from: governance });

            await expectRevert(res_small, "window too small");
        });

        it("should set attestation window", async () => {
            const currentSettings = await assetManager.getSettings();
            let attestationWindowSeconds_new = toBN(currentSettings.attestationWindowSeconds).muln(2);
            let res = await assetManagerController.setAttestationWindowSeconds([assetManager.address], attestationWindowSeconds_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "attestationWindowSeconds", value: toBN(attestationWindowSeconds_new) });
        });

        it("should revert redemption default factor bips", async () => {
            const currentSettings = await assetManager.getSettings();
            let redemptionDefaultFactorBIPS_big = toBN(currentSettings.redemptionDefaultFactorBIPS).muln(12001).divn(10_000);
            let redemptionDefaultFactorBIPS_low = MAX_BIPS;

            let res_big = assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_big, { from: governance });
            let res_low = assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_low, { from: governance });

            await expectRevert(res_big, "fee increase too big");
            await expectRevert(res_low, "bips value too low");

            let redemptionDefaultFactorBIPS_new = 1_3000;
            await assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_new, { from: governance });
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            let redemptionDefaultFactorBIPS_small = toBN(newSettings.redemptionDefaultFactorBIPS).muln(8332).divn(10_000);;
            
            await time.increase(toBN(settings.timelockSeconds).addn(1));
            await time.advanceBlock();
            
            let res_small = assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_small, { from: governance });           
            await expectRevert(res_small, "fee decrease too big"); 
        });

        it("should set redemption default factor bips", async () => {
            const currentSettings = await assetManager.getSettings();
            let redemptionDefaultFactorBIPS_new = 1_1000;
            let res = await assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_new, { from: governance });
            expectEvent(res, "SettingChanged", { name: "redemptionDefaultFactorBIPS", value: toBN(redemptionDefaultFactorBIPS_new) });
        });

        it("should revert update - too close to previous update", async () => {
            let redemptionDefaultFactorBIPS_new = 1_3000;
            await assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_new, { from: governance });
            let update = assetManagerController.setRedemptionDefaultFactorBips([assetManager.address], redemptionDefaultFactorBIPS_new, { from: governance });           
            await expectRevert(update, "too close to previous update"); 
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
            assertWeb3Equal(settings.assetManagerController, assetManagerController.address);
            assertWeb3Equal(settings.attestationClient, accounts[80]);
            assertWeb3Equal(settings.ftsoRegistry, accounts[81]);
            assertWeb3Equal(settings.wNat, accounts[82]);
            assertWeb3Equal(await assetManagerController.replacedBy(), constants.ZERO_ADDRESS);
        });

        it("should change contracts, including asset manager controller", async () => {
            await addressUpdater.update(["AddressUpdater", "AssetManagerController", "AttestationClient", "FtsoRegistry", "WNat"],
                [addressUpdater.address, accounts[79], accounts[80], accounts[81], accounts[82]],
                [assetManagerController.address],
                { from: governance });
            const settings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(settings.assetManagerController, accounts[79]);
            assertWeb3Equal(settings.attestationClient, accounts[80]);
            assertWeb3Equal(settings.ftsoRegistry, accounts[81]);
            assertWeb3Equal(settings.wNat, accounts[82]);
            assertWeb3Equal(await assetManagerController.replacedBy(), accounts[79]);
        });

        it("should change time for payment settings after timelock", async () => {
            // change settings
            const currentSettings = await assetManager.getSettings();
            let underlyingBlocksForPayment_new = toBN(currentSettings.underlyingBlocksForPayment).muln(2);
            let underlyingSecondsForPayment_new = toBN(currentSettings.underlyingSecondsForPayment).muln(2);
            await assetManagerController.setTimeForPayment([assetManager.address], underlyingBlocksForPayment_new, underlyingSecondsForPayment_new, { from: governance });

            await time.increase(toBN(settings.timelockSeconds).addn(1));
            await time.advanceBlock();
            await assetManagerController.executeSetTimeForPayment([assetManager.address], { from: updateExecutor });
            // assert
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.underlyingBlocksForPayment, underlyingBlocksForPayment_new);
            assertWeb3Equal(newSettings.underlyingSecondsForPayment, underlyingSecondsForPayment_new);
        });

        it("should change collateral settings after timelock", async () => {
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

        it("should not set collateral", async () => {
            let res_invalid = assetManagerController.setCollateralRatios([assetManager.address],  1_8000, 2_2000, 2_4000, { from: governance });
            await expectRevert(res_invalid, "invalid collateral ratios");
            let res_too_high = assetManagerController.setCollateralRatios([assetManager.address],  1_6000, 1_4000, 1_8000, { from: governance });
            await expectRevert(res_too_high, "liquidation factor too high");
        });

        it("settings change should be executed by executor", async () => {
            // change settings
            await assetManagerController.setCollateralRatios([assetManager.address], 2_2000, 1_8000, 2_4000, { from: governance });
            await expectRevert(assetManagerController.executeSetCollateralRatios([assetManager.address]), "only update executor");
            await assetManagerController.setTimeForPayment([assetManager.address], 10, 120, { from: governance });
            await expectRevert(assetManagerController.executeSetTimeForPayment([assetManager.address]), "only update executor");
        });

        it("shouldn't change collateral settings without timelock", async () => {
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

        it("shouldn't change time for payment settings without timelock", async () => {
            // change settings
            const currentSettings = await assetManager.getSettings();
            let underlyingBlocksForPayment_new = toBN(currentSettings.underlyingBlocksForPayment).muln(2);
            let underlyingSecondsForPayment_new = toBN(currentSettings.underlyingSecondsForPayment).muln(2);
            await assetManagerController.setTimeForPayment([assetManager.address], underlyingBlocksForPayment_new, underlyingSecondsForPayment_new, { from: governance });

            await expectRevert(assetManagerController.executeSetTimeForPayment([assetManager.address], { from: updateExecutor }), "update not valid yet");
            // assert no changes
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            assertWeb3Equal(newSettings.underlyingBlocksForPayment, settings.underlyingBlocksForPayment);
            assertWeb3Equal(newSettings.underlyingSecondsForPayment, settings.underlyingSecondsForPayment);
        });

        it("should re-set update executors", async () => {
            // re-set executor
            await assetManagerController.setUpdateExecutors([accounts[1], accounts[2]], { from: governance });
            assert.isFalse(await assetManagerController.isUpdateExecutor(updateExecutor));
            assert.isTrue(await assetManagerController.isUpdateExecutor(accounts[1]));
            assert.isTrue(await assetManagerController.isUpdateExecutor(accounts[2]));
        });

        it("shouldn't remove all update executors", async () => {
            const promise = assetManagerController.setUpdateExecutors([], { from: governance });
            await expectRevert(promise, "empty executors list");
        });
    });
});
