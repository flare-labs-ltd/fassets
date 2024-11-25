// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "./Globals.sol";


library SettingsUpdater {
    struct UpdaterState {
        mapping (bytes32 => uint256) lastUpdate;
    }

    bytes32 internal constant UPDATES_STATE_POSITION = keccak256("fasset.AssetManager.UpdaterState");

    function checkEnoughTimeSinceLastUpdate() internal {
        UpdaterState storage _state = _getUpdaterState();
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        bytes4 method = msg.sig;
        uint256 lastUpdate = _state.lastUpdate[method];
        require(lastUpdate == 0 || block.timestamp >= lastUpdate + settings.minUpdateRepeatTimeSeconds,
            "too close to previous update");
        _state.lastUpdate[method] = block.timestamp;
    }

    function _getUpdaterState() private pure returns (UpdaterState storage _state) {
        // Only direct constants are allowed in inline assembly, so we assign it here
        bytes32 position = UPDATES_STATE_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _state.slot := position
        }
    }
}
