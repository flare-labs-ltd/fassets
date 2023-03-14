// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol";
import "../interface/IWNat.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAssetManagerEvents.sol";
import "../../generated/interface/IAttestationClient.sol";
import "../../governance/implementation/Governed.sol";
import "../../governance/implementation/AddressUpdatable.sol";
import "../library/SettingsUpdater.sol";

contract AssetManagerController is Governed, AddressUpdatable, IAssetManagerEvents {
    // New address in case this controller was replaced.
    // Note: this code contains no checks that replacedBy==0, because when replaced,
    // all calls to AssetManager's updateSettings/pause/terminate will fail anyway
    // since they will arrive from wrong controller address.
    address public replacedBy;

    mapping(address => uint256) private assetManagerIndex;
    IAssetManager[] private assetManagers;

    modifier onlyGovernanceOrExecutor {
        _checkOnlyGovernanceOrExecutor();
        _;
    }

    constructor(IGovernanceSettings _governanceSettings, address _initialGovernance, address _addressUpdater)
        Governed(_governanceSettings, _initialGovernance)
        AddressUpdatable(_addressUpdater)
    {
    }

    function addAssetManager(IAssetManager _assetManager)
        external
        onlyGovernance
    {
        if (assetManagerIndex[address(_assetManager)] != 0) return;
        assetManagers.push(_assetManager);
        assetManagerIndex[address(_assetManager)] = assetManagers.length;  // 1+index, so that 0 means empty
        // have to check, otherwise it fails when the controller is replaced
        if (_assetManager.assetManagerController() == address(this)) {
            _assetManager.attachController(true);
        }
    }

    function removeAssetManager(IAssetManager _assetManager)
        external
        onlyGovernance
    {
        uint256 position = assetManagerIndex[address(_assetManager)];
        if (position == 0) return;
        uint256 index = position - 1;   // the real index, can be 0
        uint256 lastIndex = assetManagers.length - 1;
        if (index < lastIndex) {
            assetManagers[index] = assetManagers[lastIndex];
            assetManagerIndex[address(assetManagers[index])] = index + 1;
        }
        assetManagers.pop();
        assetManagerIndex[address(_assetManager)] = 0;
        // have to check, otherwise it fails when the controller is replaced
        if (_assetManager.assetManagerController() == address(this)) {
            _assetManager.attachController(false);
        }
    }

    function getAssetManagers()
        external view
        returns (IAssetManager[] memory)
    {
        return assetManagers;
    }

    function assetManagerExists(address _assetManager)
        external view
        returns (bool)
    {
        return assetManagerIndex[_assetManager] != 0;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Setters

    // this is a safe operation, executor can call without prior governance call
    function refreshAllFtsoIndexes(IAssetManager[] memory _assetManagers)
        external
        onlyGovernanceOrExecutor
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.REFRESH_ALL_FTSO_INDEXES, abi.encode());
    }

    // this is a safe operation, executor can call without prior governance call
    function refreshFtsoIndexes(IAssetManager[] memory _assetManagers, uint256 _start, uint256 _end)
        external
        onlyGovernanceOrExecutor
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.REFRESH_FTSO_INDEXES, abi.encode(_start, _end));
    }

    function setWhitelist(IAssetManager[] memory _assetManagers, address _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_WHITELIST, abi.encode(_value));
    }

    function setAgentVaultFactory(IAssetManager[] memory _assetManagers, address _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_AGENT_VAULT_FACTORY, abi.encode(_value));
    }

    function setCollateralPoolFactory(IAssetManager[] memory _assetManagers, address _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_COLLATERAL_POOL_FACTORY, abi.encode(_value));
    }

    function setUnderlyingAddressValidator(IAssetManager[] memory _assetManagers, address _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_UNDERLYING_ADDRESS_VALIDATOR, abi.encode(_value));
    }

    function setMinUpdateRepeatTimeSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_MIN_UPDATE_REPEAT_TIME_SECONDS, abi.encode(_value));
    }

    function setLotSizeAmg(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_LOT_SIZE_AMG, abi.encode(_value));
    }

    function setTimeForPayment(
        IAssetManager[] memory _assetManagers,
        uint256 _underlyingBlocks,
        uint256 _underlyingSeconds
    )
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_TIME_FOR_PAYMENT, abi.encode(_underlyingBlocks, _underlyingSeconds));
    }

    function setPaymentChallengeReward(
        IAssetManager[] memory _assetManagers,
        uint256 _rewardClass1Wei,
        uint256 _rewardBIPS
    )
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_PAYMENT_CHALLENGE_REWARD, abi.encode(_rewardClass1Wei, _rewardBIPS));
    }

    function setMaxTrustedPriceAgeSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_MAX_TRUSTED_PRICE_AGE_SECONDS, abi.encode(_value));
    }

    function setCollateralReservationFeeBips(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_COLLATERAL_RESERVATION_FEE_BIPS, abi.encode(_value));
    }

    function setRedemptionFeeBips(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_REDEMPTION_FEE_BIPS, abi.encode(_value));
    }

    function setRedemptionDefaultFactorBips(IAssetManager[] memory _assetManagers, uint256 _class1, uint256 _pool)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_REDEMPTION_DEFAULT_FACTOR_BIPS, abi.encode(_class1, _pool));
    }

    function setConfirmationByOthersAfterSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_CONFIRMATION_BY_OTHERS_AFTER_SECONDS, abi.encode(_value));
    }

    function setConfirmationByOthersRewardUSD5(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_CONFIRMATION_BY_OTHERS_REWARD_USD5, abi.encode(_value));
    }

    function setMaxRedeemedTickets(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_MAX_REDEEMED_TICKETS, abi.encode(_value));
    }

    function setWithdrawalOrDestroyWaitMinSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_WITHDRAWAL_OR_DESTROY_WAIT_MIN_SECONDS, abi.encode(_value));
    }

    function setCcbTimeSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_CCB_TIME_SECONDS, abi.encode(_value));
    }

    function setAttestationWindowSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_ATTESTATION_WINDOW_SECONDS, abi.encode(_value));
    }

    function setAnnouncedUnderlyingConfirmationMinSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_ANNOUNCED_UNDERLYING_CONFIRMATION_MIN_SECONDS, abi.encode(_value));
    }

    function setMintingPoolHoldingsRequiredBIPS(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_MINTING_POOL_HOLDINGS_REQUIRED_BIPS, abi.encode(_value));
    }

    function setMintingCapAmg(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_MINTING_CAP_AMG, abi.encode(_value));
    }

    function setTokenInvalidationTimeMinSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_TOKEN_INVALIDATION_TIME_MIN_SECONDS, abi.encode(_value));
    }

    function setClass1BuyForFlareFactorBIPS(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_CLASS1_BUY_FOR_FLARE_FACTOR_BIPS, abi.encode(_value));
    }

    function setAgentExitAvailableTimelockSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_AGENT_EXIT_AVAILABLE_TIMELOCK_SECONDS, abi.encode(_value));
    }

    function setAgentFeeChangeTimelockSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_AGENT_FEE_CHANGE_TIMELOCK_SECONDS, abi.encode(_value));
    }

    function setAgentCollateralRatioChangeTimelockSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_AGENT_COLLATERAL_RATIO_CHANGE_TIMELOCK_SECONDS, abi.encode(_value));
    }

    function setLiquidationStrategy(
        IAssetManager[] memory _assetManagers,
        address _liquidationStrategy,
        bytes memory _encodedInitialSettings
    )
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_LIQUIDATION_STRATEGY, abi.encode(_liquidationStrategy, _encodedInitialSettings));
    }

    function updateLiquidationStrategySettings(
        IAssetManager[] memory _assetManagers,
        bytes memory _encodedSettings
    )
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.UPDATE_LIQUIDATION_STRATEGY_SETTINGS, abi.encode(_encodedSettings));
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Collateral tokens

    function addCollateralToken(
        IAssetManager[] memory _assetManagers,
        IAssetManager.CollateralTokenInfo calldata _data
    )
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _checkAssetManager(_assetManagers[i]).addCollateralToken(_data);
        }
    }

    function setCollateralRatiosForToken(
        IAssetManager[] memory _assetManagers,
        IAssetManager.CollateralTokenClass _tokenClass,
        IERC20 _token,
        uint256 _minCollateralRatioBIPS,
        uint256 _ccbMinCollateralRatioBIPS,
        uint256 _safetyMinCollateralRatioBIPS
    )
        external
        onlyGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _checkAssetManager(_assetManagers[i]).setCollateralRatiosForToken(_tokenClass, _token,
                _minCollateralRatioBIPS, _ccbMinCollateralRatioBIPS, _safetyMinCollateralRatioBIPS);
        }
    }

    function deprecateCollateralToken(
        IAssetManager[] memory _assetManagers,
        IAssetManager.CollateralTokenClass _tokenClass,
        IERC20 _token,
        uint256 _invalidationTimeSec
    )
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _checkAssetManager(_assetManagers[i]).deprecateCollateralToken(_tokenClass, _token, _invalidationTimeSec);
        }
    }

    function setPoolCollateralToken(
        IAssetManager[] memory _assetManagers,
        IAssetManager.CollateralTokenInfo calldata _data
    )
        external
        onlyGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _checkAssetManager(_assetManagers[i]).setPoolCollateralToken(_data);
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Upgrade (second phase)

    /**
     * When asset manager is paused, no new minting can be made.
     * All other operations continue normally.
     */
    function pause(IAssetManager[] calldata _assetManagers)
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _assetManagers[i].pause();
        }
    }

    /**
     * If f-asset was not terminated yet, minting can continue.
     */
    function unpause(IAssetManager[] calldata _assetManagers)
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _assetManagers[i].unpause();
        }
    }

    /**
     * When f-asset is terminated, no transfers can be made anymore.
     * This is an extreme measure to be used only when the asset manager minting has been already paused
     * for a long time but there still exist unredeemable f-assets. In such case, the f-asset contract is
     * terminated and then agents can buy back the collateral at market rate (i.e. they burn market value
     * of backed f-assets in collateral to release the rest of the collateral).
     */
    function terminate(IAssetManager[] calldata _assetManagers)
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _assetManagers[i].terminate();
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Update contracts

    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        address assetManagerController =
            _getContractAddress(_contractNameHashes, _contractAddresses, "AssetManagerController");
        IAttestationClient attestationClient =
            IAttestationClient(_getContractAddress(_contractNameHashes, _contractAddresses, "AttestationClient"));
        IFtsoRegistry ftsoRegistry =
            IFtsoRegistry(_getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRegistry"));
        for (uint256 i = 0; i < assetManagers.length; i++) {
            IAssetManager assetManager = assetManagers[i];
            assetManager.updateSettings(
                SettingsUpdater.UPDATE_CONTRACTS,
                abi.encode(assetManagerController, attestationClient, ftsoRegistry));
        }
        // if this controller was replaced, set forwarding address
        if (assetManagerController != address(this)) {
            replacedBy = assetManagerController;
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Helpers

    function _setValueOnManagers(
        IAssetManager[] memory _assetManagers,
        bytes32 _method,
        bytes memory _value
    )
        private
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            IAssetManager assetManager = _assetManagers[i];
            require(assetManagerIndex[address(assetManager)] != 0, "Asset manager not managed");
            assetManager.updateSettings(_method, _value);
        }
    }

    function _checkOnlyGovernanceOrExecutor() private view {
        require(msg.sender == governance() || isExecutor(msg.sender), "only governance or executor");
    }

    function _checkAssetManager(IAssetManager _assetManager) private view returns (IAssetManager) {
        require(assetManagerIndex[address(_assetManager)] != 0, "Asset manager not managed");
        return _assetManager;
    }
}
