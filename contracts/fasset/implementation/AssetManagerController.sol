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
    
    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Setters
    
    function setUnderlyingBlocksForPayment(address[] memory _assetManagers, uint256 _underlyingBlocksForPayment)
        external
        onlyGovernance
    {
        _setValueOnManagers(_assetManagers, 
            SettingsUpdater.SET_UNDERLYING_BLOCKS_FOR_PAYMENT, abi.encode(_underlyingBlocksForPayment));
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
            assetManager.updateSettings(
                SettingsUpdater.UPDATE_CONTRACTS, abi.encode(attestationClient, ftsoRegistry, wNat));
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
