// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";

library SettingsUpdater {
    using SafeCast for uint256;
    using SafePct for *;

    struct CollateralRatioUpdate {
        uint64 validAt;
        uint32 minCollateralRatioBIPS;
        uint32 ccbMinCollateralRatioBIPS;
        uint32 safetyMinCollateralRatioBIPS;
    }

    struct PaymentTimeUpdate {
        uint64 validAt;
        uint64 underlyingBlocksForPayment;
        uint64 underlyingSecondsForPayment;
    }

    struct WhitelistUpdate {
        uint64 validAt;
        address whitelist;
    }

    struct PendingUpdates {
        CollateralRatioUpdate collateralRatio;
        PaymentTimeUpdate paymentTime;
        WhitelistUpdate whitelist;
        // last update time
        mapping (bytes32 => uint256) lastUpdate;
    }

    bytes32 internal constant UPDATE_CONTRACTS =
        keccak256("updateContracts(address,IAgentVaultFactory,IAttestationClient,IFtsoRegistry,IWNat)");
    bytes32 internal constant REFRESH_FTSO_INDEXES =
        keccak256("refreshFtsoIndexes()");
    bytes32 internal constant SET_COLLATERAL_RATIOS =
        keccak256("setCollateralRatios(uint256,uint256,uint256)");
    bytes32 internal constant SET_TIME_FOR_PAYMENT =
        keccak256("setTimeForPayment(uint256,uint256)");
    bytes32 internal constant SET_WHITELIST =
        keccak256("setWhitelist(address)");
    bytes32 internal constant SET_LOT_SIZE_AMG =
        keccak256("setLotSizeAmg(uint256)");
    bytes32 internal constant SET_MAX_TRUSTED_PRICE_AGE_SECONDS =
        keccak256("setMaxTrustedPriceAgeSeconds(uint256)");
    bytes32 internal constant SET_PAYMENT_CHALLENGE_REWARD =
        keccak256("setPaymentChallengeReward(uint256,uint256)");
    bytes32 internal constant SET_COLLATERAL_RESERVATION_FEE_BIPS =
        keccak256("setCollateralReservationFeeBips(uint256)");
    bytes32 internal constant SET_REDEMPTION_FEE_BIPS =
        keccak256("setRedemptionFeeBips(uint256)");
    bytes32 internal constant SET_REDEMPTION_DEFAULT_FACTOR_BIPS =
        keccak256("setRedemptionDefaultFactorBips(uint256,uint256)");
    bytes32 internal constant SET_CONFIRMATION_BY_OTHERS_AFTER_SECONDS =
        keccak256("setConfirmationByOthersAfterSeconds(uint256)");
    bytes32 internal constant SET_CONFIRMATION_BY_OTHERS_REWARD_C1_WEI =
        keccak256("setConfirmationByOthersRewardC1Wei(uint256)");
    bytes32 internal constant SET_MAX_REDEEMED_TICKETS =
        keccak256("setMaxRedeemedTickets(uint256)");
    bytes32 internal constant SET_WITHDRAWAL_OR_DESTROY_WAIT_MIN_SECONDS =
        keccak256("setWithdrawalOrDestroyWaitMinSeconds(uint256)");
    bytes32 internal constant SET_CCB_TIME_SECONDS =
        keccak256("setCcbTimeSeconds(uint256)");
    bytes32 internal constant SET_LIQUIDATION_STEP_SECONDS =
        keccak256("setLiquidationStepSeconds(uint256)");
    bytes32 internal constant SET_LIQUIDATION_COLLATERAL_FACTOR_BIPS =
        keccak256("setLiquidationCollateralFactorBips(uint256[])");
    bytes32 internal constant SET_ATTESTATION_WINDOW_SECONDS =
        keccak256("setAttestationWindowSeconds(uint256)");
    bytes32 internal constant SET_ANNOUNCED_UNDERLYING_CONFIRMATION_MIN_SECONDS =
        keccak256("setAnnouncedUnderlyingConfirmationMinSeconds(uint256)");

    function validateAndSet(
        AssetManagerSettings.Data memory _settings
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        _validateSettings(_settings);
        state.settings = _settings;
        _refreshFtsoIndexes();
    }

    function callUpdate(
        PendingUpdates storage _updates,
        bytes32 _method,
        bytes calldata _params
    )
        external
    {
        if (_method == UPDATE_CONTRACTS) {
            _updateContracts(_params);
        } else if (_method == REFRESH_FTSO_INDEXES) {
            _refreshFtsoIndexes();
        } else if (_method == SET_COLLATERAL_RATIOS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setCollateralRatios(_params);
        } else if (_method == SET_TIME_FOR_PAYMENT) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setTimeForPayment(_params);
        } else if (_method == SET_PAYMENT_CHALLENGE_REWARD) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setPaymentChallengeReward(_params);
        } else if (_method == SET_WHITELIST) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setWhitelist(_params);
        } else if (_method == SET_LOT_SIZE_AMG) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setLotSizeAmg(_params);
        } else if (_method == SET_COLLATERAL_RESERVATION_FEE_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setCollateralReservationFeeBips(_params);
        } else if (_method == SET_REDEMPTION_FEE_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setRedemptionFeeBips(_params);
        } else if (_method == SET_REDEMPTION_DEFAULT_FACTOR_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setRedemptionDefaultFactorBips(_params);
        } else if (_method == SET_CONFIRMATION_BY_OTHERS_AFTER_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setConfirmationByOthersAfterSeconds(_params);
        } else if (_method == SET_CONFIRMATION_BY_OTHERS_REWARD_C1_WEI) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setConfirmationByOthersRewardC1Wei(_params);
        } else if (_method == SET_MAX_REDEEMED_TICKETS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setMaxRedeemedTickets(_params);
        } else if (_method == SET_WITHDRAWAL_OR_DESTROY_WAIT_MIN_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setWithdrawalOrDestroyWaitMinSeconds(_params);
        } else if (_method == SET_CCB_TIME_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setCcbTimeSeconds(_params);
        } else if (_method == SET_LIQUIDATION_STEP_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setLiquidationStepSeconds(_params);
        } else if (_method == SET_LIQUIDATION_COLLATERAL_FACTOR_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setLiquidationCollateralFactorBips(_params);
        } else if (_method == SET_ATTESTATION_WINDOW_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setAttestationWindowSeconds(_params);
        } else if (_method == SET_MAX_TRUSTED_PRICE_AGE_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setMaxTrustedPriceAgeSeconds(_params);
        } else if (_method == SET_ANNOUNCED_UNDERLYING_CONFIRMATION_MIN_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_updates, _method);
            _setAnnouncedUnderlyingConfirmationMinSeconds(_params);
        }
        else {
            revert("update: invalid method");
        }
    }

    function _updateContracts(
        bytes calldata _params
    )
        private
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        (
            address controller,
            IAgentVaultFactory agentVaultFactory,
            IAttestationClient attestationClient,
            IFtsoRegistry ftsoRegistry,
            IWNat wNat
        )
            = abi.decode(_params, (address, IAgentVaultFactory, IAttestationClient, IFtsoRegistry, IWNat));

        if (state.settings.assetManagerController != controller) {
            state.settings.assetManagerController = controller;
            emit AMEvents.ContractChanged("assetManagerController", address(controller));
        }
        if (state.settings.agentVaultFactory != agentVaultFactory) {
            state.settings.agentVaultFactory = agentVaultFactory;
            emit AMEvents.ContractChanged("agentVaultFactory", address(agentVaultFactory));
        }
        if (state.settings.attestationClient != attestationClient) {
            state.settings.attestationClient = attestationClient;
            emit AMEvents.ContractChanged("attestationClient", address(attestationClient));
        }
        if (state.settings.ftsoRegistry != ftsoRegistry) {
            state.settings.ftsoRegistry = ftsoRegistry;
            emit AMEvents.ContractChanged("ftsoRegistry", address(ftsoRegistry));
        }
        // TODO: what to do with the NATs in the pool - this will trigger liquidation
        CollateralToken.Data storage poolCollateral = state.collateralTokens[CollateralToken.POOL];
        if (poolCollateral.token != wNat) {
            poolCollateral.token = wNat;
            emit AMEvents.ContractChanged("wNat", address(wNat));
        }
    }

    function _refreshFtsoIndexes() private
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 length = state.collateralTokens.length;
        for (uint256 i = 0; i < length; i++) {
            CollateralToken.Data storage collateral = state.collateralTokens[i];
            // do not update invalidated tokens types
            if (collateral.validUntil != 0 && collateral.validUntil < block.timestamp) continue;
            collateral.ftsoIndex = state.settings.ftsoRegistry.getFtsoIndex(collateral.symbol).toUint16();
        }
    }

    function _checkEnoughTimeSinceLastUpdate(
        PendingUpdates storage _updates,
        bytes32 _method
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 lastUpdate = _updates.lastUpdate[_method];
        require(lastUpdate == 0 || block.timestamp >= lastUpdate + settings.minUpdateRepeatTimeSeconds,
            "too close to previous update");
        _updates.lastUpdate[_method] = block.timestamp;
    }

    function _setCollateralRatios(
        bytes calldata _params
    )
        private
    {
        // TODO: replace per collateral
        // (uint256 minCR, uint256 ccbCR, uint256 safetyCR) =
        //     abi.decode(_params, (uint256, uint256, uint256));
        // // validations
        // require(SafePct.MAX_BIPS < ccbCR && ccbCR < minCR && minCR < safetyCR, "invalid collateral ratios");
        // uint32[] storage liquidationFactors = state.settings.liquidationCollateralFactorBIPS;
        // require(liquidationFactors[liquidationFactors.length - 1] <= safetyCR, "liquidation factor too high");
        // // update
        // state.settings.minCollateralRatioBIPS = minCR.toUint32();
        // state.settings.ccbMinCollateralRatioBIPS = ccbCR.toUint32();
        // state.settings.safetyMinCollateralRatioBIPS = safetyCR.toUint32();
        // emit AMEvents.SettingChanged("minCollateralRatioBIPS", minCR);
        // emit AMEvents.SettingChanged("ccbMinCollateralRatioBIPS", ccbCR);
        // emit AMEvents.SettingChanged("safetyMinCollateralRatioBIPS", safetyCR);
    }

    function _setTimeForPayment(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        (uint256 underlyingBlocks, uint256 underlyingSeconds) =
            abi.decode(_params, (uint256, uint256));
        // update
        settings.underlyingBlocksForPayment = underlyingBlocks.toUint64();
        settings.underlyingSecondsForPayment = underlyingSeconds.toUint64();
        emit AMEvents.SettingChanged("underlyingBlocksForPayment", underlyingBlocks);
        emit AMEvents.SettingChanged("underlyingSecondsForPayment", underlyingSeconds);
    }

    function _setPaymentChallengeReward(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        (uint256 rewardNATWei, uint256 rewardBIPS) = abi.decode(_params, (uint256, uint256));
        // validate
        require(rewardNATWei <= (settings.paymentChallengeRewardC1Wei * 4) + 100 ether, "increase too big");
        require(rewardNATWei >= (settings.paymentChallengeRewardC1Wei) / 4, "decrease too big");
        require(rewardBIPS <= (settings.paymentChallengeRewardBIPS * 4) + 100, "increase too big");
        require(rewardBIPS >= (settings.paymentChallengeRewardBIPS) / 4, "decrease too big");
        // update
        settings.paymentChallengeRewardC1Wei = rewardNATWei.toUint128();
        settings.paymentChallengeRewardBIPS = rewardBIPS.toUint16();
        emit AMEvents.SettingChanged("paymentChallengeRewardC1Wei", rewardNATWei);
        emit AMEvents.SettingChanged("paymentChallengeRewardBIPS", rewardBIPS);
    }

    function _setWhitelist(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        address value = abi.decode(_params, (address));
        // validate
        // update
        settings.whitelist = IWhitelist(value);
        emit AMEvents.ContractChanged("whitelist", value);

    }

    function _setLotSizeAmg(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        // huge lot size increase is very dangerous, because it breaks redemption
        // (converts all tickets to dust)
        require(value > 0, "cannot be zero");
        require(value <= settings.lotSizeAMG * 2, "lot size increase too big");
        require(value >= settings.lotSizeAMG / 4, "lot size decrease too big");
        // update
        settings.lotSizeAMG = value.toUint64();
        emit AMEvents.SettingChanged("lotSizeAMG", value);
    }

    function _setMaxTrustedPriceAgeSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value > 0, "cannot be zero");
        require(value <= settings.maxTrustedPriceAgeSeconds * 2, "fee increase too big");
        require(value >= settings.maxTrustedPriceAgeSeconds / 2, "fee decrease too big");
        // update
        settings.maxTrustedPriceAgeSeconds = value.toUint64();
        emit AMEvents.SettingChanged("maxTrustedPriceAgeSeconds", value);
    }

    function _setCollateralReservationFeeBips(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value > 0, "cannot be zero");
        require(value <= SafePct.MAX_BIPS, "bips value too high");
        require(value <= settings.collateralReservationFeeBIPS * 4, "fee increase too big");
        require(value >= settings.collateralReservationFeeBIPS / 4, "fee decrease too big");
        // update
        settings.collateralReservationFeeBIPS = value.toUint16();
        emit AMEvents.SettingChanged("collateralReservationFeeBIPS", value);
    }

    function _setRedemptionFeeBips(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value > 0, "cannot be zero");
        require(value <= SafePct.MAX_BIPS, "bips value too high");
        require(value <= settings.redemptionFeeBIPS * 4, "fee increase too big");
        require(value >= settings.redemptionFeeBIPS / 4, "fee decrease too big");
        // update
        settings.redemptionFeeBIPS = value.toUint16();
        emit AMEvents.SettingChanged("redemptionFeeBIPS", value);
    }

    function _setRedemptionDefaultFactorBips(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        (uint256 class1, uint256 pool) = abi.decode(_params, (uint256, uint256));
        // validate
        require(class1 + pool > SafePct.MAX_BIPS, "bips value too low");
        require(class1 <= settings.redemptionDefaultFactorAgentC1BIPS.mulBips(12000), "fee increase too big");
        require(class1 >= settings.redemptionDefaultFactorAgentC1BIPS.mulBips(8333), "fee decrease too big");
        require(pool <= settings.redemptionDefaultFactorPoolBIPS.mulBips(12000), "fee increase too big");
        require(pool >= settings.redemptionDefaultFactorPoolBIPS.mulBips(8333), "fee decrease too big");
        // update
        settings.redemptionDefaultFactorAgentC1BIPS = class1.toUint32();
        emit AMEvents.SettingChanged("redemptionDefaultFactorAgentC1BIPS", class1);
        settings.redemptionDefaultFactorPoolBIPS = pool.toUint32();
        emit AMEvents.SettingChanged("redemptionDefaultFactorPoolBIPS", pool);
    }

    function _setConfirmationByOthersAfterSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value >= 2 hours, "must be at least two hours");
        // update
        settings.confirmationByOthersAfterSeconds = value.toUint64();
        emit AMEvents.SettingChanged("confirmationByOthersAfterSeconds", value);
    }

    function _setConfirmationByOthersRewardC1Wei(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value > 0, "cannot be zero");
        require(value <= settings.confirmationByOthersRewardC1Wei * 4, "fee increase too big");
        require(value >= settings.confirmationByOthersRewardC1Wei / 4, "fee decrease too big");
        // update
        settings.confirmationByOthersRewardC1Wei = value.toUint128();
        emit AMEvents.SettingChanged("confirmationByOthersRewardC1Wei", value);
    }

    function _setMaxRedeemedTickets(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value > 0, "cannot be zero");
        require(value <= settings.maxRedeemedTickets * 2, "increase too big");
        require(value >= settings.maxRedeemedTickets / 4, "decrease too big");
        // update
        settings.maxRedeemedTickets = value.toUint16();
        emit AMEvents.SettingChanged("maxRedeemedTickets", value);
    }

    function _setWithdrawalOrDestroyWaitMinSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        // making this value small doesn't present huge danger, so we don't limit decrease
        require(value > 0, "cannot be zero");
        require(value <= settings.withdrawalWaitMinSeconds + 10 minutes, "increase too big");
        // update
        settings.withdrawalWaitMinSeconds = value.toUint64();
        emit AMEvents.SettingChanged("withdrawalWaitMinSeconds", value);
    }

    function _setCcbTimeSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value > 0, "cannot be zero");
        require(value <= settings.ccbTimeSeconds * 2, "increase too big");
        require(value >= settings.ccbTimeSeconds / 2, "decrease too big");
        // update
        settings.ccbTimeSeconds = value.toUint64();
        emit AMEvents.SettingChanged("ccbTimeSeconds", value);
    }

    function _setLiquidationStepSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value > 0, "cannot be zero");
        require(value <= settings.liquidationStepSeconds * 2, "increase too big");
        require(value >= settings.liquidationStepSeconds / 2, "decrease too big");
        // update
        settings.liquidationStepSeconds = value.toUint64();
        emit AMEvents.SettingChanged("liquidationStepSeconds", value);
    }

    function _setLiquidationCollateralFactorBips(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256[] memory value = abi.decode(_params, (uint256[]));
        // validate
        require(value.length >= 1, "at least one factor required");
        // update
        delete settings.liquidationCollateralFactorBIPS;
        for (uint256 i = 0; i < value.length; i++) {
            require(value[i] > SafePct.MAX_BIPS, "factor not above 1");
            require(i == 0 || value[i] > value[i - 1], "factors not increasing");
            settings.liquidationCollateralFactorBIPS.push(value[i].toUint32());
        }
        emit AMEvents.SettingArrayChanged("liquidationCollateralFactorBIPS", value);
    }

    function _setAttestationWindowSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value >= 1 days, "window too small");
        // update
        settings.attestationWindowSeconds = value.toUint64();
        emit AMEvents.SettingChanged("attestationWindowSeconds", value);
    }

    function _setAnnouncedUnderlyingConfirmationMinSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= 1 hours, "confirmation time too big");
        // update
        settings.announcedUnderlyingConfirmationMinSeconds = value.toUint64();
        emit AMEvents.SettingChanged("announcedUnderlyingConfirmationMinSeconds", value);
    }

    function _validateSettings(
        AssetManagerSettings.Data memory _settings
    )
        private pure
    {
        require(address(_settings.fAsset) != address(0), "zero fAsset address");

        require(_settings.assetUnitUBA > 0, "cannot be zero");
        require(_settings.assetMintingGranularityUBA > 0, "cannot be zero");
        require(_settings.underlyingBlocksForPayment > 0, "cannot be zero");
        require(_settings.underlyingSecondsForPayment > 0, "cannot be zero");
        require(_settings.redemptionFeeBIPS > 0, "cannot be zero");
        require(_settings.collateralReservationFeeBIPS > 0, "cannot be zero");
        require(_settings.confirmationByOthersRewardC1Wei > 0, "cannot be zero");
        require(_settings.maxRedeemedTickets > 0, "cannot be zero");
        require(_settings.ccbTimeSeconds > 0, "cannot be zero");
        require(_settings.liquidationStepSeconds > 0, "cannot be zero");
        require(_settings.maxTrustedPriceAgeSeconds > 0, "cannot be zero");
        require(_settings.minUpdateRepeatTimeSeconds > 0, "cannot be zero");
        require(_settings.buybackCollateralFactorBIPS > 0, "cannot be zero");
        require(_settings.withdrawalWaitMinSeconds > 0, "cannot be zero");
        require(_settings.lotSizeAMG > 0, "cannot be zero");

        // TODO: fix collateral ratios for multi collateral tokens
        // uint256 minCR = _settings.minCollateralRatioBIPS;
        // uint256 ccbCR = _settings.ccbMinCollateralRatioBIPS;
        // uint256 safetyCR = _settings.safetyMinCollateralRatioBIPS;
        // require(SafePct.MAX_BIPS < ccbCR && ccbCR < minCR && minCR < safetyCR, "invalid collateral ratios");

        uint32[] memory liqFactors = _settings.liquidationCollateralFactorBIPS;
        require(liqFactors.length >= 1, "at least one factor required");
        for (uint256 i = 0; i < liqFactors.length; i++) {
            require(liqFactors[i] > SafePct.MAX_BIPS, "factor not above 1");
            require(i == 0 || liqFactors[i] > liqFactors[i - 1], "factors not increasing");
        }

        require(_settings.collateralReservationFeeBIPS <= SafePct.MAX_BIPS, "bips value too high");
        require(_settings.redemptionFeeBIPS <= SafePct.MAX_BIPS, "bips value too high");
        uint256 redemptionFactorBIPS =
            _settings.redemptionDefaultFactorAgentC1BIPS + _settings.redemptionDefaultFactorPoolBIPS;
        require(redemptionFactorBIPS > SafePct.MAX_BIPS, "bips value too low");
        require(_settings.attestationWindowSeconds >= 1 days, "window too small");
        require(_settings.confirmationByOthersAfterSeconds >= 2 hours, "must be at least two hours");
        require(_settings.announcedUnderlyingConfirmationMinSeconds <= 1 hours, "confirmation time too big");
    }
}
