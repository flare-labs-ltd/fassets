// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./AssetManagerState.sol";
import "./TransactionAttestation.sol";


library StateUpdater {
    function updateCurrentBlock(
        AssetManagerState.State storage _state,
        IAttestationClient.ConfirmedBlockHeightExists calldata _proof
    )
        external
    {
        TransactionAttestation.verifyConfirmedBlockHeightExists(_state.settings, _proof);
        bool changed = false;
        uint64 finalizationBlockNumber = _proof.blockNumber + _proof.numberOfConfirmations;
        if (finalizationBlockNumber > _state.currentUnderlyingBlock) {
            _state.currentUnderlyingBlock = finalizationBlockNumber;
            changed = true;
        }
        uint64 finalizationBlockTimestamp = _proof.blockTimestamp +
            _proof.numberOfConfirmations * _proof.averageBlockProductionTimeMs / 1000;
        if (finalizationBlockTimestamp > _state.currentUnderlyingBlockTimestamp) {
            _state.currentUnderlyingBlockTimestamp = finalizationBlockTimestamp;
            changed = true;
        }
        if (changed) {
            _state.currentUnderlyingBlockUpdatedAt = SafeCast.toUint64(block.timestamp);
        }
    }
}
