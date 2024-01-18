// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Globals.sol";
import "./TransactionAttestation.sol";


library StateUpdater {
    using SafeCast for uint256;

    uint256 internal constant MINIMUM_PAUSE_BEFORE_STOP = 30 days;

    function updateCurrentBlock(ConfirmedBlockHeightExists.Proof calldata _proof)
        external
    {
        TransactionAttestation.verifyConfirmedBlockHeightExists(_proof);
        updateCurrentBlock(_proof.data.requestBody.blockNumber, _proof.data.responseBody.blockTimestamp,
            _proof.data.responseBody.numberOfConfirmations);
    }

    function updateCurrentBlock(uint64 _blockNumber, uint64 _blockTimestamp, uint64 _numberOfConfirmations)
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        bool changed = false;
        uint64 finalizationBlockNumber = _blockNumber + _numberOfConfirmations;
        if (finalizationBlockNumber > state.currentUnderlyingBlock) {
            state.currentUnderlyingBlock = finalizationBlockNumber;
            changed = true;
        }
        uint256 finalizationBlockTimestamp = _blockTimestamp +
            _numberOfConfirmations * state.settings.averageBlockTimeMS / 1000;
        if (finalizationBlockTimestamp > state.currentUnderlyingBlockTimestamp) {
            state.currentUnderlyingBlockTimestamp = finalizationBlockTimestamp.toUint64();
            changed = true;
        }
        if (changed) {
            state.currentUnderlyingBlockUpdatedAt = block.timestamp.toUint64();
            emit AMEvents.CurrentUnderlyingBlockUpdated(
                state.currentUnderlyingBlock, state.currentUnderlyingBlockTimestamp, block.timestamp);
        }
    }

    function pause()
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        if (state.pausedAt == 0) {
            state.pausedAt = block.timestamp.toUint64();
        }
    }

    function unpause()
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(!Globals.getFAsset().terminated(), "f-asset terminated");
        state.pausedAt = 0;
    }

    function terminate()
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(state.pausedAt != 0 && block.timestamp > state.pausedAt + MINIMUM_PAUSE_BEFORE_STOP,
            "asset manager not paused enough");
        Globals.getFAsset().terminate();
    }
}
