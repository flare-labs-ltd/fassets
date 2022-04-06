// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol";
import "../interface/IWNat.sol";
import "../../generated/interface/IAttestationClient.sol";
import "../../governance/implementation/Governed.sol";
import "../../governance/implementation/AddressUpdatable.sol";
import "./AssetManager.sol";
import "../library/AssetManagerSettings.sol";
import "../library/SettingsUpdater.sol";

contract AssetManagerController is Governed, AddressUpdatable {
    mapping(address => uint256) private assetManagerIndex;
    AssetManager[] private assetManagers;
    
    constructor(address _governance, address _addressUpdater)
        Governed(_governance)
        AddressUpdatable(_addressUpdater)
    {
    }
    
    function addAssetManager(AssetManager _assetManager) 
        external 
        onlyGovernance
    {
        if (assetManagerIndex[address(_assetManager)] != 0) return;
        assetManagers.push(_assetManager);
        assetManagerIndex[address(_assetManager)] = assetManagers.length;  // 1+index, so that 0 means empty
    }
    
    function getAssetManagers()
        external view
        returns (AssetManager[] memory)
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
    
    function setLotSizeAmg(address[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_LOT_SIZE_AMG, abi.encode(_value));
    }

    function setCollateralRatios(
        address[] memory _assetManagers, 
        uint256 _minCollateralRatioBIPS,
        uint256 _ccbMinCollateralRatioBIPS,
        uint256 _safetyMinCollateralRatioBIPS
    )
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_COLLATERAL_RATIOS, 
            abi.encode(_minCollateralRatioBIPS, _ccbMinCollateralRatioBIPS, _safetyMinCollateralRatioBIPS));
    }

    function executeSetCollateralRatios(
        address[] memory _assetManagers
    )
        external
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.EXECUTE_SET_COLLATERAL_RATIOS, abi.encode());
    }

    function setTimeForPayment(
        address[] memory _assetManagers, 
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
        address[] memory _assetManagers, 
        uint256 _rewardNATWei,
        uint256 _rewardBIPS
    )
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_PAYMENT_CHALLENGE_REWARD, abi.encode(_rewardNATWei, _rewardBIPS));
    }

    function setMaxTrustedPriceAgeSeconds(address[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_MAX_TRUSTED_PRICE_AGE_SECONDS, abi.encode(_value));
    }

    function setCollateralReservationFeeBips(address[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_COLLATERAL_RESERVATION_FEE_BIPS, abi.encode(_value));
    }

    function setRedemptionFeeBips(address[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_REDEMPTION_FEE_BIPS, abi.encode(_value));
    }

    function setRedemptionDefaultFactorBips(address[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_REDEMPTION_DEFAULT_FACTOR_BIPS, abi.encode(_value));
    }

    function setConfirmationByOthersAfterSeconds(address[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_CONFIRMATION_BY_OTHERS_AFTER_SECONDS, abi.encode(_value));
    }

    function setConfirmationByOthersRewardNatWei(address[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_CONFIRMATION_BY_OTHERS_REWARD_NAT_WEI, abi.encode(_value));
    }

    function setMaxRedeemedTickets(address[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_MAX_REDEEMED_TICKETS, abi.encode(_value));
    }

    function setWithdrawalOrDestroyWaitMinSeconds(address[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_WITHDRAWAL_OR_DESTROY_WAIT_MIN_SECONDS, abi.encode(_value));
    }

    function setCcbTimeSeconds(address[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_CCB_TIME_SECONDS, abi.encode(_value));
    }

    function setLiquidationStepSeconds(address[] memory _assetManagers, uint256 _value)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_LIQUIDATION_STEP_SECONDS, abi.encode(_value));
    }
    
    function setLiquidationCollateralFactorBips(address[] memory _assetManagers, uint256[] memory _values)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_LIQUIDATION_COLLATERAL_FACTOR_BIPS, abi.encode(_values));
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
        IWNat wNat = 
            IWNat(_getContractAddress(_contractNameHashes, _contractAddresses, "WNat"));
        for (uint256 i = 0; i < assetManagers.length; i++) {
            AssetManager assetManager = assetManagers[i];
            assetManager.updateSettings(
                SettingsUpdater.UPDATE_CONTRACTS, 
                abi.encode(assetManagerController, attestationClient, ftsoRegistry, wNat));
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Helpers

    function _setValueOnManagers(
        address[] memory _assetManagers,
        bytes32 _method,
        bytes memory _value
    )
        private
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            AssetManager assetManager = AssetManager(_assetManagers[i]);
            require(assetManagerIndex[address(assetManager)] != 0, "Asset manager not managed");
            assetManager.updateSettings(_method, _value);
        }
    }

    function _setValueOnManager(
        address _assetManager,
        bytes32 _method,
        bytes memory _value
    )
        private
    {
        require(assetManagerIndex[_assetManager] != 0, "Asset manager not managed");
        AssetManager assetManager = AssetManager(_assetManager);
        assetManager.updateSettings(_method, _value);
    }
}
