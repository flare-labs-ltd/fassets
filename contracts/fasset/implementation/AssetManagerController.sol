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

contract AssetManagerController is Governed, AddressUpdatable {
    mapping(address => uint256) private assetManagerIndex;
    AssetManager[] private assetManagers;
    
    constructor(address _governance, address _addressUpdater)
        Governed(_governance)
        AddressUpdatable(_addressUpdater)
    {
    }
    
    function addAssetManager(AssetManager _am) 
        external 
        onlyGovernance
    {
        if (assetManagerIndex[address(_am)] != 0) return;
        assetManagers.push(_am);
        assetManagerIndex[address(_am)] = assetManagers.length;  // 1+index, so that 0 means empty
    }
    
    function getAssetManagers()
        external view
        returns (AssetManager[] memory)
    {
        return assetManagers;
    }
    
    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Setters
    
    function setAssetFtsoIndex(address _assetManager, uint256 _assetFtsoIndex) 
        external
        onlyGovernance
    {
        _setValueOnManager(_assetManager, _setAssetFtsoIndex, _assetFtsoIndex);
    }
    
    function _setAssetFtsoIndex(AssetManagerSettings.Settings memory _settings, uint256 _value) 
        private pure 
    {
        _settings.assetFtsoIndex = SafeCast.toUint32(_value);
    }

    function setNatFtsoIndex(address[] memory _assetManagers, uint256 _natFtsoIndex) 
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, _setNatFtsoIndex, _natFtsoIndex);
    }
    
    function _setNatFtsoIndex(AssetManagerSettings.Settings memory _settings, uint256 _value) 
        private pure 
    {
        _settings.natFtsoIndex = SafeCast.toUint32(_value);
    }

    function setUnderlyingBlocksForPayment(address[] memory _assetManagers, uint256 _underlyingBlocksForPayment)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, _setUnderlyingBlocksForPayment, _underlyingBlocksForPayment);
    }
    
    function _setUnderlyingBlocksForPayment(AssetManagerSettings.Settings memory _settings, uint256 _value) 
        private pure 
    {
        _settings.underlyingBlocksForPayment = SafeCast.toUint64(_value);
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Update contracts

    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    ) 
        internal override
    {
        IAttestationClient attestationClient = 
            IAttestationClient(_getContractAddress(_contractNameHashes, _contractAddresses, "AttestationClient"));
        IFtsoRegistry ftsoRegistry =
            IFtsoRegistry(_getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRegistry"));
        (, IIFtso[] memory supportedFtsos) = ftsoRegistry.getSupportedIndicesAndFtsos();
        IWNat wNat = IWNat(address(supportedFtsos[0].wNat()));
        for (uint256 i = 0; i < assetManagers.length; i++) {
            AssetManager assetManager = assetManagers[i];
            AssetManagerSettings.Settings memory settings = assetManager.getSettings();
            settings.attestationClient = attestationClient;
            settings.ftsoRegistry = ftsoRegistry;
            settings.wNat = wNat;
            assetManager.updateSettings(settings);
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Helpers

    function _setValueOnManagers(
        address[] memory _assetManagers,
        function(AssetManagerSettings.Settings memory, uint256) internal _setter,
        uint256 _value
    )
        private
    {
        for (uint256 i = 0; i < _assetManagers.length; i++) {
            _setValueOnManager(_assetManagers[i], _setter, _value);
        }
    }

    function _setValueOnManager(
        address _assetManager,
        function(AssetManagerSettings.Settings memory, uint256) internal _setter,
        uint256 _value
    )
        private
    {
        require(assetManagerIndex[_assetManager] != 0, "Asset manager not managed");
        AssetManager assetManager = AssetManager(_assetManager);
        AssetManagerSettings.Settings memory settings = assetManager.getSettings();
        _setter(settings, _value);
        assetManager.updateSettings(settings);
    }
}
