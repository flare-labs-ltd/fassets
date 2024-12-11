// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";
import "../library/data/AssetManagerState.sol";
import "../library/Globals.sol";
import "./AssetManagerBase.sol";


contract EmergencyPauseTransfersFacet is AssetManagerBase, IAssetManagerEvents {
    using SafeCast for uint256;

    function emergencyPauseTransfers(bool _byGovernance, uint256 _duration)
        external
        onlyAssetManagerController
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        bool pausedAtStart = _transfersPaused();
        if (_byGovernance) {
            state.transfersEmergencyPausedUntil = (block.timestamp + _duration).toUint64();
            state.transfersEmergencyPausedByGovernance = true;
        } else {
            if (pausedAtStart && state.transfersEmergencyPausedByGovernance) {
                revert("paused by governance");
            }
            AssetManagerSettings.Data storage settings = Globals.getSettings();
            uint256 resetTs = state.transfersEmergencyPausedUntil + settings.emergencyPauseDurationResetAfterSeconds;
            if (resetTs <= block.timestamp) {
                state.transfersEmergencyPausedTotalDuration = 0;
            }
            uint256 currentPauseEndTime = Math.max(state.transfersEmergencyPausedUntil, block.timestamp);
            uint256 projectedStartTime =
                Math.min(currentPauseEndTime - state.transfersEmergencyPausedTotalDuration, block.timestamp);
            uint256 maxEndTime = projectedStartTime + settings.maxEmergencyPauseDurationSeconds;
            uint256 endTime = Math.min(block.timestamp + _duration, maxEndTime);
            state.transfersEmergencyPausedUntil = endTime.toUint64();
            state.transfersEmergencyPausedTotalDuration = (endTime - projectedStartTime).toUint64();
            state.transfersEmergencyPausedByGovernance = false;
        }
        if (_transfersPaused()) {
            emit EmergencyPauseTransfersTriggered(state.transfersEmergencyPausedUntil);
        } else if (pausedAtStart) {
            emit EmergencyPauseTransfersCanceled();
        }
    }

    function resetEmergencyPauseTransfersTotalDuration()
        external
        onlyAssetManagerController
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        state.transfersEmergencyPausedTotalDuration = 0;
    }

    function transfersEmergencyPaused()
        external view
        returns (bool)
    {
        return _transfersPaused();
    }

    function transfersEmergencyPausedUntil()
        external view
        returns (uint256)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return _transfersPaused() ? state.transfersEmergencyPausedUntil : 0;
    }

    function emergencyPauseTransfersDetails()
        external view
        returns (uint256 _pausedUntil, uint256 _totalPauseDuration, bool _pausedByGovernance)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return (state.transfersEmergencyPausedUntil, state.transfersEmergencyPausedTotalDuration,
            state.transfersEmergencyPausedByGovernance);
    }

    function _transfersPaused() private view returns (bool) {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.transfersEmergencyPausedUntil > block.timestamp;
    }
}
