// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Globals.sol";
import "./TransactionAttestation.sol";


library StateUpdater {
    using SafeCast for uint256;

    uint256 internal constant MINIMUM_PAUSE_BEFORE_STOP = 30 days;

    function updateCurrentBlock(IConfirmedBlockHeightExists.Proof calldata _proof)
        internal
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
            _numberOfConfirmations * Globals.getSettings().averageBlockTimeMS / 1000;
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

    function pauseMinting()
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        if (state.mintingPausedAt == 0) {
            state.mintingPausedAt = block.timestamp.toUint64();
        }
    }

    function unpauseMinting()
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(!Globals.getFAsset().terminated(), "f-asset terminated");
        state.mintingPausedAt = 0;
    }

    function terminate()
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(state.mintingPausedAt != 0 && block.timestamp > state.mintingPausedAt + MINIMUM_PAUSE_BEFORE_STOP,
            "asset manager not paused enough");
        Globals.getFAsset().terminate();
    }
}
