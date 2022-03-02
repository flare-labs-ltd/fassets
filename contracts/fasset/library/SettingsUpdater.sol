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
        // prevent immutable setting changes
        require(_original.burnAddress == _update.burnAddress, "burnAddress immutable");
        require(_original.chainId == _update.chainId, "chainId immutable");
        require(_original.assetUnitUBA == _update.assetUnitUBA, "assetUnitUBA immutable");
        require(_original.assetMintingGranularityUBA == _update.assetMintingGranularityUBA, "assetMint.. immutable");
        require(_original.requireEOAAddressProof == _update.requireEOAAddressProof, "requireEOA... immutable");
        // TODO: validate other changes (e.g. limit big jumps in some values)
    }
}
