// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./AMEvents.sol";
import "./AssetManagerState.sol";

library SettingsUpdater {
    using SafeBips for *;
    
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
    bytes32 internal constant EXECUTE_SET_COLLATERAL_RATIOS =
        keccak256("executeSetCollateralRatios()");
    bytes32 internal constant SET_TIME_FOR_PAYMENT =
        keccak256("setTimeForPayment(uint256,uint256)");
    bytes32 internal constant EXECUTE_SET_TIME_FOR_PAYMENT =
        keccak256("executeSetTimeForPayment()");
    bytes32 internal constant SET_WHITELIST =
        keccak256("setWhitelist(address)");
    bytes32 internal constant EXECUTE_SET_WHITELIST =
        keccak256("executeSetWhitelist()");
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
        keccak256("setRedemptionDefaultFactorBips(uint256)");
    bytes32 internal constant SET_CONFIRMATION_BY_OTHERS_AFTER_SECONDS =
        keccak256("setConfirmationByOthersAfterSeconds(uint256)");
    bytes32 internal constant SET_CONFIRMATION_BY_OTHERS_REWARD_NAT_WEI =
        keccak256("setConfirmationByOthersRewardNatWei(uint256)");
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
        
    function validateAndSet(
        AssetManagerState.State storage _state,
        AssetManagerSettings.Settings memory _settings
    )
        external
    {
        _validateSettings(_settings);
        _state.settings = _settings;
        _refreshFtsoIndexes(_state);
    }
    
    function callUpdate(
        AssetManagerState.State storage _state,
        PendingUpdates storage _updates,
        bytes32 _method,
        bytes calldata _params
    )
        external
    {
        if (_method == UPDATE_CONTRACTS) {
            _updateContracts(_state, _params);
        } else if (_method == REFRESH_FTSO_INDEXES) {
            _refreshFtsoIndexes(_state);
        } else if (_method == SET_COLLATERAL_RATIOS) {
            _setCollateralRatios(_state, _updates.collateralRatio, _params);
        } else if (_method == EXECUTE_SET_COLLATERAL_RATIOS) {
            _executeSetCollateralRatios(_state, _updates.collateralRatio);
        } else if (_method == SET_TIME_FOR_PAYMENT) {
            _setTimeForPayment(_state, _updates.paymentTime, _params);
        } else if (_method == EXECUTE_SET_TIME_FOR_PAYMENT) {
            _executeSetTimeForPayment(_state, _updates.paymentTime);
        } else if (_method == SET_PAYMENT_CHALLENGE_REWARD) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setPaymentChallengeReward(_state, _params);
        } else if (_method == SET_WHITELIST) {
            _setWhitelist(_state, _updates.whitelist, _params);
        } else if (_method == EXECUTE_SET_WHITELIST) {
            _executeSetWhitelist(_state, _updates.whitelist);
        } else if (_method == SET_LOT_SIZE_AMG) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setLotSizeAmg(_state, _params);
        } else if (_method == SET_COLLATERAL_RESERVATION_FEE_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setCollateralReservationFeeBips(_state, _params);
        } else if (_method == SET_REDEMPTION_FEE_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setRedemptionFeeBips(_state, _params);
        } else if (_method == SET_REDEMPTION_DEFAULT_FACTOR_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setRedemptionDefaultFactorBips(_state, _params);
        } else if (_method == SET_CONFIRMATION_BY_OTHERS_AFTER_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setConfirmationByOthersAfterSeconds(_state, _params);
        } else if (_method == SET_CONFIRMATION_BY_OTHERS_REWARD_NAT_WEI) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setConfirmationByOthersRewardNatWei(_state, _params);
        } else if (_method == SET_MAX_REDEEMED_TICKETS) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setMaxRedeemedTickets(_state, _params);
        } else if (_method == SET_WITHDRAWAL_OR_DESTROY_WAIT_MIN_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setWithdrawalOrDestroyWaitMinSeconds(_state, _params);
        } else if (_method == SET_CCB_TIME_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setCcbTimeSeconds(_state, _params);
        } else if (_method == SET_LIQUIDATION_STEP_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setLiquidationStepSeconds(_state, _params);
        } else if (_method == SET_LIQUIDATION_COLLATERAL_FACTOR_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setLiquidationCollateralFactorBips(_state, _updates.collateralRatio, _params);
        } else if (_method == SET_ATTESTATION_WINDOW_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setAttestationWindowSeconds(_state, _params);
        } else if (_method == SET_MAX_TRUSTED_PRICE_AGE_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_state, _updates, _method);
            _setMaxTrustedPriceAgeSeconds(_state, _params);
        }
        else {
            revert("update: invalid method");
        }
    }

    function _updateContracts(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        (
            address controller,
            IAgentVaultFactory agentVaultFactory,
            IAttestationClient attestationClient,
            IFtsoRegistry ftsoRegistry,
            IWNat wNat
        )
            = abi.decode(_params, (address, IAgentVaultFactory, IAttestationClient, IFtsoRegistry, IWNat));

        if (_state.settings.assetManagerController != controller) {
            _state.settings.assetManagerController = controller;
            emit AMEvents.ContractChanged("assetManagerController", address(controller));
        }
        if (_state.settings.agentVaultFactory != agentVaultFactory) {
            _state.settings.agentVaultFactory = agentVaultFactory;
            emit AMEvents.ContractChanged("agentVaultFactory", address(agentVaultFactory));
        }
        if (_state.settings.attestationClient != attestationClient) {
            _state.settings.attestationClient = attestationClient;
            emit AMEvents.ContractChanged("attestationClient", address(attestationClient));
        }
        if (_state.settings.ftsoRegistry != ftsoRegistry) {
            _state.settings.ftsoRegistry = ftsoRegistry;
            emit AMEvents.ContractChanged("ftsoRegistry", address(ftsoRegistry));
        }
        if (_state.settings.wNat != wNat) {
            _state.settings.wNat = wNat;
            emit AMEvents.ContractChanged("wNat", address(wNat));
        }
    }
    
    function _refreshFtsoIndexes(
        AssetManagerState.State storage _state
    )
        private
    {
        _state.settings.natFtsoIndex = 
            SafeCast.toUint32(_state.settings.ftsoRegistry.getFtsoIndex(_state.settings.natFtsoSymbol));
        _state.settings.assetFtsoIndex = 
            SafeCast.toUint32(_state.settings.ftsoRegistry.getFtsoIndex(_state.settings.assetFtsoSymbol));
    }
    
    
    function _checkEnoughTimeSinceLastUpdate(
        AssetManagerState.State storage _state,
        PendingUpdates storage _updates,
        bytes32 _method
    )
        private
    {
        uint256 lastUpdate = _updates.lastUpdate[_method];
        require(lastUpdate == 0 || block.timestamp >= lastUpdate + _state.settings.minUpdateRepeatTimeSeconds,
            "too close to previous update");
        _updates.lastUpdate[_method] = block.timestamp;
    }

    function _setCollateralRatios(
        AssetManagerState.State storage _state,
        CollateralRatioUpdate storage _update,
        bytes calldata _params
    ) 
        private 
    {
        (uint256 minCR, uint256 ccbCR, uint256 safetyCR) = 
            abi.decode(_params, (uint256, uint256, uint256));
        // validations
        require(1 < ccbCR && ccbCR < minCR && minCR < safetyCR, "invalid collateral ratios");
        uint32[] storage liquidationFactors = _state.settings.liquidationCollateralFactorBIPS;
        require(liquidationFactors[liquidationFactors.length - 1] <= safetyCR, "liquidation factor too high");
        // create pending update
        uint256 validAt = block.timestamp + _state.settings.timelockSeconds;
        _update.validAt = SafeCast.toUint64(validAt);
        _update.minCollateralRatioBIPS = SafeCast.toUint32(minCR);
        _update.ccbMinCollateralRatioBIPS = SafeCast.toUint32(ccbCR);
        _update.safetyMinCollateralRatioBIPS = SafeCast.toUint32(safetyCR);
        emit AMEvents.SettingChangeScheduled("minCollateralRatioBIPS", minCR, validAt);
        emit AMEvents.SettingChangeScheduled("ccbMinCollateralRatioBIPS", ccbCR, validAt);
        emit AMEvents.SettingChangeScheduled("safetyMinCollateralRatioBIPS", safetyCR, validAt);
    }

    function _executeSetCollateralRatios(
        AssetManagerState.State storage _state,
        CollateralRatioUpdate storage _update
    ) 
        private 
    {
        require(_update.validAt != 0 && block.timestamp >= _update.validAt, "update not valid yet");
        _update.validAt = 0;
        _state.settings.minCollateralRatioBIPS = _update.minCollateralRatioBIPS;
        _state.settings.ccbMinCollateralRatioBIPS = _update.ccbMinCollateralRatioBIPS;
        _state.settings.safetyMinCollateralRatioBIPS = _update.safetyMinCollateralRatioBIPS;
        emit AMEvents.SettingChanged("minCollateralRatioBIPS", _update.minCollateralRatioBIPS);
        emit AMEvents.SettingChanged("ccbMinCollateralRatioBIPS", _update.ccbMinCollateralRatioBIPS);
        emit AMEvents.SettingChanged("safetyMinCollateralRatioBIPS", _update.safetyMinCollateralRatioBIPS);
    }
    
    function _setTimeForPayment(
        AssetManagerState.State storage _state,
        PaymentTimeUpdate storage _update,
        bytes calldata _params
    ) 
        private 
    {
        (uint256 underlyingBlocks, uint256 underlyingSeconds) = 
            abi.decode(_params, (uint256, uint256));
        uint256 validAt = block.timestamp + _state.settings.timelockSeconds;
        _update.validAt = SafeCast.toUint64(validAt);
        _update.underlyingBlocksForPayment = SafeCast.toUint64(underlyingBlocks);
        _update.underlyingSecondsForPayment = SafeCast.toUint64(underlyingSeconds);
        emit AMEvents.SettingChangeScheduled("underlyingBlocksForPayment", underlyingBlocks, validAt);
        emit AMEvents.SettingChangeScheduled("underlyingSecondsForPayment", underlyingSeconds, validAt);
    }
    
    function _executeSetTimeForPayment(
        AssetManagerState.State storage _state,
        PaymentTimeUpdate storage _update
    ) 
        private 
    {
        require(_update.validAt != 0 && block.timestamp >= _update.validAt, "update not valid yet");
        _update.validAt = 0;
        _state.settings.underlyingBlocksForPayment = _update.underlyingBlocksForPayment;
        _state.settings.underlyingSecondsForPayment = _update.underlyingSecondsForPayment;
        emit AMEvents.SettingChanged("underlyingBlocksForPayment", _update.underlyingBlocksForPayment);
        emit AMEvents.SettingChanged("underlyingSecondsForPayment", _update.underlyingSecondsForPayment);
    }
    
    function _setPaymentChallengeReward(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        (uint256 rewardNATWei, uint256 rewardBIPS) = abi.decode(_params, (uint256, uint256));
        // validate
        require(rewardNATWei <= _state.settings.paymentChallengeRewardNATWei * 4, "increase too big");
        require(rewardNATWei >= _state.settings.paymentChallengeRewardNATWei / 4, "decrease too big");
        require(rewardBIPS <= (_state.settings.paymentChallengeRewardBIPS + 100) * 4, "increase too big");
        require(rewardBIPS >= _state.settings.paymentChallengeRewardBIPS / 4, "decrease too big");
        // update
        _state.settings.paymentChallengeRewardNATWei = SafeCast.toUint128(rewardNATWei);
        _state.settings.paymentChallengeRewardBIPS = SafeCast.toUint16(rewardBIPS);
        emit AMEvents.SettingChanged("paymentChallengeRewardNATWei", rewardNATWei);
        emit AMEvents.SettingChanged("paymentChallengeRewardBIPS", rewardBIPS);
    }

    function _setWhitelist(
        AssetManagerState.State storage _state,
        WhitelistUpdate storage _update,
        bytes calldata _params
    ) 
        private 
    {
        address value = abi.decode(_params, (address));
        // validate
        // create pending update
        uint256 validAt = block.timestamp + _state.settings.timelockSeconds;
        _update.validAt = SafeCast.toUint64(validAt);
        _update.whitelist = value;
        emit AMEvents.ContractChangeScheduled("whitelist", value, validAt);
    }

    function _executeSetWhitelist(
        AssetManagerState.State storage _state,
        WhitelistUpdate storage _update
    ) 
        private 
    {    
        require(_update.validAt != 0 && block.timestamp >= _update.validAt, "update not valid yet");
        _update.validAt = 0;
        _state.settings.whitelist = IWhitelist(_update.whitelist);
        emit AMEvents.ContractChanged("whitelist", _update.whitelist);

    }
    
    function _setLotSizeAmg(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        // validate
        // huge lot size increase is very dangerous, because it breaks redemption
        // (converts all tickets to dust)
        require(value <= _state.settings.lotSizeAMG * 2, "lot size increase too big");
        require(value >= _state.settings.lotSizeAMG / 4, "lot size decrease too big");
        // update
        _state.settings.lotSizeAMG = SafeCast.toUint64(value);
        emit AMEvents.SettingChanged("lotSizeAMG", value);
    }
    
    function _setMaxTrustedPriceAgeSeconds(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= _state.settings.maxTrustedPriceAgeSeconds * 2, "fee increase too big");
        require(value >= _state.settings.maxTrustedPriceAgeSeconds / 2, "fee decrease too big");
        // update
        _state.settings.maxTrustedPriceAgeSeconds = SafeCast.toUint64(value);
        emit AMEvents.SettingChanged("maxTrustedPriceAgeSeconds", value);
    }

    function _setCollateralReservationFeeBips(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= SafeBips.MAX_BIPS, "bips value too high");
        require(value <= _state.settings.collateralReservationFeeBIPS * 4, "fee increase too big");
        require(value >= _state.settings.collateralReservationFeeBIPS / 4, "fee decrease too big");
        // update
        _state.settings.collateralReservationFeeBIPS = SafeCast.toUint16(value);
        emit AMEvents.SettingChanged("collateralReservationFeeBIPS", value);
    }

    function _setRedemptionFeeBips(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= SafeBips.MAX_BIPS, "bips value too high");
        require(value <= _state.settings.redemptionFeeBIPS * 4, "fee increase too big");
        require(value >= _state.settings.redemptionFeeBIPS / 4, "fee decrease too big");
        // update
        _state.settings.redemptionFeeBIPS = SafeCast.toUint16(value);
        emit AMEvents.SettingChanged("redemptionFeeBIPS", value);
    }

    function _setRedemptionDefaultFactorBips(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value > SafeBips.MAX_BIPS, "bips value too low");
        require(value <= _state.settings.redemptionDefaultFactorBIPS.mulBips(12000), "fee increase too big");
        require(value >= _state.settings.redemptionDefaultFactorBIPS.mulBips(8333), "fee decrease too big");
        // update
        _state.settings.redemptionDefaultFactorBIPS = SafeCast.toUint32(value);
        emit AMEvents.SettingChanged("redemptionDefaultFactorBIPS", value);
    }

    function _setConfirmationByOthersAfterSeconds(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value >= 2 hours, "must be at least two hours");
        // update
        _state.settings.confirmationByOthersAfterSeconds = SafeCast.toUint64(value);
        emit AMEvents.SettingChanged("confirmationByOthersAfterSeconds", value);
    }

    function _setConfirmationByOthersRewardNatWei(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= _state.settings.confirmationByOthersRewardNATWei * 4, "fee increase too big");
        require(value >= _state.settings.confirmationByOthersRewardNATWei / 4, "fee decrease too big");
        // update
        _state.settings.confirmationByOthersRewardNATWei = SafeCast.toUint128(value);
        emit AMEvents.SettingChanged("confirmationByOthersRewardNATWei", value);
    }

    function _setMaxRedeemedTickets(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value >= 1, "cannot be zero");
        require(value <= _state.settings.maxRedeemedTickets * 2, "increase too big");
        require(value >= _state.settings.maxRedeemedTickets / 4, "decrease too big");
        // update
        _state.settings.maxRedeemedTickets = SafeCast.toUint16(value);
        emit AMEvents.SettingChanged("maxRedeemedTickets", value);
    }

    function _setWithdrawalOrDestroyWaitMinSeconds(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        // validate
        // making this value small doesn't present huge danger, so we don't limit decrease
        require(value >= 1, "cannot be zero");
        require(value <= _state.settings.withdrawalWaitMinSeconds + 10 minutes, "increase too big");
        // update
        _state.settings.withdrawalWaitMinSeconds = SafeCast.toUint64(value);
        emit AMEvents.SettingChanged("withdrawalWaitMinSeconds", value);
    }

    function _setCcbTimeSeconds(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= _state.settings.ccbTimeSeconds * 2, "increase too big");
        require(value >= _state.settings.ccbTimeSeconds / 2, "decrease too big");
        // update
        _state.settings.ccbTimeSeconds = SafeCast.toUint64(value);
        emit AMEvents.SettingChanged("ccbTimeSeconds", value);
    }

    function _setLiquidationStepSeconds(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= _state.settings.liquidationStepSeconds * 2, "increase too big");
        require(value >= _state.settings.liquidationStepSeconds / 2, "decrease too big");
        // update
        _state.settings.liquidationStepSeconds = SafeCast.toUint64(value);
        emit AMEvents.SettingChanged("liquidationStepSeconds", value);
    }

    function _setLiquidationCollateralFactorBips(
        AssetManagerState.State storage _state,
        CollateralRatioUpdate storage _update,
        bytes calldata _params
    ) 
        private 
    {
        uint256[] memory value = abi.decode(_params, (uint256[]));
        // validate
        require(value.length >= 1, "at least one factor required");
        for (uint256 i = 1; i < value.length; i++) {
            require(value[i] >= value[i - 1], "factors not increasing");
        }
        require(value[value.length - 1] <= _state.settings.safetyMinCollateralRatioBIPS, 
            "liquidation factor too high");
        require(_update.validAt == 0 || value[value.length - 1] <= _update.safetyMinCollateralRatioBIPS,
            "liquidation factor too high - pending update");
        // update
        delete _state.settings.liquidationCollateralFactorBIPS;
        for (uint256 i = 0; i < value.length; i++) {
            require(value[i] > SafeBips.MAX_BIPS, "factor not above 1");
            require(i == 0 || value[i] > value[i - 1], "factors not increasing");
            _state.settings.liquidationCollateralFactorBIPS.push(SafeCast.toUint32(value[i]));
        }
        emit AMEvents.SettingArrayChanged("liquidationCollateralFactorBIPS", value);
    }
    
    function _setAttestationWindowSeconds(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value >= 1 days, "window too small");
        // update
        _state.settings.attestationWindowSeconds = SafeCast.toUint64(value);
        emit AMEvents.SettingChanged("attestationWindowSeconds", value);
    }

    function _validateSettings(
        AssetManagerSettings.Settings memory _settings
    ) 
        private view
    {
        // TODO: define conditions for validity
    }
}
