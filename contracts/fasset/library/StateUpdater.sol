// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./data/AssetManagerState.sol";
import "./TransactionAttestation.sol";


library StateUpdater {
    function updateCurrentBlock(
        IAttestationClient.ConfirmedBlockHeightExists calldata _proof
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        TransactionAttestation.verifyConfirmedBlockHeightExists(_proof);
        bool changed = false;
        uint64 finalizationBlockNumber = _proof.blockNumber + _proof.numberOfConfirmations;
        if (finalizationBlockNumber > state.currentUnderlyingBlock) {
            state.currentUnderlyingBlock = finalizationBlockNumber;
            changed = true;
        }
        uint64 finalizationBlockTimestamp = _proof.blockTimestamp +
            _proof.numberOfConfirmations * _proof.averageBlockProductionTimeMs / 1000;
        if (finalizationBlockTimestamp > state.currentUnderlyingBlockTimestamp) {
            state.currentUnderlyingBlockTimestamp = finalizationBlockTimestamp;
            changed = true;
        }
        if (changed) {
            state.currentUnderlyingBlockUpdatedAt = SafeCast.toUint64(block.timestamp);
        }
    }
}
