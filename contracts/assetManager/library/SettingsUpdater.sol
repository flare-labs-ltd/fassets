// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../fassetToken/interfaces/IITransparentProxy.sol";
import "../../utils/lib/SafePct.sol";
import "./AMEvents.sol";
import "./Globals.sol";
import "./CollateralTypes.sol";
import "./SettingsValidators.sol";

library SettingsUpdater {
    using SafeCast for uint256;
    using SafePct for *;

    struct UpdaterState {
        mapping (bytes32 => uint256) lastUpdate;
    }

    bytes32 internal constant UPDATES_STATE_POSITION = keccak256("fasset.AssetManager.UpdaterState");

    bytes32 internal constant UPDATE_CONTRACTS =
        keccak256("updateContracts(address,IWNat)");
    bytes32 internal constant SET_TIME_FOR_PAYMENT =
        keccak256("setTimeForPayment(uint256,uint256)");
    bytes32 internal constant SET_WHITELIST =
        keccak256("setWhitelist(address)");
    bytes32 internal constant SET_AGENT_OWNER_REGISTRY =
        keccak256("setAgentOwnerRegistry(address)");
    bytes32 internal constant SET_AGENT_VAULT_FACTORY =
        keccak256("setAgentVaultFactory(address)");
    bytes32 internal constant SET_COLLATERAL_POOL_FACTORY =
        keccak256("setCollateralPoolFactory(address)");
    bytes32 internal constant SET_COLLATERAL_POOL_TOKEN_FACTORY =
        keccak256("setCollateralPoolTokenFactory(address)");
    bytes32 internal constant SET_PRICE_READER =
        keccak256("setPriceReader(address)");
    bytes32 internal constant SET_SC_PROOF_VERIFIER =
        keccak256("setSCProofVerifier(address)");
    bytes32 internal constant SET_CLEANER_CONTRACT =
        keccak256("setCleanerContract(address)");
    bytes32 internal constant SET_CLEANUP_BLOCK_NUMBER_MANAGER =
        keccak256("setCleanupBlockNumberManager(address)");
    bytes32 internal constant UPGRADE_FASSET_IMPLEMENTATION =
        keccak256("upgradeFAssetImplementation(address)");
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
    bytes32 internal constant SET_ATTESTATION_WINDOW_SECONDS =
        keccak256("setAttestationWindowSeconds(uint256)");
    bytes32 internal constant SET_AVERAGE_BLOCK_TIME_MS =
        keccak256("setAverageBlockTimeMS(uint256)");
    bytes32 internal constant SET_ANNOUNCED_UNDERLYING_CONFIRMATION_MIN_SECONDS =
        keccak256("setAnnouncedUnderlyingConfirmationMinSeconds(uint256)");
    bytes32 internal constant SET_MINTING_POOL_HOLDINGS_REQUIRED_BIPS =
        keccak256("setMintingPoolHoldingsRequiredBIPS(uint256)");
    bytes32 internal constant SET_MINTING_CAP_AMG =
        keccak256("setMintingCapAMG(uint256)");
    bytes32 internal constant SET_TOKEN_INVALIDATION_TIME_MIN_SECONDS =
        keccak256("setTokenInvalidationTimeMinSeconds(uint256)");
    bytes32 internal constant SET_VAULT_COLLATERAL_BUY_FOR_FLARE_FACTOR_BIPS =
        keccak256("setVaultCollateralBuyForFlareFactorBIPS(uint256)");
    bytes32 internal constant SET_AGENT_EXIT_AVAILABLE_TIMELOCK_SECONDS =
        keccak256("setAgentExitAvailableTimelockSeconds(uint256)");
    bytes32 internal constant SET_AGENT_FEE_CHANGE_TIMELOCK_SECONDS =
        keccak256("setAgentFeeChangeTimelockSeconds(uint256)");
    bytes32 internal constant SET_AGENT_MINTING_CR_CHANGE_TIMELOCK_SECONDS =
        keccak256("setAgentMintingCRChangeTimelockSeconds(uint256)");
    bytes32 internal constant SET_POOL_EXIT_AND_TOPUP_CHANGE_TIMELOCK_SECONDS =
        keccak256("setPoolExitAndTopupChangeTimelockSeconds(uint256)");
    bytes32 internal constant SET_AGENT_SETTING_UPDATE_WINDOW_SECONDS =
        keccak256("setAgentTimelockedOperationWindowSeconds(uint256)");
    bytes32 internal constant SET_COLLATERAL_POOL_TOKEN_TIMELOCK_SECONDS =
        keccak256("setCollateralPoolTokenTimelockSeconds(uint256)");
    bytes32 internal constant SET_LIQUIDATION_STEP_SECONDS =
        keccak256("setLiquidationStepSeconds(uint256)");
    bytes32 internal constant SET_LIQUIDATION_PAYMENT_FACTORS =
        keccak256("setLiquidationPaymentFactors(uint256[],uint256[])");
    bytes32 internal constant SET_EMERGENCY_PAUSE_PARAMETERS =
        keccak256("setEmergencyPauseParameters(uint256,uint256)");
    bytes32 internal constant SET_CANCEL_COLLATERAL_RESERVATION_AFTER_SECONDS =
        keccak256("setCancelCollateralReservationAfterSeconds(uint256)");

    function callUpdate(
        bytes32 _method,
        bytes calldata _params
    )
        internal
    {
        if (_method == UPDATE_CONTRACTS) {
            _updateContracts(_params);
        } else if (_method == SET_TIME_FOR_PAYMENT) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setTimeForPayment(_params);
        } else if (_method == SET_PAYMENT_CHALLENGE_REWARD) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setPaymentChallengeReward(_params);
        } else if (_method == SET_WHITELIST) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setWhitelist(_params);
        } else if (_method == SET_AGENT_OWNER_REGISTRY) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setAgentOwnerRegistry(_params);
        } else if (_method == SET_AGENT_VAULT_FACTORY) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setAgentVaultFactory(_params);
        } else if (_method == SET_COLLATERAL_POOL_FACTORY) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setCollateralPoolFactory(_params);
        } else if (_method == SET_COLLATERAL_POOL_TOKEN_FACTORY) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setCollateralPoolTokenFactory(_params);
        } else if (_method == SET_PRICE_READER) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setPriceReader(_params);
        } else if (_method == SET_SC_PROOF_VERIFIER) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setSCProofVerifier(_params);
        } else if (_method == SET_CLEANER_CONTRACT) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setCleanerContract(_params);
        } else if (_method == SET_CLEANUP_BLOCK_NUMBER_MANAGER) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setCleanupBlockNumberManager(_params);
        } else if (_method == UPGRADE_FASSET_IMPLEMENTATION) {
            checkEnoughTimeSinceLastUpdate(_method);
            _upgradeFAssetImplementation(_params);
        } else if (_method == SET_MIN_UPDATE_REPEAT_TIME_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setMinUpdateRepeatTimeSeconds(_params);
        } else if (_method == SET_LOT_SIZE_AMG) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setLotSizeAmg(_params);
        } else if (_method == SET_MIN_UNDERLYING_BACKING_BIPS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setMinUnderlyingBackingBips(_params);
        } else if (_method == SET_COLLATERAL_RESERVATION_FEE_BIPS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setCollateralReservationFeeBips(_params);
        } else if (_method == SET_REDEMPTION_FEE_BIPS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setRedemptionFeeBips(_params);
        } else if (_method == SET_REDEMPTION_DEFAULT_FACTOR_BIPS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setRedemptionDefaultFactorBips(_params);
        } else if (_method == SET_CONFIRMATION_BY_OTHERS_AFTER_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setConfirmationByOthersAfterSeconds(_params);
        } else if (_method == SET_CONFIRMATION_BY_OTHERS_REWARD_USD5) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setConfirmationByOthersRewardUSD5(_params);
        } else if (_method == SET_MAX_REDEEMED_TICKETS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setMaxRedeemedTickets(_params);
        } else if (_method == SET_WITHDRAWAL_OR_DESTROY_WAIT_MIN_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setWithdrawalOrDestroyWaitMinSeconds(_params);
        } else if (_method == SET_CCB_TIME_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setCcbTimeSeconds(_params);
        } else if (_method == SET_ATTESTATION_WINDOW_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setAttestationWindowSeconds(_params);
        } else if (_method == SET_AVERAGE_BLOCK_TIME_MS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setAverageBlockTimeMS(_params);
        } else if (_method == SET_MAX_TRUSTED_PRICE_AGE_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setMaxTrustedPriceAgeSeconds(_params);
        } else if (_method == SET_ANNOUNCED_UNDERLYING_CONFIRMATION_MIN_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setAnnouncedUnderlyingConfirmationMinSeconds(_params);
        } else if (_method == SET_MINTING_POOL_HOLDINGS_REQUIRED_BIPS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setMintingPoolHoldingsRequiredBIPS(_params);
        } else if (_method == SET_MINTING_CAP_AMG) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setMintingCapAMG(_params);
        } else if (_method == SET_TOKEN_INVALIDATION_TIME_MIN_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setTokenInvalidationTimeMinSeconds(_params);
        } else if (_method == SET_VAULT_COLLATERAL_BUY_FOR_FLARE_FACTOR_BIPS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setVaultCollateralBuyForFlareFactorBIPS(_params);
        } else if (_method == SET_AGENT_EXIT_AVAILABLE_TIMELOCK_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setAgentExitAvailableTimelockSeconds(_params);
        } else if (_method == SET_AGENT_FEE_CHANGE_TIMELOCK_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setAgentFeeChangeTimelockSeconds(_params);
        } else if (_method == SET_AGENT_MINTING_CR_CHANGE_TIMELOCK_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setAgentMintingCRChangeTimelockSeconds(_params);
        } else if (_method == SET_POOL_EXIT_AND_TOPUP_CHANGE_TIMELOCK_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setPoolExitAndTopupChangeTimelockSeconds(_params);
        } else if (_method == SET_AGENT_SETTING_UPDATE_WINDOW_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setAgentTimelockedOperationWindowSeconds(_params);
        } else if (_method == SET_COLLATERAL_POOL_TOKEN_TIMELOCK_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setCollateralPoolTokenTimelockSeconds(_params);
        } else if (_method == SET_LIQUIDATION_STEP_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setLiquidationStepSeconds(_params);
        } else if (_method == SET_LIQUIDATION_PAYMENT_FACTORS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setLiquidationPaymentFactors(_params);
        } else if (_method == SET_EMERGENCY_PAUSE_PARAMETERS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setEmergencyPauseParameters(_params);
        } else if (_method == SET_CANCEL_COLLATERAL_RESERVATION_AFTER_SECONDS) {
            checkEnoughTimeSinceLastUpdate(_method);
            _setCancelCollateralReservationAfterSeconds(_params);
        } else {
            revert("update: invalid method");
        }
    }

    function checkEnoughTimeSinceLastUpdate(
        bytes32 _method
    )
        internal
    {
        UpdaterState storage _state = _getUpdaterState();
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 lastUpdate = _state.lastUpdate[_method];
        require(lastUpdate == 0 || block.timestamp >= lastUpdate + settings.minUpdateRepeatTimeSeconds,
            "too close to previous update");
        _state.lastUpdate[_method] = block.timestamp;
    }

    function _getUpdaterState() private pure returns (UpdaterState storage _state) {
        // Only direct constants are allowed in inline assembly, so we assign it here
        bytes32 position = UPDATES_STATE_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _state.slot := position
        }
    }

    function _updateContracts(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();

        (address controller, IWNat wNat) = abi.decode(_params, (address, IWNat));

        if (settings.assetManagerController != controller) {
            settings.assetManagerController = controller;
            emit AMEvents.ContractChanged("assetManagerController", address(controller));
        }

        IWNat oldWNat = Globals.getWNat();
        if (oldWNat != wNat) {
            CollateralType.Data memory data = CollateralTypes.getInfo(CollateralType.Class.POOL, oldWNat);
            data.validUntil = 0;
            data.token = wNat;
            CollateralTypes.setPoolWNatCollateralType(data);
            emit AMEvents.ContractChanged("wNat", address(wNat));
        }
    }

    function _setTimeForPayment(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        (uint256 underlyingBlocks, uint256 underlyingSeconds) =
            abi.decode(_params, (uint256, uint256));
        // validate
        require(underlyingSeconds > 0, "cannot be zero");
        require(underlyingBlocks > 0, "cannot be zero");
        SettingsValidators.validateTimeForPayment(underlyingBlocks, underlyingSeconds, settings.averageBlockTimeMS);
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        address value = abi.decode(_params, (address));
        // validate
        // update
        settings.whitelist = value;
        emit AMEvents.ContractChanged("whitelist", value);
    }

    function _setAgentOwnerRegistry(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        address value = abi.decode(_params, (address));
        // validate
        require(value != address(0), "address zero");
        // update
        settings.agentOwnerRegistry = value;
        emit AMEvents.ContractChanged("agentOwnerRegistry", value);
    }

    function _setAgentVaultFactory(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        address value = abi.decode(_params, (address));
        // validate
        require(value != address(0), "address zero");
        // update
        settings.agentVaultFactory = value;
        emit AMEvents.ContractChanged("agentVaultFactory", value);
    }

    function _setCollateralPoolFactory(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        address value = abi.decode(_params, (address));
        // validate
        require(value != address(0), "address zero");
        // update
        settings.collateralPoolFactory = value;
        emit AMEvents.ContractChanged("collateralPoolFactory", value);
    }

    function _setCollateralPoolTokenFactory(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        address value = abi.decode(_params, (address));
        // validate
        require(value != address(0), "address zero");
        // update
        settings.collateralPoolTokenFactory = value;
        emit AMEvents.ContractChanged("collateralPoolTokenFactory", value);
    }

    function _setPriceReader(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        address value = abi.decode(_params, (address));
        // validate
        require(value != address(0), "address zero");
        // update
        settings.priceReader = value;
        emit AMEvents.ContractChanged("priceReader", value);
    }

    function _setSCProofVerifier(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        address value = abi.decode(_params, (address));
        // validate
        require(value != address(0), "address zero");
        // update
        settings.scProofVerifier = value;
        emit AMEvents.ContractChanged("scProofVerifier", value);
    }

    function _setCleanerContract(
        bytes calldata _params
    )
        private
    {
        address value = abi.decode(_params, (address));
        // validate
        // update
        Globals.getFAsset().setCleanerContract(value);
        emit AMEvents.ContractChanged("cleanerContract", value);
    }

    function _setCleanupBlockNumberManager(
        bytes calldata _params
    )
        private
    {
        address value = abi.decode(_params, (address));
        // validate
        // update
        Globals.getFAsset().setCleanupBlockNumberManager(value);
        emit AMEvents.ContractChanged("cleanupBlockNumberManager", value);
    }

    function _upgradeFAssetImplementation(
        bytes calldata _params
    )
        private
    {
        (address value, bytes memory callData) = abi.decode(_params, (address, bytes));
        // validate
        require(value != address(0), "address zero");
        // update
        IITransparentProxy(address(Globals.getFAsset())).upgradeToAndCall(value, callData);
        emit AMEvents.ContractChanged("fAsset", value);
    }

    function _setMinUpdateRepeatTimeSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        // huge lot size increase is very dangerous, because it breaks redemption
        // (converts all tickets to dust)
        require(value > 0, "cannot be zero");
        require(value <= settings.lotSizeAMG * 4, "lot size increase too big");
        require(value >= settings.lotSizeAMG / 4, "lot size decrease too big");
        require(settings.mintingCapAMG == 0 || settings.mintingCapAMG >= value,
            "lot size bigger than minting cap");
        // update
        settings.lotSizeAMG = value.toUint64();
        emit AMEvents.SettingChanged("lotSizeAMG", value);
    }

    function _setMinUnderlyingBackingBips(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        (uint256 vaultF, uint256 poolF) = abi.decode(_params, (uint256, uint256));
        // validate
        require(vaultF + poolF > SafePct.MAX_BIPS, "bips value too low");
        require(vaultF <= settings.redemptionDefaultFactorVaultCollateralBIPS.mulBips(12000), "fee increase too big");
        require(vaultF >= settings.redemptionDefaultFactorVaultCollateralBIPS.mulBips(8333), "fee decrease too big");
        require(poolF <= settings.redemptionDefaultFactorPoolBIPS.mulBips(12000), "fee increase too big");
        require(poolF >= settings.redemptionDefaultFactorPoolBIPS.mulBips(8333), "fee decrease too big");
        // update
        settings.redemptionDefaultFactorVaultCollateralBIPS = vaultF.toUint32();
        emit AMEvents.SettingChanged("redemptionDefaultFactorVaultCollateralBIPS", vaultF);
        settings.redemptionDefaultFactorPoolBIPS = poolF.toUint32();
        emit AMEvents.SettingChanged("redemptionDefaultFactorPoolBIPS", poolF);
    }

    function _setConfirmationByOthersAfterSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value >= 1 days, "window too small");
        // update
        settings.attestationWindowSeconds = value.toUint64();
        emit AMEvents.SettingChanged("attestationWindowSeconds", value);
    }

    function _setAverageBlockTimeMS(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value > 0, "cannot be zero");
        require(value <= settings.averageBlockTimeMS * 2, "increase too big");
        require(value >= settings.averageBlockTimeMS / 2, "decrease too big");
        // update
        settings.averageBlockTimeMS = value.toUint32();
        emit AMEvents.SettingChanged("averageBlockTimeMS", value);
    }

    function _setAnnouncedUnderlyingConfirmationMinSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value == 0 || value >= settings.lotSizeAMG, "value too small");
        // update
        settings.mintingCapAMG = value.toUint64();
        emit AMEvents.SettingChanged("mintingCapAMG", value);
    }

    function _setTokenInvalidationTimeMinSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        // update
        settings.tokenInvalidationTimeMinSeconds = value.toUint64();
        emit AMEvents.SettingChanged("tokenInvalidationTimeMinSeconds", value);
    }

    function _setVaultCollateralBuyForFlareFactorBIPS(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value >= SafePct.MAX_BIPS, "value too small");
        // update
        settings.vaultCollateralBuyForFlareFactorBIPS = value.toUint32();
        emit AMEvents.SettingChanged("vaultCollateralBuyForFlareFactorBIPS", value);
    }

    function _setAgentExitAvailableTimelockSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= settings.agentFeeChangeTimelockSeconds * 4 + 1 days);
        // update
        settings.agentFeeChangeTimelockSeconds = value.toUint64();
        emit AMEvents.SettingChanged("agentFeeChangeTimelockSeconds", value);
    }

    function _setAgentMintingCRChangeTimelockSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= settings.agentMintingCRChangeTimelockSeconds * 4 + 1 days);
        // update
        settings.agentMintingCRChangeTimelockSeconds = value.toUint64();
        emit AMEvents.SettingChanged("agentMintingCRChangeTimelockSeconds", value);
    }

    function _setPoolExitAndTopupChangeTimelockSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value <= settings.poolExitAndTopupChangeTimelockSeconds * 4 + 1 days);
        // update
        settings.poolExitAndTopupChangeTimelockSeconds = value.toUint64();
        emit AMEvents.SettingChanged("poolExitAndTopupChangeTimelockSeconds", value);
    }

    function _setAgentTimelockedOperationWindowSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value >= 1 minutes, "value too small");
        // update
        settings.agentTimelockedOperationWindowSeconds = value.toUint64();
        emit AMEvents.SettingChanged("agentTimelockedOperationWindowSeconds", value);
    }

    function _setCollateralPoolTokenTimelockSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value >= 1 minutes, "value too small");
        // update
        settings.collateralPoolTokenTimelockSeconds = value.toUint32();
        emit AMEvents.SettingChanged("collateralPoolTokenTimelockSeconds", value);
    }

    function _setLiquidationStepSeconds(bytes calldata _params) private {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 stepSeconds = abi.decode(_params, (uint256));
        // validate
        require(stepSeconds > 0, "cannot be zero");
        require(stepSeconds <= settings.liquidationStepSeconds * 2, "increase too big");
        require(stepSeconds >= settings.liquidationStepSeconds / 2, "decrease too big");
        // update
        settings.liquidationStepSeconds = stepSeconds.toUint64();
        emit AMEvents.SettingChanged("liquidationStepSeconds", stepSeconds);
    }

    function _setLiquidationPaymentFactors(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        (uint256[] memory liquidationFactors, uint256[] memory vaultCollateralFactors) =
            abi.decode(_params, (uint256[], uint256[]));
        // validate
        SettingsValidators.validateLiquidationFactors(liquidationFactors, vaultCollateralFactors);
        // update
        delete settings.liquidationCollateralFactorBIPS;
        delete settings.liquidationFactorVaultCollateralBIPS;
        for (uint256 i = 0; i < liquidationFactors.length; i++) {
            settings.liquidationCollateralFactorBIPS.push(liquidationFactors[i].toUint32());
            settings.liquidationFactorVaultCollateralBIPS.push(vaultCollateralFactors[i].toUint32());
        }
        // emit events
        emit AMEvents.SettingArrayChanged("liquidationCollateralFactorBIPS", liquidationFactors);
        emit AMEvents.SettingArrayChanged("liquidationFactorVaultCollateralBIPS", vaultCollateralFactors);
    }

    function _setEmergencyPauseParameters(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        (uint256 maxEmergencyPauseDurationSeconds, uint256 emergencyPauseDurationResetAfterSeconds) =
            abi.decode(_params, (uint256, uint256));
        // validate
        require(maxEmergencyPauseDurationSeconds > 0, "cannot be zero");
        require(maxEmergencyPauseDurationSeconds <= settings.maxEmergencyPauseDurationSeconds * 4,
            "increase too big");
        require(maxEmergencyPauseDurationSeconds >= settings.maxEmergencyPauseDurationSeconds / 4,
            "decrease too big");
        require(emergencyPauseDurationResetAfterSeconds > 0, "cannot be zero");
        require(emergencyPauseDurationResetAfterSeconds <= settings.emergencyPauseDurationResetAfterSeconds * 4,
            "increase too big");
        require(emergencyPauseDurationResetAfterSeconds >= settings.emergencyPauseDurationResetAfterSeconds / 4,
            "decrease too big");
        // update
        settings.maxEmergencyPauseDurationSeconds = maxEmergencyPauseDurationSeconds.toUint64();
        settings.emergencyPauseDurationResetAfterSeconds = emergencyPauseDurationResetAfterSeconds.toUint64();
        // emit events
        emit AMEvents.SettingChanged("maxEmergencyPauseDurationSeconds",
            maxEmergencyPauseDurationSeconds);
        emit AMEvents.SettingChanged("emergencyPauseDurationResetAfterSeconds",
            emergencyPauseDurationResetAfterSeconds);
    }

    function _setCancelCollateralReservationAfterSeconds(
        bytes calldata _params
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 value = abi.decode(_params, (uint256));
        // validate
        require(value > 0, "value too small");
        // update
        settings.cancelCollateralReservationAfterSeconds = value.toUint64();
        emit AMEvents.SettingChanged("cancelCollateralReservationAfterSeconds", value);
    }
}
