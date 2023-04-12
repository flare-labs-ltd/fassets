// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./LiquidationStrategy.sol";

library SettingsUpdater {
    using SafeCast for uint256;
    using SafePct for *;

    struct UpdaterState {
        mapping (bytes32 => uint256) lastUpdate;
    }

    bytes32 internal constant UPDATES_STATE_POSITION = keccak256("fasset.AssetManager.UpdaterState");

    bytes32 internal constant UPDATE_CONTRACTS =
        keccak256("updateContracts(address,IAttestationClient,IFtsoRegistry)");
    bytes32 internal constant SET_TIME_FOR_PAYMENT =
        keccak256("setTimeForPayment(uint256,uint256)");
    bytes32 internal constant SET_WHITELIST =
        keccak256("setWhitelist(address)");
    bytes32 internal constant SET_AGENT_WHITELIST =
        keccak256("setAgentWhitelist(address)");
    bytes32 internal constant SET_AGENT_VAULT_FACTORY =
        keccak256("setAgentVaultFactory(address)");
    bytes32 internal constant SET_COLLATERAL_POOL_FACTORY =
        keccak256("setCollateralPoolFactory(address)");
    bytes32 internal constant SET_UNDERLYING_ADDRESS_VALIDATOR =
        keccak256("setUnderlyingAddressValidator(address)");
    bytes32 internal constant SET_MIN_UPDATE_REPEAT_TIME_SECONDS =
        keccak256("setMinUpdateRepeatTimeSeconds(uint256)");
    bytes32 internal constant SET_LOT_SIZE_AMG =
        keccak256("setLotSizeAmg(uint256)");
    bytes32 internal constant SET_MIN_UNDERLYING_BACKING_BIPS =
        keccak256("setMinUnderlyingBackingBips(uint256)");
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
    bytes32 internal constant SET_CONFIRMATION_BY_OTHERS_REWARD_USD5 =
        keccak256("setConfirmationByOthersRewardUSD5(uint256)");
    bytes32 internal constant SET_MAX_REDEEMED_TICKETS =
        keccak256("setMaxRedeemedTickets(uint256)");
    bytes32 internal constant SET_WITHDRAWAL_OR_DESTROY_WAIT_MIN_SECONDS =
        keccak256("setWithdrawalOrDestroyWaitMinSeconds(uint256)");
    bytes32 internal constant SET_CCB_TIME_SECONDS =
        keccak256("setCcbTimeSeconds(uint256)");
    bytes32 internal constant SET_LIQUIDATION_STRATEGY =
        keccak256("setLiquidationStrategy(address,bytes)");
    bytes32 internal constant UPDATE_LIQUIDATION_STRATEGY_SETTINGS =
        keccak256("updateLiquidationStrategySettings(bytes)");
    bytes32 internal constant SET_ATTESTATION_WINDOW_SECONDS =
        keccak256("setAttestationWindowSeconds(uint256)");
    bytes32 internal constant SET_ANNOUNCED_UNDERLYING_CONFIRMATION_MIN_SECONDS =
        keccak256("setAnnouncedUnderlyingConfirmationMinSeconds(uint256)");
    bytes32 internal constant SET_MINTING_POOL_HOLDINGS_REQUIRED_BIPS =
        keccak256("setMintingPoolHoldingsRequiredBIPS((uint256)");
    bytes32 internal constant SET_MINTING_CAP_AMG =
        keccak256("setMintingCapAMG((uint256)");
    bytes32 internal constant SET_TOKEN_INVALIDATION_TIME_MIN_SECONDS =
        keccak256("setTokenInvalidationTimeMinSeconds((uint256)");
    bytes32 internal constant SET_CLASS1_BUY_FOR_FLARE_FACTOR_BIPS =
        keccak256("setClass1BuyForFlareFactorBIPS((uint256)");
    bytes32 internal constant SET_AGENT_EXIT_AVAILABLE_TIMELOCK_SECONDS =
        keccak256("setAgentExitAvailableTimelockSeconds((uint256)");
    bytes32 internal constant SET_AGENT_FEE_CHANGE_TIMELOCK_SECONDS =
        keccak256("setAgentFeeChangeTimelockSeconds((uint256)");
    bytes32 internal constant SET_AGENT_COLLATERAL_RATIO_CHANGE_TIMELOCK_SECONDS =
        keccak256("setAgentCollateralRatioChangeTimelockSeconds((uint256)");

    function validateAndSet(
        AssetManagerSettings.Data memory _settings
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        _validateSettings(_settings);
        state.settings = _settings;
    }

    function callUpdate(
        bytes32 _method,
        bytes calldata _params
    )
        external
    {
        if (_method == UPDATE_CONTRACTS) {
            _updateContracts(_params);
        } else if (_method == SET_TIME_FOR_PAYMENT) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setTimeForPayment(_params);
        } else if (_method == SET_PAYMENT_CHALLENGE_REWARD) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setPaymentChallengeReward(_params);
        } else if (_method == SET_WHITELIST) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setWhitelist(_params);
        } else if (_method == SET_AGENT_WHITELIST) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setAgentWhitelist(_params);
        } else if (_method == SET_AGENT_VAULT_FACTORY) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setAgentVaultFactory(_params);
        } else if (_method == SET_COLLATERAL_POOL_FACTORY) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setCollateralPoolFactory(_params);
        } else if (_method == SET_UNDERLYING_ADDRESS_VALIDATOR) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setUnderlyingAddressValidator(_params);
        } else if (_method == SET_MIN_UPDATE_REPEAT_TIME_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setMinUpdateRepeatTimeSeconds(_params);
        } else if (_method == SET_LOT_SIZE_AMG) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setLotSizeAmg(_params);
        } else if (_method == SET_MIN_UNDERLYING_BACKING_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setMinUnderlyingBackingBips(_params);
        } else if (_method == SET_COLLATERAL_RESERVATION_FEE_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setCollateralReservationFeeBips(_params);
        } else if (_method == SET_REDEMPTION_FEE_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setRedemptionFeeBips(_params);
        } else if (_method == SET_REDEMPTION_DEFAULT_FACTOR_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setRedemptionDefaultFactorBips(_params);
        } else if (_method == SET_CONFIRMATION_BY_OTHERS_AFTER_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setConfirmationByOthersAfterSeconds(_params);
        } else if (_method == SET_CONFIRMATION_BY_OTHERS_REWARD_USD5) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setConfirmationByOthersRewardUSD5(_params);
        } else if (_method == SET_MAX_REDEEMED_TICKETS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setMaxRedeemedTickets(_params);
        } else if (_method == SET_WITHDRAWAL_OR_DESTROY_WAIT_MIN_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setWithdrawalOrDestroyWaitMinSeconds(_params);
        } else if (_method == SET_CCB_TIME_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setCcbTimeSeconds(_params);
        } else if (_method == SET_LIQUIDATION_STRATEGY) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setLiquidationStrategy(_params);
        } else if (_method == UPDATE_LIQUIDATION_STRATEGY_SETTINGS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _updateLiquidationStrategySettings(_params);
        } else if (_method == SET_ATTESTATION_WINDOW_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setAttestationWindowSeconds(_params);
        } else if (_method == SET_MAX_TRUSTED_PRICE_AGE_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setMaxTrustedPriceAgeSeconds(_params);
        } else if (_method == SET_ANNOUNCED_UNDERLYING_CONFIRMATION_MIN_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setAnnouncedUnderlyingConfirmationMinSeconds(_params);
        } else if (_method == SET_MINTING_POOL_HOLDINGS_REQUIRED_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setMintingPoolHoldingsRequiredBIPS(_params);
        } else if (_method == SET_MINTING_CAP_AMG) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setMintingCapAMG(_params);
        } else if (_method == SET_TOKEN_INVALIDATION_TIME_MIN_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setTokenInvalidationTimeMinSeconds(_params);
        } else if (_method == SET_CLASS1_BUY_FOR_FLARE_FACTOR_BIPS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setClass1BuyForFlareFactorBIPS(_params);
        } else if (_method == SET_AGENT_EXIT_AVAILABLE_TIMELOCK_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setAgentExitAvailableTimelockSeconds(_params);
        } else if (_method == SET_AGENT_FEE_CHANGE_TIMELOCK_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setAgentFeeChangeTimelockSeconds(_params);
        } else if (_method == SET_AGENT_COLLATERAL_RATIO_CHANGE_TIMELOCK_SECONDS) {
            _checkEnoughTimeSinceLastUpdate(_method);
            _setAgentCollateralRatioChangeTimelockSeconds(_params);
        } else {
            revert("update: invalid method");
        }
    }

    function _getUpdaterState() private pure returns (UpdaterState storage _state) {
        // Only direct constants are allowed in inline assembly, so we assign it here
        bytes32 position = UPDATES_STATE_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _state.slot := position
        }
    }

    function _checkEnoughTimeSinceLastUpdate(
        bytes32 _method
    )
        private
    {
        UpdaterState storage _state = _getUpdaterState();
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 lastUpdate = _state.lastUpdate[_method];
        require(lastUpdate == 0 || block.timestamp >= lastUpdate + settings.minUpdateRepeatTimeSeconds,
            "too close to previous update");
        _state.lastUpdate[_method] = block.timestamp;
    }

    function _updateContracts(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();

        (address controller, IAttestationClient attestationClient, IFtsoRegistry ftsoRegistry) =
            abi.decode(_params, (address, IAttestationClient, IFtsoRegistry));

        if (settings.assetManagerController != controller) {
            settings.assetManagerController = controller;
            emit AMEvents.ContractChanged("assetManagerController", address(controller));
        }
        if (settings.attestationClient != attestationClient) {
            settings.attestationClient = attestationClient;
            emit AMEvents.ContractChanged("attestationClient", address(attestationClient));
        }
        if (settings.ftsoRegistry != ftsoRegistry) {
            settings.ftsoRegistry = ftsoRegistry;
            emit AMEvents.ContractChanged("ftsoRegistry", address(ftsoRegistry));
        }
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
        require(rewardNATWei <= (settings.paymentChallengeRewardUSD5 * 4) + 100 ether, "increase too big");
        require(rewardNATWei >= (settings.paymentChallengeRewardUSD5) / 4, "decrease too big");
        require(rewardBIPS <= (settings.paymentChallengeRewardBIPS * 4) + 100, "increase too big");
        require(rewardBIPS >= (settings.paymentChallengeRewardBIPS) / 4, "decrease too big");
        // update
        settings.paymentChallengeRewardUSD5 = rewardNATWei.toUint128();
        settings.paymentChallengeRewardBIPS = rewardBIPS.toUint16();
        emit AMEvents.SettingChanged("paymentChallengeRewardUSD5", rewardNATWei);
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

    function _setAgentWhitelist(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        address value = abi.decode(_params, (address));
        // validate
        // update
        settings.agentWhitelist = IWhitelist(value);
        emit AMEvents.ContractChanged("agentWhitelist", value);
    }

    function _setAgentVaultFactory(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        address value = abi.decode(_params, (address));
        // validate
        require(value != address(0), "address zero");
        // update
        settings.agentVaultFactory = IAgentVaultFactory(value);
        emit AMEvents.ContractChanged("agentVaultFactory", value);
    }

    function _setCollateralPoolFactory(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        address value = abi.decode(_params, (address));
        // validate
        require(value != address(0), "address zero");
        // update
        settings.collateralPoolFactory = ICollateralPoolFactory(value);
        emit AMEvents.ContractChanged("collateralPoolFactory", value);
    }

    function _setUnderlyingAddressValidator(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        address value = abi.decode(_params, (address));
        // validate
        require(value != address(0), "address zero");
        // update
        settings.underlyingAddressValidator = IAddressValidator(value);
        emit AMEvents.ContractChanged("underlyingAddressValidator", value);
    }

    function _setMinUpdateRepeatTimeSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value > 0, "cannot be zero");
        // update
        settings.minUpdateRepeatTimeSeconds = value.toUint64();
        emit AMEvents.SettingChanged("minUpdateRepeatTimeSeconds", value);
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
        require(value <= settings.lotSizeAMG * 4, "lot size increase too big");
        require(value >= settings.lotSizeAMG / 4, "lot size decrease too big");
        // update
        settings.lotSizeAMG = value.toUint64();
        emit AMEvents.SettingChanged("lotSizeAMG", value);
    }

    function _setMinUnderlyingBackingBips(
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
        require(value <= SafePct.MAX_BIPS, "must be below 1");
        require(value <= settings.minUnderlyingBackingBIPS * 2, "increase too big");
        require(value >= settings.minUnderlyingBackingBIPS / 2, "decrease too big");
        // update
        settings.minUnderlyingBackingBIPS = value.toUint16();
        emit AMEvents.SettingChanged("minUnderlyingBackingBIPS", value);
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

    function _setConfirmationByOthersRewardUSD5(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value > 0, "cannot be zero");
        require(value <= settings.confirmationByOthersRewardUSD5 * 4, "fee increase too big");
        require(value >= settings.confirmationByOthersRewardUSD5 / 4, "fee decrease too big");
        // update
        settings.confirmationByOthersRewardUSD5 = value.toUint128();
        emit AMEvents.SettingChanged("confirmationByOthersRewardUSD5", value);
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

    function _setMintingPoolHoldingsRequiredBIPS(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= settings.mintingPoolHoldingsRequiredBIPS * 4 + SafePct.MAX_BIPS, "value too big");
        // update
        settings.mintingPoolHoldingsRequiredBIPS = value.toUint32();
        emit AMEvents.SettingChanged("mintingPoolHoldingsRequiredBIPS", value);
    }

    function _setMintingCapAMG(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        // update
        settings.mintingCapAMG = value.toUint64();
        emit AMEvents.SettingChanged("mintingCapAMG", value);
    }

    function _setTokenInvalidationTimeMinSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        // update
        settings.tokenInvalidationTimeMinSeconds = value.toUint64();
        emit AMEvents.SettingChanged("tokenInvalidationTimeMinSeconds", value);
    }

    function _setClass1BuyForFlareFactorBIPS(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value >= SafePct.MAX_BIPS, "value too small");
        // update
        settings.class1BuyForFlareFactorBIPS = value.toUint32();
        emit AMEvents.SettingChanged("class1BuyForFlareFactorBIPS", value);
    }

    function _setAgentExitAvailableTimelockSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= settings.agentExitAvailableTimelockSeconds * 4 + 1 weeks);
        // update
        settings.agentExitAvailableTimelockSeconds = value.toUint64();
        emit AMEvents.SettingChanged("agentExitAvailableTimelockSeconds", value);
    }

    function _setAgentFeeChangeTimelockSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= settings.agentFeeChangeTimelockSeconds * 4 + 1 weeks);
        // update
        settings.agentFeeChangeTimelockSeconds = value.toUint64();
        emit AMEvents.SettingChanged("agentFeeChangeTimelockSeconds", value);
    }

    function _setAgentCollateralRatioChangeTimelockSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= settings.agentCollateralRatioChangeTimelockSeconds * 4 + 1 weeks);
        // update
        settings.agentCollateralRatioChangeTimelockSeconds = value.toUint64();
        emit AMEvents.SettingChanged("agentCollateralRatioChangeTimelockSeconds", value);
    }

    function _setLiquidationStrategy(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        (address liquidationStrategy, bytes memory initialSettings) = abi.decode(_params, (address, bytes));
        // validate
        require(liquidationStrategy != address(0), "address zero");
        // update contract
        settings.liquidationStrategy = liquidationStrategy;
        emit AMEvents.ContractChanged("liquidationStrategy", liquidationStrategy);
        // initialize
        LiquidationStrategy.initialize(initialSettings);
    }

    function _updateLiquidationStrategySettings(
        bytes calldata _params
    )
        private
    {
        // just pass to LiquidationStrategy.updateSettings, it will do the decoding and validation
        LiquidationStrategy.updateSettings(_params);
    }

    function _validateSettings(
        AssetManagerSettings.Data memory _settings
    )
        private pure
    {
        require(address(_settings.fAsset) != address(0), "zero fAsset address");
        require(address(_settings.agentVaultFactory) != address(0), "zero agentVaultFactory address");
        require(address(_settings.collateralPoolFactory) != address(0), "zero collateralPoolFactory address");
        require(address(_settings.attestationClient) != address(0), "zero attestationClient address");
        require(address(_settings.underlyingAddressValidator) != address(0),
            "zero underlyingAddressValidator address");
        require(address(_settings.ftsoRegistry) != address(0), "zero ftsoRegistry address");
        require(address(_settings.liquidationStrategy) != address(0), "zero liquidationStrategy address");

        require(_settings.assetUnitUBA > 0, "cannot be zero");
        require(_settings.assetMintingGranularityUBA > 0, "cannot be zero");
        require(_settings.underlyingBlocksForPayment > 0, "cannot be zero");
        require(_settings.underlyingSecondsForPayment > 0, "cannot be zero");
        require(_settings.redemptionFeeBIPS > 0, "cannot be zero");
        require(_settings.collateralReservationFeeBIPS > 0, "cannot be zero");
        require(_settings.confirmationByOthersRewardUSD5 > 0, "cannot be zero");
        require(_settings.maxRedeemedTickets > 0, "cannot be zero");
        require(_settings.ccbTimeSeconds > 0, "cannot be zero");
        require(_settings.maxTrustedPriceAgeSeconds > 0, "cannot be zero");
        require(_settings.minUpdateRepeatTimeSeconds > 0, "cannot be zero");
        require(_settings.buybackCollateralFactorBIPS > 0, "cannot be zero");
        require(_settings.withdrawalWaitMinSeconds > 0, "cannot be zero");
        require(_settings.lotSizeAMG > 0, "cannot be zero");
        require(_settings.minUnderlyingBackingBIPS > 0, "cannot be zero");
        require(_settings.minUnderlyingBackingBIPS <= SafePct.MAX_BIPS, "bips value too high");
        require(_settings.collateralReservationFeeBIPS <= SafePct.MAX_BIPS, "bips value too high");
        require(_settings.redemptionFeeBIPS <= SafePct.MAX_BIPS, "bips value too high");
        uint256 redemptionFactorBIPS =
            _settings.redemptionDefaultFactorAgentC1BIPS + _settings.redemptionDefaultFactorPoolBIPS;
        require(redemptionFactorBIPS > SafePct.MAX_BIPS, "bips value too low");
        require(_settings.attestationWindowSeconds >= 1 days, "window too small");
        require(_settings.confirmationByOthersAfterSeconds >= 2 hours, "must be at least two hours");
        require(_settings.announcedUnderlyingConfirmationMinSeconds <= 1 hours, "confirmation time too big");
        require(_settings.class1BuyForFlareFactorBIPS >= SafePct.MAX_BIPS, "value too small");
    }
}
