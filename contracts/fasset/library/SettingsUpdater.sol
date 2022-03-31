// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./AssetManagerState.sol";
import "./TransactionAttestation.sol";


library SettingsUpdater {
    bytes32 internal constant UPDATE_CONTRACTS = 
        keccak256("updateContracts(IAttestationClient,IFtsoRegistry,IWNat)");
    bytes32 internal constant SET_UNDERLYING_BLOCKS_FOR_PAYMENT =
        keccak256("set_underlyingBlocksForPayment(uint256)");
        
    function validateAndSet(
        AssetManagerState.State storage _state,
        AssetManagerSettings.Settings memory _settings
    )
        external
    {
        _validateSettings(_settings);
        _state.settings = _settings;
    }
    
    function callUpdate(
        AssetManagerState.State storage _state,
        bytes32 _method,
        bytes calldata _params
    )
        external
    {
        if (_method == UPDATE_CONTRACTS) {
            (IAttestationClient attestationClient, IFtsoRegistry ftsoRegistry, IWNat wNat) =
                abi.decode(_params, (IAttestationClient, IFtsoRegistry, IWNat));
            _state.settings.attestationClient = attestationClient;
            _state.settings.ftsoRegistry = ftsoRegistry;
            _state.settings.wNat = wNat;
        } else if (_method == SET_UNDERLYING_BLOCKS_FOR_PAYMENT) {
            (uint256 value) = abi.decode(_params, (uint256));
            _state.settings.underlyingBlocksForPayment = SafeCast.toUint64(value);
        }
    }

    function _validateSettings(
        AssetManagerSettings.Settings memory _settings
    ) 
        private view
    {
        // TODO: define conditions for validity
    }
}
