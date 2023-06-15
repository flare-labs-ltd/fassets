// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./data/AssetManagerState.sol";
import "./TransactionAttestation.sol";


library StateUpdater {
    using SafeCast for uint256;

    function updateCurrentBlock(ISCProofVerifier.ConfirmedBlockHeightExists calldata _proof)
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
        uint256 finalizationBlockTimestamp = _proof.blockTimestamp +
            _proof.numberOfConfirmations * state.settings.averageBlockTimeMS / 1000;
        if (finalizationBlockTimestamp > state.currentUnderlyingBlockTimestamp) {
            state.currentUnderlyingBlockTimestamp = finalizationBlockTimestamp.toUint64();
            changed = true;
        }
        if (changed) {
            state.currentUnderlyingBlockUpdatedAt = block.timestamp.toUint64();
        }
    }
}
