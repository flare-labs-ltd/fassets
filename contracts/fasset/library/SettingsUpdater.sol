// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./AMEvents.sol";
import "./AssetManagerState.sol";
import "./TransactionAttestation.sol";


library SettingsUpdater {
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
    
    struct PendingUpdates {
        CollateralRatioUpdate collateralRatio;
        PaymentTimeUpdate paymentTime;
    }
    
    bytes32 internal constant UPDATE_CONTRACTS = 
        keccak256("updateContracts(address,IAttestationClient,IFtsoRegistry,IWNat)");
    bytes32 internal constant SET_LOT_SIZE_AMG =
        keccak256("setLotSizeAmg(uint256)");
    bytes32 internal constant SET_COLLATERAL_RATIOS =
        keccak256("setCollateralRatios(uint256,uint256,uint256)");
    bytes32 internal constant EXECUTE_SET_COLLATERAL_RATIOS =
        keccak256("executeSetCollateralRatios()");
    bytes32 internal constant SET_TIME_FOR_PAYMENT =
        keccak256("setTimeForPayment(uint256,uint256)");
    bytes32 internal constant EXECUTE_SET_TIME_FOR_PAYMENT =
        keccak256("executeSetTimeForPayment()");
    bytes32 internal constant SET_PAYMENT_CHALLENGE_REWARD =
        keccak256("setPaymentChallengeReward(uint256,uint256)");
    bytes32 internal constant SET_COLLATERAL_RESERVATION_FEE_BIPS =
        keccak256("setCollateralReservationFeeBips(uint256)");
    bytes32 internal constant SET_REDEMPTION_FEE_BIPS =
        keccak256("setRedemptionFeeBips(uint256)");
    bytes32 internal constant SET_REDEMPTION_FAILURE_FACTOR_BIPS =
        keccak256("setRedemptionFailureFactorBips(uint256)");
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
        
    function validateAndSet(
        AssetManagerState.State storage _state,
        AssetManagerSettings.Settings memory _settings
    )
        external
    {
        _validateSettings(_settings);
        _state.settings = _settings;
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
        } else if (_method == SET_COLLATERAL_RATIOS) {
            _setCollateralRatios(_state, _updates.collateralRatio, _params);
        } else if (_method == EXECUTE_SET_COLLATERAL_RATIOS) {
            _executeSetCollateralRatios(_state, _updates.collateralRatio);
        } else if (_method == SET_TIME_FOR_PAYMENT) {
            _setTimeForPayment(_state, _updates.paymentTime, _params);
        } else if (_method == EXECUTE_SET_TIME_FOR_PAYMENT) {
            _executeSetTimeForPayment(_state, _updates.paymentTime);
        } else if (_method == SET_PAYMENT_CHALLENGE_REWARD) {
            _setPaymentChallengeReward(_state, _params);
        } else if (_method == SET_LOT_SIZE_AMG) {
            _setLotSizeAmg(_state, _params);
        } else if (_method == SET_COLLATERAL_RESERVATION_FEE_BIPS) {
            _setCollateralReservationFeeBips(_state, _params);
        } else if (_method == SET_REDEMPTION_FEE_BIPS) {
            _setRedemptionFeeBips(_state, _params);
        } else if (_method == SET_REDEMPTION_FAILURE_FACTOR_BIPS) {
            _setRedemptionFailureFactorBips(_state, _params);
        } else if (_method == SET_CONFIRMATION_BY_OTHERS_AFTER_SECONDS) {
            _setConfirmationByOthersAfterSeconds(_state, _params);
        } else if (_method == SET_CONFIRMATION_BY_OTHERS_REWARD_NAT_WEI) {
            _setConfirmationByOthersRewardNatWei(_state, _params);
        } else if (_method == SET_MAX_REDEEMED_TICKETS) {
            _setMaxRedeemedTickets(_state, _params);
        } else if (_method == SET_WITHDRAWAL_OR_DESTROY_WAIT_MIN_SECONDS) {
            _setWithdrawalOrDestroyWaitMinSeconds(_state, _params);
        } else if (_method == SET_CCB_TIME_SECONDS) {
            _setCcbTimeSeconds(_state, _params);
        } else if (_method == SET_LIQUIDATION_STEP_SECONDS) {
            _setLiquidationStepSeconds(_state, _params);
        } else if (_method == SET_LIQUIDATION_COLLATERAL_FACTOR_BIPS) {
            _setLiquidationCollateralFactorBips(_state, _params);
        } else {
            revert("update: invalid method");
        }
    }

    function _updateContracts(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        (address controller, IAttestationClient attestationClient, IFtsoRegistry ftsoRegistry, IWNat wNat) =
            abi.decode(_params, (address, IAttestationClient, IFtsoRegistry, IWNat));
        _state.settings.assetManagerController = controller;
        _state.settings.attestationClient = attestationClient;
        _state.settings.ftsoRegistry = ftsoRegistry;
        _state.settings.wNat = wNat;
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
        require(1 < ccbCR && ccbCR < minCR && minCR < safetyCR, "invalid collateral ratios");
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
        _state.settings.paymentChallengeRewardNATWei = SafeCast.toUint128(rewardNATWei);
        _state.settings.paymentChallengeRewardBIPS = SafeCast.toUint16(rewardBIPS);
        emit AMEvents.SettingChanged("paymentChallengeRewardNATWei", rewardNATWei);
        emit AMEvents.SettingChanged("paymentChallengeRewardBIPS", rewardBIPS);
    }

    function _setLotSizeAmg(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        _state.settings.lotSizeAMG = SafeCast.toUint64(value);
        emit AMEvents.SettingChanged("lotSizeAMG", value);
    }

    function _setCollateralReservationFeeBips(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
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
        _state.settings.redemptionFeeBIPS = SafeCast.toUint16(value);
        emit AMEvents.SettingChanged("redemptionFeeBIPS", value);
    }

    function _setRedemptionFailureFactorBips(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
        _state.settings.redemptionFailureFactorBIPS = SafeCast.toUint32(value);
        emit AMEvents.SettingChanged("redemptionFailureFactorBIPS", value);
    }

    function _setConfirmationByOthersAfterSeconds(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256 value = abi.decode(_params, (uint256));
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
        _state.settings.liquidationStepSeconds = SafeCast.toUint64(value);
        emit AMEvents.SettingChanged("liquidationStepSeconds", value);
    }

    function _setLiquidationCollateralFactorBips(
        AssetManagerState.State storage _state,
        bytes calldata _params
    ) 
        private 
    {
        uint256[] memory value = abi.decode(_params, (uint256[]));
        delete _state.settings.liquidationCollateralFactorBIPS;
        for (uint256 i = 0; i < value.length; i++) {
            require(value[i] > SafeBips.MAX_BIPS, "factor not above 1");
            require(i == 0 || value[i] > value[i - 1], "factors not increasing");
            _state.settings.liquidationCollateralFactorBIPS.push(SafeCast.toUint32(value[i]));
        }
        emit AMEvents.SettingArrayChanged("liquidationCollateralFactorBIPS", value);
    }
    
    function _validateSettings(
        AssetManagerSettings.Settings memory _settings
    ) 
        private view
    {
        // TODO: define conditions for validity
    }
}
