// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./AssetManagerState.sol";


library SettingsUpdater {
    function validateAndSet(
        AssetManagerState.State storage _state,
        AssetManagerSettings.Settings memory _settings,
        bool _update
    )
        external
    {
        _validateSettings(_settings);
        if (_update) {
            _validateSettingsChange(_state.settings, _settings);
        }
        _state.settings = _settings;
    }
    
    function _validateSettings(
        AssetManagerSettings.Settings memory _settings
    ) 
        private view
    {
        // TODO: define conditions for validity
    }

    function _validateSettingsChange(
        AssetManagerSettings.Settings storage _original,
        AssetManagerSettings.Settings memory _update
    ) 
        private view
    {
        string memory settingImmutable = "setting immutable";
        // prevent immutable setting changes
        require(_original.burnAddress == _update.burnAddress, settingImmutable);
        require(_original.chainId == _update.chainId, settingImmutable);
        require(_original.assetUnitUBA == _update.assetUnitUBA, settingImmutable);
        require(_original.assetMintingGranularityUBA == _update.assetMintingGranularityUBA, settingImmutable);
        require(_original.requireEOAAddressProof == _update.requireEOAAddressProof, settingImmutable);
        // TODO: validate other changes (e.g. limit big jumps in some values)
    }
}
