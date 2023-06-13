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
        uint256 finalizationBlockTimestamp = _proof.blockTimestamp + _finalizationTime(_proof);
        if (finalizationBlockTimestamp > state.currentUnderlyingBlockTimestamp) {
            state.currentUnderlyingBlockTimestamp = finalizationBlockTimestamp.toUint64();
            changed = true;
        }
        if (changed) {
            state.currentUnderlyingBlockUpdatedAt = block.timestamp.toUint64();
        }
    }

    function _finalizationTime(ISCProofVerifier.ConfirmedBlockHeightExists calldata _proof)
        private pure
        returns (uint256)
    {
        uint256 timeRange = _proof.blockTimestamp - _proof.lowestQueryWindowBlockTimestamp;
        uint256 blockRange = _proof.blockNumber - _proof.lowestQueryWindowBlockNumber;
        // `timeRange / blockRange` is the average block time estimate
        return _proof.numberOfConfirmations * timeRange / blockRange;
    }
}
