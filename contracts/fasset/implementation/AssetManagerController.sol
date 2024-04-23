// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "flare-smart-contracts/contracts/addressUpdater/interface/IIAddressUpdater.sol";
import "../interfaces/IWNat.sol";
import "../interfaces/IIAssetManager.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";
import "../../governance/implementation/Governed.sol";
import "../../governance/implementation/AddressUpdatable.sol";
import "../library/SettingsUpdater.sol";


contract AssetManagerController is Governed, AddressUpdatable, IAssetManagerEvents, IERC165 {
    // New address in case this controller was replaced.
    // Note: this code contains no checks that replacedBy==0, because when replaced,
    // all calls to AssetManager's updateSettings/pause/terminate will fail anyway
    // since they will arrive from wrong controller address.
    address public replacedBy;

    mapping(address => uint256) private assetManagerIndex;
    IIAssetManager[] private assetManagers;

    constructor(IGovernanceSettings _governanceSettings, address _initialGovernance, address _addressUpdater)
        Governed(_governanceSettings, _initialGovernance)
        AddressUpdatable(_addressUpdater)
    {
    }

    /**
     * Add an asset manager to this controller. The asset manager controller address in the settings of the
     * asset manager must match this. This method automatically marks the asset manager as attached.
     */
    function addAssetManager(IIAssetManager _assetManager)
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

    /**
     * Remove an asset manager from this controller, if it is attached to this controller.
     * The asset manager won't be attached any more, so it will be unusable.
     */
    function removeAssetManager(IIAssetManager _assetManager)
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
        returns (IIAssetManager[] memory)
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

    function setWhitelist(IIAssetManager[] memory _assetManagers, address _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_WHITELIST, abi.encode(_value));
    }

    function setAgentOwnerRegistry(IIAssetManager[] memory _assetManagers, address _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_AGENT_OWNER_REGISTRY, abi.encode(_value));
    }

    function setAgentVaultFactory(IIAssetManager[] memory _assetManagers, address _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_AGENT_VAULT_FACTORY, abi.encode(_value));
    }

    function setCollateralPoolFactory(IIAssetManager[] memory _assetManagers, address _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_COLLATERAL_POOL_FACTORY, abi.encode(_value));
    }

    function setCollateralPoolTokenFactory(IIAssetManager[] memory _assetManagers, address _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_COLLATERAL_POOL_TOKEN_FACTORY, abi.encode(_value));
    }

    function setPriceReader(IIAssetManager[] memory _assetManagers, address _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_PRICE_READER, abi.encode(_value));
    }

    function setSCProofVerifier(IIAssetManager[] memory _assetManagers, address _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_SC_PROOF_VERIFIER, abi.encode(_value));
    }

    function setMinUpdateRepeatTimeSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_MIN_UPDATE_REPEAT_TIME_SECONDS, abi.encode(_value));
    }

    function setLotSizeAmg(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_LOT_SIZE_AMG, abi.encode(_value));
    }

    function setMinUnderlyingBackingBips(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_MIN_UNDERLYING_BACKING_BIPS, abi.encode(_value));
    }

    function setTimeForPayment(
        IIAssetManager[] memory _assetManagers,
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
        IIAssetManager[] memory _assetManagers,
        uint256 _rewardVaultCollateralWei,
        uint256 _rewardBIPS
    )
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_PAYMENT_CHALLENGE_REWARD, abi.encode(_rewardVaultCollateralWei, _rewardBIPS));
    }

    function setMaxTrustedPriceAgeSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_MAX_TRUSTED_PRICE_AGE_SECONDS, abi.encode(_value));
    }

    function setCollateralReservationFeeBips(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_COLLATERAL_RESERVATION_FEE_BIPS, abi.encode(_value));
    }

    function setRedemptionFeeBips(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_REDEMPTION_FEE_BIPS, abi.encode(_value));
    }

    function setRedemptionDefaultFactorBips(IIAssetManager[] memory _assetManagers, uint256 _vaultF, uint256 _poolF)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_REDEMPTION_DEFAULT_FACTOR_BIPS, abi.encode(_vaultF, _poolF));
    }

    function setConfirmationByOthersAfterSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_CONFIRMATION_BY_OTHERS_AFTER_SECONDS, abi.encode(_value));
    }

    function setConfirmationByOthersRewardUSD5(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_CONFIRMATION_BY_OTHERS_REWARD_USD5, abi.encode(_value));
    }

    function setMaxRedeemedTickets(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_MAX_REDEEMED_TICKETS, abi.encode(_value));
    }

    function setWithdrawalOrDestroyWaitMinSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_WITHDRAWAL_OR_DESTROY_WAIT_MIN_SECONDS, abi.encode(_value));
    }

    function setCcbTimeSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_CCB_TIME_SECONDS, abi.encode(_value));
    }

    function setAttestationWindowSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_ATTESTATION_WINDOW_SECONDS, abi.encode(_value));
    }

    function setAverageBlockTimeMS(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_AVERAGE_BLOCK_TIME_MS, abi.encode(_value));
    }

    function setAnnouncedUnderlyingConfirmationMinSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_ANNOUNCED_UNDERLYING_CONFIRMATION_MIN_SECONDS, abi.encode(_value));
    }

    function setMintingPoolHoldingsRequiredBIPS(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_MINTING_POOL_HOLDINGS_REQUIRED_BIPS, abi.encode(_value));
    }

    function setMintingCapAmg(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_MINTING_CAP_AMG, abi.encode(_value));
    }

    function setTokenInvalidationTimeMinSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_TOKEN_INVALIDATION_TIME_MIN_SECONDS, abi.encode(_value));
    }

    function setVaultCollateralBuyForFlareFactorBIPS(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_VAULT_COLLATERAL_BUY_FOR_FLARE_FACTOR_BIPS, abi.encode(_value));
    }

    function setAgentExitAvailableTimelockSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_AGENT_EXIT_AVAILABLE_TIMELOCK_SECONDS, abi.encode(_value));
    }

    function setAgentFeeChangeTimelockSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_AGENT_FEE_CHANGE_TIMELOCK_SECONDS, abi.encode(_value));
    }

    function setAgentMintingCRChangeTimelockSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_AGENT_MINTING_CR_CHANGE_TIMELOCK_SECONDS, abi.encode(_value));
    }

    function setPoolExitAndTopupChangeTimelockSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_POOL_EXIT_AND_TOPUP_CHANGE_TIMELOCK_SECONDS, abi.encode(_value));
    }

    function setAgentTimelockedOperationWindowSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_AGENT_SETTING_UPDATE_WINDOW_SECONDS, abi.encode(_value));
    }

    function setCollateralPoolTokenTimelockSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_COLLATERAL_POOL_TOKEN_TIMELOCK_SECONDS, abi.encode(_value));
    }

    function setLiquidationStepSeconds(IIAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_LIQUIDATION_STEP_SECONDS, abi.encode(_value));
    }

    function setLiquidationPaymentFactors(
        IIAssetManager[] memory _assetManagers,
        uint256[] memory _paymentFactors,
        uint256[] memory _vaultCollateralFactors
    )
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers,
            SettingsUpdater.SET_LIQUIDATION_PAYMENT_FACTORS, abi.encode(_paymentFactors, _vaultCollateralFactors));
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Collateral tokens

    function addCollateralType(
        IIAssetManager[] memory _assetManagers,
        CollateralType.Data calldata _data
    )
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _checkAssetManager(_assetManagers[i]).addCollateralType(_data);
        }
    }

    function setCollateralRatiosForToken(
        IIAssetManager[] memory _assetManagers,
        CollateralType.Class _class,
        IERC20 _token,
        uint256 _minCollateralRatioBIPS,
        uint256 _ccbMinCollateralRatioBIPS,
        uint256 _safetyMinCollateralRatioBIPS
    )
        external
        onlyGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _checkAssetManager(_assetManagers[i]).setCollateralRatiosForToken(_class, _token,
                _minCollateralRatioBIPS, _ccbMinCollateralRatioBIPS, _safetyMinCollateralRatioBIPS);
        }
    }

    function deprecateCollateralType(
        IIAssetManager[] memory _assetManagers,
        CollateralType.Class _class,
        IERC20 _token,
        uint256 _invalidationTimeSec
    )
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _checkAssetManager(_assetManagers[i]).deprecateCollateralType(_class, _token, _invalidationTimeSec);
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Upgrade (second phase)

    /**
     * When asset manager is paused, no new minting can be made.
     * All other operations continue normally.
     */
    function pause(IIAssetManager[] calldata _assetManagers)
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _checkAssetManager(_assetManagers[i]).pause();
        }
    }

    /**
     * If f-asset was not terminated yet, minting can continue.
     */
    function unpause(IIAssetManager[] calldata _assetManagers)
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _checkAssetManager(_assetManagers[i]).unpause();
        }
    }

    /**
     * When f-asset is terminated, no transfers can be made anymore.
     * This is an extreme measure to be used only when the asset manager minting has been already paused
     * for a long time but there still exist unredeemable f-assets. In such case, the f-asset contract is
     * terminated and then agents can buy back the collateral at market rate (i.e. they burn market value
     * of backed f-assets in collateral to release the rest of the collateral).
     */
    function terminate(IIAssetManager[] calldata _assetManagers)
        external
        onlyImmediateGovernance
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _checkAssetManager(_assetManagers[i]).terminate();
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // ERC 165

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IIAddressUpdatable).interfaceId;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Update contracts

    /**
     * Can be called to update address updater managed contracts if there are too many asset managers
     * to update in one block. In such a case, running AddressUpdater.updateContractAddresses will fail
     * and there will be no way to update contracts. This method allow the update to only change some
     * of the asset managers.
     */
    function updateContracts(IIAssetManager[] calldata _assetManagers)
        external
    {
        // read contract addresses
        IIAddressUpdater addressUpdater = IIAddressUpdater(getAddressUpdater());
        address newAddressUpdater = addressUpdater.getContractAddress("AddressUpdater");
        address assetManagerController = addressUpdater.getContractAddress("AssetManagerController");
        address wNat = addressUpdater.getContractAddress("WNat");
        require(newAddressUpdater != address(0) && assetManagerController != address(0)
                && wNat != address(0), "address zero");
        // update address updater if necessary
        if (newAddressUpdater != address(addressUpdater)) {
            setAddressUpdaterValue(newAddressUpdater);
        }
        // update contracts on asset managers
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            IIAssetManager assetManager = _checkAssetManager(_assetManagers[i]);
            assetManager.updateSettings(
                SettingsUpdater.UPDATE_CONTRACTS,
                abi.encode(assetManagerController, wNat));
        }
        // if this controller was replaced, set forwarding address
        if (assetManagerController != address(this)) {
            replacedBy = assetManagerController;
        }
    }

    // called by AddressUpdater.update or AddressUpdater.updateContractAddresses
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        address assetManagerController =
            _getContractAddress(_contractNameHashes, _contractAddresses, "AssetManagerController");
        address wNat =
            _getContractAddress(_contractNameHashes, _contractAddresses, "WNat");
        for (uint256 i = 0; i < assetManagers.length; i++) {
            IIAssetManager assetManager = assetManagers[i];
            assetManager.updateSettings(
                SettingsUpdater.UPDATE_CONTRACTS,
                abi.encode(assetManagerController, wNat));
        }
        // if this controller was replaced, set forwarding address
        if (assetManagerController != address(this)) {
            replacedBy = assetManagerController;
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Helpers

    function _setValueOnManagers(
        IIAssetManager[] memory _assetManagers,
        bytes32 _method,
        bytes memory _value
    )
        private
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            IIAssetManager assetManager = _assetManagers[i];
            require(assetManagerIndex[address(assetManager)] != 0, "Asset manager not managed");
            assetManager.updateSettings(_method, _value);
        }
    }

    function _checkAssetManager(IIAssetManager _assetManager) private view returns (IIAssetManager) {
        require(assetManagerIndex[address(_assetManager)] != 0, "Asset manager not managed");
        return _assetManager;
    }
}
