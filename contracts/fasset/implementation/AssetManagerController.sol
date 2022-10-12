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
    
    modifier onlyUpdateExecutor {
        require(_isExecutor(msg.sender), "only update executor");
        _;
    }    
    
    constructor(IGovernanceSettings _governanceSettings, address _initialGovernance, address _addressUpdater)
        Governed(_governanceSettings, _initialGovernance)
        AddressUpdatable(_addressUpdater)
    {
    }
    
    function addAssetManager(IAssetManager _assetManager) 
        external 
        onlyImmediateGovernance
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
        onlyImmediateGovernance
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
    function refreshFtsoIndexes(IAssetManager[] memory _assetManagers)
        external
        onlyUpdateExecutor
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.REFRESH_FTSO_INDEXES, abi.encode());
    }

    function setWhitelist(IAssetManager[] memory _assetManagers, address _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_WHITELIST, abi.encode(_value));
    }

    function executeSetWhitelist(
        IAssetManager[] memory _assetManagers
    )
        external
        onlyUpdateExecutor
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.EXECUTE_SET_WHITELIST, abi.encode());
    }

    function setLotSizeAmg(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_LOT_SIZE_AMG, abi.encode(_value));
    }

    function setCollateralRatios(
        IAssetManager[] memory _assetManagers, 
        uint256 _minCollateralRatioBIPS,
        uint256 _ccbMinCollateralRatioBIPS,
        uint256 _safetyMinCollateralRatioBIPS
    )
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_COLLATERAL_RATIOS, 
            abi.encode(_minCollateralRatioBIPS, _ccbMinCollateralRatioBIPS, _safetyMinCollateralRatioBIPS));
    }

    function executeSetCollateralRatios(
        IAssetManager[] memory _assetManagers
    )
        external
        onlyUpdateExecutor
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.EXECUTE_SET_COLLATERAL_RATIOS, abi.encode());
    }

    function setTimeForPayment(
        IAssetManager[] memory _assetManagers, 
        uint256 _underlyingBlocks,
        uint256 _underlyingSeconds
    )
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_TIME_FOR_PAYMENT, abi.encode(_underlyingBlocks, _underlyingSeconds));
    }

    function executeSetTimeForPayment(
        IAssetManager[] memory _assetManagers
    )
        external
        onlyUpdateExecutor
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.EXECUTE_SET_TIME_FOR_PAYMENT, abi.encode());
    }

    function setPaymentChallengeReward(
        IAssetManager[] memory _assetManagers, 
        uint256 _rewardNATWei,
        uint256 _rewardBIPS
    )
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_PAYMENT_CHALLENGE_REWARD, abi.encode(_rewardNATWei, _rewardBIPS));
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

    function setRedemptionDefaultFactorBips(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_REDEMPTION_DEFAULT_FACTOR_BIPS, abi.encode(_value));
    }

    function setConfirmationByOthersAfterSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_CONFIRMATION_BY_OTHERS_AFTER_SECONDS, abi.encode(_value));
    }

    function setConfirmationByOthersRewardNatWei(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_CONFIRMATION_BY_OTHERS_REWARD_NAT_WEI, abi.encode(_value));
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

    function setLiquidationStepSeconds(IAssetManager[] memory _assetManagers, uint256 _value)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_LIQUIDATION_STEP_SECONDS, abi.encode(_value));
    }
    
    function setLiquidationCollateralFactorBips(IAssetManager[] memory _assetManagers, uint256[] memory _values)
        external
        onlyImmediateGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_LIQUIDATION_COLLATERAL_FACTOR_BIPS, abi.encode(_values));
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
        IAgentVaultFactory agentVaultFactory =
            IAgentVaultFactory(_getContractAddress(_contractNameHashes, _contractAddresses, "AgentVaultFactory"));
        IAttestationClient attestationClient = 
            IAttestationClient(_getContractAddress(_contractNameHashes, _contractAddresses, "AttestationClient"));
        IFtsoRegistry ftsoRegistry =
            IFtsoRegistry(_getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRegistry"));
        IWNat wNat = 
            IWNat(_getContractAddress(_contractNameHashes, _contractAddresses, "WNat"));
        for (uint256 i = 0; i < assetManagers.length; i++) {
            IAssetManager assetManager = assetManagers[i];
            assetManager.updateSettings(
                SettingsUpdater.UPDATE_CONTRACTS, 
                abi.encode(assetManagerController, agentVaultFactory, attestationClient, ftsoRegistry, wNat));
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
}
