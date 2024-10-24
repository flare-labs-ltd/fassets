// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";
import "../../fassetToken/interfaces/IITransparentProxy.sol";
import "../../utils/lib/SafePct.sol";
import "../interfaces/IISettingsManagement.sol";
import "../library/Globals.sol";
import "../library/CollateralTypes.sol";
import "../library/SettingsUpdater.sol";
import "../library/SettingsValidators.sol";
import "./AssetManagerBase.sol";


contract SettingsManagementFacet is AssetManagerBase, IAssetManagerEvents, IISettingsManagement {
    using SafeCast for uint256;
    using SafePct for *;

    struct UpdaterState {
        mapping (bytes4 => uint256) lastUpdate;
    }

    bytes32 internal constant UPDATES_STATE_POSITION = keccak256("fasset.AssetManager.UpdaterState");

    modifier rateLimited() {
        SettingsUpdater.checkEnoughTimeSinceLastUpdate();
        _;
    }

    function updateSystemContracts(address _controller, IWNat _wNat)
        external
        onlyAssetManagerController
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // update assetManagerController
        if (settings.assetManagerController != _controller) {
            settings.assetManagerController = _controller;
            emit ContractChanged("assetManagerController", address(_controller));
        }
        // update wNat
        IWNat oldWNat = Globals.getWNat();
        if (oldWNat != _wNat) {
            CollateralType.Data memory data = CollateralTypes.getInfo(CollateralType.Class.POOL, oldWNat);
            data.validUntil = 0;
            data.token = _wNat;
            CollateralTypes.setPoolWNatCollateralType(data);
            emit ContractChanged("wNat", address(_wNat));
        }
    }

    function setWhitelist(address _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        // update
        settings.whitelist = _value;
        emit ContractChanged("whitelist", _value);
    }

    function setAgentOwnerRegistry(address _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value != address(0), "address zero");
        // update
        settings.agentOwnerRegistry = _value;
        emit ContractChanged("agentOwnerRegistry", _value);
    }

    function setAgentVaultFactory(address _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value != address(0), "address zero");
        // update
        settings.agentVaultFactory = _value;
        emit ContractChanged("agentVaultFactory", _value);
    }

    function setCollateralPoolFactory(address _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value != address(0), "address zero");
        // update
        settings.collateralPoolFactory = _value;
        emit ContractChanged("collateralPoolFactory", _value);
    }

    function setCollateralPoolTokenFactory(address _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value != address(0), "address zero");
        // update
        settings.collateralPoolTokenFactory = _value;
        emit ContractChanged("collateralPoolTokenFactory", _value);
    }

    function setPriceReader(address _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value != address(0), "address zero");
        // update
        settings.priceReader = _value;
        emit ContractChanged("priceReader", _value);
    }

    function setFdcVerification(address _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value != address(0), "address zero");
        // update
        settings.fdcVerification = _value;
        emit IAssetManagerEvents.ContractChanged("fdcVerification", _value);
    }

    function setCleanerContract(address _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        IIFAsset fAsset = Globals.getFAsset();
        // validate
        // update
        fAsset.setCleanerContract(_value);
        emit ContractChanged("cleanerContract", _value);
    }

    function setCleanupBlockNumberManager(address _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        IIFAsset fAsset = Globals.getFAsset();
        // validate
        // update
        fAsset.setCleanupBlockNumberManager(_value);
        emit ContractChanged("cleanupBlockNumberManager", _value);
    }

    function upgradeFAssetImplementation(address _value, bytes memory callData)
        external
        onlyAssetManagerController
        rateLimited
    {
        IITransparentProxy fAssetProxy = IITransparentProxy(address(Globals.getFAsset()));
        // validate
        require(_value != address(0), "address zero");
        // update
        fAssetProxy.upgradeToAndCall(_value, callData);
        emit ContractChanged("fAsset", _value);
    }

    function setTimeForPayment(uint256 _underlyingBlocks, uint256 _underlyingSeconds)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_underlyingSeconds > 0, "cannot be zero");
        require(_underlyingBlocks > 0, "cannot be zero");
        SettingsValidators.validateTimeForPayment(_underlyingBlocks, _underlyingSeconds, settings.averageBlockTimeMS);
        // update
        settings.underlyingBlocksForPayment = _underlyingBlocks.toUint64();
        settings.underlyingSecondsForPayment = _underlyingSeconds.toUint64();
        emit SettingChanged("underlyingBlocksForPayment", _underlyingBlocks);
        emit SettingChanged("underlyingSecondsForPayment", _underlyingSeconds);
    }

    function setPaymentChallengeReward(uint256 _rewardNATWei, uint256 _rewardBIPS)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_rewardNATWei <= (settings.paymentChallengeRewardUSD5 * 4) + 100 ether, "increase too big");
        require(_rewardNATWei >= (settings.paymentChallengeRewardUSD5) / 4, "decrease too big");
        require(_rewardBIPS <= (settings.paymentChallengeRewardBIPS * 4) + 100, "increase too big");
        require(_rewardBIPS >= (settings.paymentChallengeRewardBIPS) / 4, "decrease too big");
        // update
        settings.paymentChallengeRewardUSD5 = _rewardNATWei.toUint128();
        settings.paymentChallengeRewardBIPS = _rewardBIPS.toUint16();
        emit SettingChanged("paymentChallengeRewardUSD5", _rewardNATWei);
        emit SettingChanged("paymentChallengeRewardBIPS", _rewardBIPS);
    }

    function setMinUpdateRepeatTimeSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        // update
        settings.minUpdateRepeatTimeSeconds = _value.toUint64();
        emit SettingChanged("minUpdateRepeatTimeSeconds", _value);
    }

    function setLotSizeAmg(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        // huge lot size increase is very dangerous, because it breaks redemption
        // (converts all tickets to dust)
        require(_value > 0, "cannot be zero");
        require(_value <= settings.lotSizeAMG * 4, "lot size increase too big");
        require(_value >= settings.lotSizeAMG / 4, "lot size decrease too big");
        require(settings.mintingCapAMG == 0 || settings.mintingCapAMG >= _value,
            "lot size bigger than minting cap");
        // update
        settings.lotSizeAMG = _value.toUint64();
        emit SettingChanged("lotSizeAMG", _value);
    }

    function setMinUnderlyingBackingBips(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        // huge lot size increase is very dangerous, because it breaks redemption
        // (converts all tickets to dust)
        require(_value > 0, "cannot be zero");
        require(_value <= SafePct.MAX_BIPS, "must be below 1");
        require(_value <= settings.minUnderlyingBackingBIPS * 2, "increase too big");
        require(_value >= settings.minUnderlyingBackingBIPS / 2, "decrease too big");
        // update
        settings.minUnderlyingBackingBIPS = _value.toUint16();
        emit SettingChanged("minUnderlyingBackingBIPS", _value);
    }

    function setMaxTrustedPriceAgeSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        require(_value <= settings.maxTrustedPriceAgeSeconds * 2, "fee increase too big");
        require(_value >= settings.maxTrustedPriceAgeSeconds / 2, "fee decrease too big");
        // update
        settings.maxTrustedPriceAgeSeconds = _value.toUint64();
        emit SettingChanged("maxTrustedPriceAgeSeconds", _value);
    }

    function setCollateralReservationFeeBips(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        require(_value <= SafePct.MAX_BIPS, "bips value too high");
        require(_value <= settings.collateralReservationFeeBIPS * 4, "fee increase too big");
        require(_value >= settings.collateralReservationFeeBIPS / 4, "fee decrease too big");
        // update
        settings.collateralReservationFeeBIPS = _value.toUint16();
        emit SettingChanged("collateralReservationFeeBIPS", _value);
    }

    function setRedemptionFeeBips(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        require(_value <= SafePct.MAX_BIPS, "bips value too high");
        require(_value <= settings.redemptionFeeBIPS * 4, "fee increase too big");
        require(_value >= settings.redemptionFeeBIPS / 4, "fee decrease too big");
        // update
        settings.redemptionFeeBIPS = _value.toUint16();
        emit SettingChanged("redemptionFeeBIPS", _value);
    }

    function setRedemptionDefaultFactorBips(uint256 _vaultFactor, uint256 _poolFactor)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_vaultFactor + _poolFactor > SafePct.MAX_BIPS,
            "bips value too low");
        require(_vaultFactor <= settings.redemptionDefaultFactorVaultCollateralBIPS.mulBips(12000) + 1000,
            "fee increase too big");
        require(_vaultFactor >= settings.redemptionDefaultFactorVaultCollateralBIPS.mulBips(8333),
            "fee decrease too big");
        require(_poolFactor <= settings.redemptionDefaultFactorPoolBIPS.mulBips(12000) + 1000,
            "fee increase too big");
        require(_poolFactor >= settings.redemptionDefaultFactorPoolBIPS.mulBips(8333),
            "fee decrease too big");
        // update
        settings.redemptionDefaultFactorVaultCollateralBIPS = _vaultFactor.toUint32();
        emit SettingChanged("redemptionDefaultFactorVaultCollateralBIPS", _vaultFactor);
        settings.redemptionDefaultFactorPoolBIPS = _poolFactor.toUint32();
        emit SettingChanged("redemptionDefaultFactorPoolBIPS", _poolFactor);
    }

    function setConfirmationByOthersAfterSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value >= 2 hours, "must be at least two hours");
        // update
        settings.confirmationByOthersAfterSeconds = _value.toUint64();
        emit SettingChanged("confirmationByOthersAfterSeconds", _value);
    }

    function setConfirmationByOthersRewardUSD5(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        require(_value <= settings.confirmationByOthersRewardUSD5 * 4, "fee increase too big");
        require(_value >= settings.confirmationByOthersRewardUSD5 / 4, "fee decrease too big");
        // update
        settings.confirmationByOthersRewardUSD5 = _value.toUint128();
        emit SettingChanged("confirmationByOthersRewardUSD5", _value);
    }

    function setMaxRedeemedTickets(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        require(_value <= settings.maxRedeemedTickets * 2, "increase too big");
        require(_value >= settings.maxRedeemedTickets / 4, "decrease too big");
        // update
        settings.maxRedeemedTickets = _value.toUint16();
        emit SettingChanged("maxRedeemedTickets", _value);
    }

    function setWithdrawalOrDestroyWaitMinSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        // making this _value small doesn't present huge danger, so we don't limit decrease
        require(_value > 0, "cannot be zero");
        require(_value <= settings.withdrawalWaitMinSeconds + 10 minutes, "increase too big");
        // update
        settings.withdrawalWaitMinSeconds = _value.toUint64();
        emit SettingChanged("withdrawalWaitMinSeconds", _value);
    }

    function setCcbTimeSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        require(_value <= settings.ccbTimeSeconds * 2, "increase too big");
        require(_value >= settings.ccbTimeSeconds / 2, "decrease too big");
        // update
        settings.ccbTimeSeconds = _value.toUint64();
        emit SettingChanged("ccbTimeSeconds", _value);
    }

    function setAttestationWindowSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value >= 1 days, "window too small");
        // update
        settings.attestationWindowSeconds = _value.toUint64();
        emit SettingChanged("attestationWindowSeconds", _value);
    }

    function setAverageBlockTimeMS(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        require(_value <= settings.averageBlockTimeMS * 2, "increase too big");
        require(_value >= settings.averageBlockTimeMS / 2, "decrease too big");
        // update
        settings.averageBlockTimeMS = _value.toUint32();
        emit SettingChanged("averageBlockTimeMS", _value);
    }

    function setAnnouncedUnderlyingConfirmationMinSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value <= 1 hours, "confirmation time too big");
        // update
        settings.announcedUnderlyingConfirmationMinSeconds = _value.toUint64();
        emit SettingChanged("announcedUnderlyingConfirmationMinSeconds", _value);
    }

    function setMintingPoolHoldingsRequiredBIPS(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value <= settings.mintingPoolHoldingsRequiredBIPS * 4 + SafePct.MAX_BIPS, "value too big");
        // update
        settings.mintingPoolHoldingsRequiredBIPS = _value.toUint32();
        emit SettingChanged("mintingPoolHoldingsRequiredBIPS", _value);
    }

    function setMintingCapAmg(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value == 0 || _value >= settings.lotSizeAMG, "value too small");
        // update
        settings.mintingCapAMG = _value.toUint64();
        emit SettingChanged("mintingCapAMG", _value);
    }

    function setTokenInvalidationTimeMinSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        // update
        settings.tokenInvalidationTimeMinSeconds = _value.toUint64();
        emit SettingChanged("tokenInvalidationTimeMinSeconds", _value);
    }

    function setVaultCollateralBuyForFlareFactorBIPS(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value >= SafePct.MAX_BIPS, "value too small");
        // update
        settings.vaultCollateralBuyForFlareFactorBIPS = _value.toUint32();
        emit SettingChanged("vaultCollateralBuyForFlareFactorBIPS", _value);
    }

    function setAgentExitAvailableTimelockSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value <= settings.agentExitAvailableTimelockSeconds * 4 + 1 weeks);
        // update
        settings.agentExitAvailableTimelockSeconds = _value.toUint64();
        emit SettingChanged("agentExitAvailableTimelockSeconds", _value);
    }

    function setAgentFeeChangeTimelockSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value <= settings.agentFeeChangeTimelockSeconds * 4 + 1 days);
        // update
        settings.agentFeeChangeTimelockSeconds = _value.toUint64();
        emit SettingChanged("agentFeeChangeTimelockSeconds", _value);
    }

    function setAgentMintingCRChangeTimelockSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value <= settings.agentMintingCRChangeTimelockSeconds * 4 + 1 days);
        // update
        settings.agentMintingCRChangeTimelockSeconds = _value.toUint64();
        emit SettingChanged("agentMintingCRChangeTimelockSeconds", _value);
    }

    function setPoolExitAndTopupChangeTimelockSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value <= settings.poolExitAndTopupChangeTimelockSeconds * 4 + 1 days);
        // update
        settings.poolExitAndTopupChangeTimelockSeconds = _value.toUint64();
        emit SettingChanged("poolExitAndTopupChangeTimelockSeconds", _value);
    }

    function setAgentTimelockedOperationWindowSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value >= 1 minutes, "value too small");
        // update
        settings.agentTimelockedOperationWindowSeconds = _value.toUint64();
        emit SettingChanged("agentTimelockedOperationWindowSeconds", _value);
    }

    function setCollateralPoolTokenTimelockSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value >= 1 minutes, "value too small");
        // update
        settings.collateralPoolTokenTimelockSeconds = _value.toUint32();
        emit SettingChanged("collateralPoolTokenTimelockSeconds", _value);
    }

    function setLiquidationStepSeconds(uint256 _stepSeconds)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_stepSeconds > 0, "cannot be zero");
        require(_stepSeconds <= settings.liquidationStepSeconds * 2, "increase too big");
        require(_stepSeconds >= settings.liquidationStepSeconds / 2, "decrease too big");
        // update
        settings.liquidationStepSeconds = _stepSeconds.toUint64();
        emit SettingChanged("liquidationStepSeconds", _stepSeconds);
    }

    function setLiquidationPaymentFactors(
        uint256[] memory _liquidationFactors,
        uint256[] memory _vaultCollateralFactors
    )
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        SettingsValidators.validateLiquidationFactors(_liquidationFactors, _vaultCollateralFactors);
        // update
        delete settings.liquidationCollateralFactorBIPS;
        delete settings.liquidationFactorVaultCollateralBIPS;
        for (uint256 i = 0; i < _liquidationFactors.length; i++) {
            settings.liquidationCollateralFactorBIPS.push(_liquidationFactors[i].toUint32());
            settings.liquidationFactorVaultCollateralBIPS.push(_vaultCollateralFactors[i].toUint32());
        }
        // emit events
        emit SettingArrayChanged("liquidationCollateralFactorBIPS", _liquidationFactors);
        emit SettingArrayChanged("liquidationFactorVaultCollateralBIPS", _vaultCollateralFactors);
    }

    function setMaxEmergencyPauseDurationSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        require(_value <= settings.maxEmergencyPauseDurationSeconds * 4, "increase too big");
        require(_value >= settings.maxEmergencyPauseDurationSeconds / 4, "decrease too big");
        // update
        settings.maxEmergencyPauseDurationSeconds = _value.toUint64();
        // emit events
        emit SettingChanged("maxEmergencyPauseDurationSeconds", _value);
    }

    function setEmergencyPauseDurationResetAfterSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        require(_value <= settings.emergencyPauseDurationResetAfterSeconds * 4, "increase too big");
        require(_value >= settings.emergencyPauseDurationResetAfterSeconds / 4, "decrease too big");
        // update
        settings.emergencyPauseDurationResetAfterSeconds = _value.toUint64();
        // emit events
        emit SettingChanged("emergencyPauseDurationResetAfterSeconds", _value);
    }

    function setCancelCollateralReservationAfterSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        require(_value <= settings.cancelCollateralReservationAfterSeconds * 4 + 1 minutes,
            "increase too big");
        require(_value >= settings.cancelCollateralReservationAfterSeconds / 4,
            "decrease too big");
        // update
        settings.cancelCollateralReservationAfterSeconds = _value.toUint64();
        emit IAssetManagerEvents.SettingChanged("cancelCollateralReservationAfterSeconds", _value);
    }

    function setRejectRedemptionRequestWindowSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        require(_value <= settings.rejectRedemptionRequestWindowSeconds * 4 + 1 minutes,
            "increase too big");
        require(_value >= settings.rejectRedemptionRequestWindowSeconds / 4,
            "decrease too big");
        // update
        settings.rejectRedemptionRequestWindowSeconds = _value.toUint64();
        emit IAssetManagerEvents.SettingChanged("rejectRedemptionRequestWindowSeconds", _value);
    }

    function setTakeOverRedemptionRequestWindowSeconds(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_value > 0, "cannot be zero");
        require(_value <= settings.takeOverRedemptionRequestWindowSeconds * 4 + 1 minutes,
            "increase too big");
        require(_value >= settings.takeOverRedemptionRequestWindowSeconds / 4,
            "decrease too big");
        // update
        settings.takeOverRedemptionRequestWindowSeconds = _value.toUint64();
        emit IAssetManagerEvents.SettingChanged("takeOverRedemptionRequestWindowSeconds", _value);
    }

    function setRejectedRedemptionDefaultFactorBips(uint256 _vaultF, uint256 _poolF)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        require(_vaultF + _poolF > SafePct.MAX_BIPS, "bips value too low");
        require(_vaultF <= settings.rejectedRedemptionDefaultFactorVaultCollateralBIPS.mulBips(12000) + 1000,
            "fee increase too big");
        require(_vaultF >= settings.rejectedRedemptionDefaultFactorVaultCollateralBIPS.mulBips(8333),
            "fee decrease too big");
        require(_poolF <= settings.rejectedRedemptionDefaultFactorPoolBIPS.mulBips(12000) + 1000,
            "fee increase too big");
        require(_poolF >= settings.rejectedRedemptionDefaultFactorPoolBIPS.mulBips(8333),
            "fee decrease too big");
        // update
        settings.rejectedRedemptionDefaultFactorVaultCollateralBIPS = _vaultF.toUint32();
        emit IAssetManagerEvents.SettingChanged("rejectedRedemptionDefaultFactorVaultCollateralBIPS", _vaultF);
        settings.rejectedRedemptionDefaultFactorPoolBIPS = _poolF.toUint32();
        emit IAssetManagerEvents.SettingChanged("rejectedRedemptionDefaultFactorPoolBIPS", _poolF);
    }
}
