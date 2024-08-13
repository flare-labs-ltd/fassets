// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../library/data/AssetManagerState.sol";
import "../library/AMEvents.sol";
import "../library/Globals.sol";
import "./AssetManagerBase.sol";


contract EmergencyPauseFacet is AssetManagerBase {
    using SafeCast for uint256;

    function emergencyPause(bool _byGovernance, uint256 _duration, bool _resetTotalDuration)
        external
        onlyAssetManagerController
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        bool pausedAtStart = _paused();
        if (_byGovernance) {
            state.emergencyPausedUntil = (block.timestamp + _duration).toUint64();
            state.emergencyPausedByGovernance = true;
            if (_resetTotalDuration) {
                state.emergencyPausedTotalDuration = 0;
            }
        } else {
            AssetManagerSettings.Data storage settings = Globals.getSettings();
            if (pausedAtStart && state.emergencyPausedByGovernance) {
                revert("paused by governance");
            }
            if (state.emergencyPausedUntil + settings.emergencyPauseDurationResetAfterSeconds <= block.timestamp) {
                state.emergencyPausedTotalDuration = 0;
            }
            uint256 currentPauseEndTime = Math.max(state.emergencyPausedUntil, block.timestamp);
            uint256 projectedStartTime =
                Math.min(currentPauseEndTime - state.emergencyPausedTotalDuration, block.timestamp);
            uint256 maxEndTime = projectedStartTime + settings.maxEmergencyPauseDurationSeconds;
            uint256 endTime = Math.min(block.timestamp + _duration, maxEndTime);
            state.emergencyPausedUntil = endTime.toUint64();
            state.emergencyPausedTotalDuration = (endTime - projectedStartTime).toUint64();
            state.emergencyPausedByGovernance = false;
        }
        if (!pausedAtStart && _paused()) {
            emit AMEvents.EmergencyPaused(state.emergencyPausedUntil);
        } else if (pausedAtStart && !_paused()) {
            emit AMEvents.EmergencyPauseCanceled();
        }
    }

    function emergencyPaused()
        external view
        returns (bool)
    {
        return _paused();
    }

    function emergencyPausedUntil()
        external view
        returns (uint256)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return _paused() ? state.emergencyPausedUntil : 0;
    }

    function emergencyPauseDetails()
        external view
        returns (uint256 _pausedUntil, uint256 _totalPauseDuration, bool _pausedByGovernance)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return (state.emergencyPausedUntil, state. emergencyPausedTotalDuration, state.emergencyPausedByGovernance);
    }

    function _paused() private view returns (bool) {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.emergencyPausedUntil > block.timestamp;
    }
}
