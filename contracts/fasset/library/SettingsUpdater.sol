// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./AMEvents.sol";
import "./AssetManagerState.sol";
import "./TransactionAttestation.sol";


library SettingsUpdater {
    struct PendingUpdates {
        // collateral changes
        uint64 collateralRatiosValidAt;
        uint32 minCollateralRatioBIPS;
        uint32 ccbMinCollateralRatioBIPS;
        uint32 safetyMinCollateralRatioBIPS;
    }
    
    bytes32 internal constant UPDATE_CONTRACTS = 
        keccak256("updateContracts(IAttestationClient,IFtsoRegistry,IWNat)");
    bytes32 internal constant SET_LOT_SIZE_AMG =
        keccak256("setLotSizeAmg(uint256)");
    bytes32 internal constant SET_COLLATERAL_RATIOS =
        keccak256("setCollateralRatios(uint256,uint256,uint256)");
    bytes32 internal constant EXECUTE_SET_COLLATERAL_RATIOS =
        keccak256("executeSetCollateralRatios(uint256,uint256,uint256)");
    bytes32 internal constant SET_TIME_FOR_PAYMENT =
        keccak256("setTimeForPayment(uint256,uint256)");
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
            (address controller, IAttestationClient attestationClient, IFtsoRegistry ftsoRegistry, IWNat wNat) =
                abi.decode(_params, (address, IAttestationClient, IFtsoRegistry, IWNat));
            _updateContracts(_state, controller, attestationClient, ftsoRegistry, wNat);
        } else if (_method == SET_COLLATERAL_RATIOS) {
            (uint256 minCR, uint256 ccbCR, uint256 safetyCR) = abi.decode(_params, (uint256, uint256, uint256));
            _setCollateralRatios(_state, _updates, minCR, ccbCR, safetyCR);
        } else if (_method == EXECUTE_SET_COLLATERAL_RATIOS) {
            _executeSetCollateralRatios(_state, _updates);
        } else if (_method == SET_TIME_FOR_PAYMENT) {
            (uint256 underlyingBlocks, uint256 underlyingSeconds) = abi.decode(_params, (uint256, uint256));
            _state.settings.underlyingBlocksForPayment = SafeCast.toUint64(underlyingBlocks);
            _state.settings.underlyingSecondsForPayment = SafeCast.toUint64(underlyingSeconds);
        } else if (_method == SET_PAYMENT_CHALLENGE_REWARD) {
            (uint256 rewardNATWei, uint256 rewardBIPS) = abi.decode(_params, (uint256, uint256));
            _state.settings.paymentChallengeRewardNATWei = SafeCast.toUint128(rewardNATWei);
            _state.settings.paymentChallengeRewardBIPS = SafeCast.toUint16(rewardBIPS);
        } else if (_method == SET_LOT_SIZE_AMG) {
            uint256 value = abi.decode(_params, (uint256));
            _state.settings.lotSizeAMG = SafeCast.toUint64(value);
        } else if (_method == SET_COLLATERAL_RESERVATION_FEE_BIPS) {
            uint256 value = abi.decode(_params, (uint256));
            _state.settings.collateralReservationFeeBIPS = SafeCast.toUint16(value);
        } else if (_method == SET_REDEMPTION_FEE_BIPS) {
            uint256 value = abi.decode(_params, (uint256));
            _state.settings.redemptionFeeBIPS = SafeCast.toUint16(value);
        } else if (_method == SET_REDEMPTION_FAILURE_FACTOR_BIPS) {
            uint256 value = abi.decode(_params, (uint256));
            _state.settings.redemptionFailureFactorBIPS = SafeCast.toUint32(value);
        } else if (_method == SET_CONFIRMATION_BY_OTHERS_AFTER_SECONDS) {
            uint256 value = abi.decode(_params, (uint256));
            _state.settings.confirmationByOthersAfterSeconds = SafeCast.toUint64(value);
        } else if (_method == SET_CONFIRMATION_BY_OTHERS_REWARD_NAT_WEI) {
            uint256 value = abi.decode(_params, (uint256));
            _state.settings.confirmationByOthersRewardNATWei = SafeCast.toUint128(value);
        } else if (_method == SET_MAX_REDEEMED_TICKETS) {
            uint256 value = abi.decode(_params, (uint256));
            _state.settings.maxRedeemedTickets = SafeCast.toUint16(value);
        } else if (_method == SET_WITHDRAWAL_OR_DESTROY_WAIT_MIN_SECONDS) {
            uint256 value = abi.decode(_params, (uint256));
            _state.settings.withdrawalWaitMinSeconds = SafeCast.toUint64(value);
        } else if (_method == SET_CCB_TIME_SECONDS) {
            uint256 value = abi.decode(_params, (uint256));
            _state.settings.ccbTimeSeconds = SafeCast.toUint64(value);
        } else if (_method == SET_LIQUIDATION_STEP_SECONDS) {
            uint256 value = abi.decode(_params, (uint256));
            _state.settings.liquidationStepSeconds = SafeCast.toUint64(value);
        } else if (_method == SET_LIQUIDATION_COLLATERAL_FACTOR_BIPS) {
            uint256[] memory value = abi.decode(_params, (uint256[]));
            delete _state.settings.liquidationCollateralFactorBIPS;
            for (uint256 i = 0; i < value.length; i++) {
                require(value[i] > SafeBips.MAX_BIPS, "factor below 1");
                require(i == 0 || value[i] > value[i - 1], "factors not increasing");
                _state.settings.liquidationCollateralFactorBIPS.push(SafeCast.toUint32(value[i]));
            }
        } else {
            revert("update: invalid method");
        }
    }

    function _updateContracts(
        AssetManagerState.State storage _state,
        address assetManagerController,
        IAttestationClient attestationClient, 
        IFtsoRegistry ftsoRegistry, 
        IWNat wNat
    ) 
        private 
    {
        _state.settings.assetManagerController = assetManagerController;
        _state.settings.attestationClient = attestationClient;
        _state.settings.ftsoRegistry = ftsoRegistry;
        _state.settings.wNat = wNat;
    }

    function _setCollateralRatios(
        AssetManagerState.State storage _state,
        PendingUpdates storage _updates,
        uint256 minCR, 
        uint256 ccbCR, 
        uint256 safetyCR
    ) 
        private 
    {
        require(1 < ccbCR && ccbCR < minCR && minCR < safetyCR, "invalid collateral ratios");
        uint256 collateralRatiosValidAt = block.timestamp + _state.settings.timelockSeconds;
        _updates.collateralRatiosValidAt = SafeCast.toUint64(collateralRatiosValidAt);
        _updates.minCollateralRatioBIPS = SafeCast.toUint32(minCR);
        _updates.ccbMinCollateralRatioBIPS = SafeCast.toUint32(ccbCR);
        _updates.safetyMinCollateralRatioBIPS = SafeCast.toUint32(safetyCR);
        emit AMEvents.SettingChanged("minCollateralRatioBIPS", minCR, collateralRatiosValidAt);
        emit AMEvents.SettingChanged("ccbMinCollateralRatioBIPS", ccbCR, collateralRatiosValidAt);
        emit AMEvents.SettingChanged("safetyMinCollateralRatioBIPS", safetyCR, collateralRatiosValidAt);
    }

    function _executeSetCollateralRatios(
        AssetManagerState.State storage _state,
        PendingUpdates storage _updates
    ) 
        private 
    {
        require(_updates.collateralRatiosValidAt != 0 && block.timestamp >= _updates.collateralRatiosValidAt,
            "update not valid yet");
        _state.settings.minCollateralRatioBIPS = _updates.minCollateralRatioBIPS;
        _state.settings.ccbMinCollateralRatioBIPS = _updates.ccbMinCollateralRatioBIPS;
        _state.settings.safetyMinCollateralRatioBIPS = _updates.safetyMinCollateralRatioBIPS;
        _updates.collateralRatiosValidAt = 0;
        emit AMEvents.SettingChanged("minCollateralRatioBIPS", _updates.minCollateralRatioBIPS, 
            block.timestamp);
        emit AMEvents.SettingChanged("ccbMinCollateralRatioBIPS", _updates.ccbMinCollateralRatioBIPS, 
            block.timestamp);
        emit AMEvents.SettingChanged("safetyMinCollateralRatioBIPS", _updates.safetyMinCollateralRatioBIPS, 
            block.timestamp);
    }
    
    function _validateSettings(
        AssetManagerSettings.Settings memory _settings
    ) 
        private view
    {
        // TODO: define conditions for validity
    }
}
